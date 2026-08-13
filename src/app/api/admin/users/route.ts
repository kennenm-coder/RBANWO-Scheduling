import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function getAdminClient() {
  if (!SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY not set");
  }
  return createClient(SUPA_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Verify the request comes from an authenticated admin user. */
async function requireAdmin(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new Error("Unauthorized");
  }
  const token = authHeader.slice(7);
  const admin = getAdminClient();

  // Verify the JWT and get the user
  const { data: { user }, error } = await admin.auth.getUser(token);
  if (error || !user) throw new Error("Invalid session");

  // Check profile role
  const { data: profile } = await admin
    .from("sched_profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || profile.role !== "admin") {
    throw new Error("Admin access required");
  }
  return user;
}

/** GET /api/admin/users — list all users with profiles */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const admin = getAdminClient();

    // Get all profiles
    const { data: profiles, error } = await admin
      .from("sched_profiles")
      .select("*")
      .order("display_name");

    if (error) throw error;

    // Get auth users for email info
    const { data: { users: authUsers } } = await admin.auth.admin.listUsers();

    const merged = (profiles || []).map((p) => {
      const authUser = authUsers?.find((u) => u.id === p.id);
      return {
        ...p,
        email: authUser?.email || null,
        last_sign_in: authUser?.last_sign_in_at || null,
        created_at: authUser?.created_at || null,
      };
    });

    return NextResponse.json(merged);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Server error";
    return NextResponse.json({ error: msg }, { status: msg === "Unauthorized" || msg === "Invalid session" ? 401 : msg === "Admin access required" ? 403 : 500 });
  }
}

/** POST /api/admin/users — invite a new user */
export async function POST(req: NextRequest) {
  try {
    await requireAdmin(req);
    const admin = getAdminClient();

    const body = await req.json();
    const { email, display_name, role } = body;

    if (!email || !display_name) {
      return NextResponse.json({ error: "email and display_name are required" }, { status: 400 });
    }

    const validRoles = ["scheduler", "manager", "admin", "read_only"];
    if (role && !validRoles.includes(role)) {
      return NextResponse.json({ error: `Invalid role. Must be one of: ${validRoles.join(", ")}` }, { status: 400 });
    }

    // Invite user via Supabase auth (sends magic link email)
    const { data: inviteData, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { display_name },
    });

    if (inviteError) {
      if (inviteError.message?.includes("already been registered")) {
        return NextResponse.json({ error: "A user with this email already exists" }, { status: 409 });
      }
      throw inviteError;
    }

    if (!inviteData.user) {
      throw new Error("Invite succeeded but no user returned");
    }

    // Create profile
    const { error: profileError } = await admin.from("sched_profiles").upsert({
      id: inviteData.user.id,
      display_name,
      role: role || "scheduler",
      is_active: true,
    });

    if (profileError) {
      console.warn("[admin] Profile creation failed:", profileError.message);
    }

    return NextResponse.json({
      id: inviteData.user.id,
      email,
      display_name,
      role: role || "scheduler",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Server error";
    return NextResponse.json({ error: msg }, { status: msg === "Unauthorized" || msg === "Invalid session" ? 401 : msg === "Admin access required" ? 403 : 500 });
  }
}

/** PATCH /api/admin/users — update a user's profile (role, active status) */
export async function PATCH(req: NextRequest) {
  try {
    await requireAdmin(req);
    const admin = getAdminClient();

    const body = await req.json();
    const { id, role, is_active, display_name } = body;

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const updates: Record<string, unknown> = {};
    if (role !== undefined) updates.role = role;
    if (is_active !== undefined) updates.is_active = is_active;
    if (display_name !== undefined) updates.display_name = display_name;

    const { error } = await admin
      .from("sched_profiles")
      .update(updates)
      .eq("id", id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Server error";
    return NextResponse.json({ error: msg }, { status: msg === "Unauthorized" || msg === "Invalid session" ? 401 : msg === "Admin access required" ? 403 : 500 });
  }
}
