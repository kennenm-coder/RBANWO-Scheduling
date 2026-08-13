"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "./AuthProvider";
import { canAdmin } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";
import {
  UserPlus,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Eye,
  Calendar,
  Loader2,
  Check,
  X,
  Mail,
  User,
  ChevronDown,
} from "lucide-react";

interface UserRow {
  id: string;
  email: string | null;
  display_name: string;
  role: string;
  is_active: boolean;
  last_sign_in: string | null;
  created_at: string | null;
}

const ROLE_OPTIONS = [
  { value: "scheduler", label: "Scheduler", icon: Calendar, description: "Can view and edit the schedule" },
  { value: "manager", label: "Manager", icon: ShieldCheck, description: "Scheduler + manage crews & resources" },
  { value: "admin", label: "Admin", icon: ShieldAlert, description: "Full access + user management" },
  { value: "read_only", label: "Read Only", icon: Eye, description: "View only, no edits" },
];

function roleIcon(role: string) {
  const opt = ROLE_OPTIONS.find((r) => r.value === role);
  if (!opt) return Shield;
  return opt.icon;
}

function roleLabel(role: string) {
  return ROLE_OPTIONS.find((r) => r.value === role)?.label || role;
}

async function getAccessToken(): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data.session?.access_token ?? null;
}

export default function UserManager() {
  const { role } = useAuth();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Invite form
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState("scheduler");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [inviteSuccess, setInviteSuccess] = useState("");

  // Role editing
  const [editingUserId, setEditingUserId] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    const token = await getAccessToken();
    if (!token) return;
    try {
      const res = await fetch("/api/admin/users", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setUsers(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviting(true);
    setInviteError("");
    setInviteSuccess("");

    const token = await getAccessToken();
    if (!token) return;

    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          email: inviteEmail,
          display_name: inviteName,
          role: inviteRole,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Invite failed");

      setInviteSuccess(`Invitation sent to ${inviteEmail}`);
      setInviteEmail("");
      setInviteName("");
      setInviteRole("scheduler");
      fetchUsers();

      setTimeout(() => setInviteSuccess(""), 5000);
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : "Invite failed");
    } finally {
      setInviting(false);
    }
  };

  const handleRoleChange = async (userId: string, newRole: string) => {
    const token = await getAccessToken();
    if (!token) return;

    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ id: userId, role: newRole }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Update failed");
      }
      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, role: newRole } : u))
      );
      setEditingUserId(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Update failed");
    }
  };

  const handleToggleActive = async (userId: string, isActive: boolean) => {
    const token = await getAccessToken();
    if (!token) return;

    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ id: userId, is_active: isActive }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Update failed");
      }
      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, is_active: isActive } : u))
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : "Update failed");
    }
  };

  if (!canAdmin(role)) {
    return null;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold">Team Members</h2>
        <button
          onClick={() => setShowInvite(!showInvite)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white text-xs rounded-lg hover:opacity-90"
        >
          <UserPlus size={14} />
          Invite User
        </button>
      </div>

      {/* Invite Form */}
      {showInvite && (
        <form
          onSubmit={handleInvite}
          className="mb-4 p-3 bg-surface border border-border rounded-xl space-y-3"
        >
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-muted mb-1">Email</label>
              <div className="relative">
                <Mail size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  required
                  placeholder="name@rbanwo.com"
                  className="w-full border border-border rounded-lg pl-8 pr-3 py-2 text-sm bg-background"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">Display Name</label>
              <div className="relative">
                <User size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
                <input
                  type="text"
                  value={inviteName}
                  onChange={(e) => setInviteName(e.target.value)}
                  required
                  placeholder="First Last"
                  className="w-full border border-border rounded-lg pl-8 pr-3 py-2 text-sm bg-background"
                />
              </div>
            </div>
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">Role</label>
            <div className="flex gap-2">
              {ROLE_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setInviteRole(opt.value)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                      inviteRole === opt.value
                        ? "bg-primary text-white border-primary"
                        : "border-border hover:bg-muted/20"
                    }`}
                    title={opt.description}
                  >
                    <Icon size={12} />
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={inviting}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-xs font-medium hover:opacity-90 disabled:opacity-50"
            >
              {inviting ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Mail size={14} />
              )}
              Send Invite
            </button>
            <button
              type="button"
              onClick={() => {
                setShowInvite(false);
                setInviteError("");
                setInviteSuccess("");
              }}
              className="text-xs text-muted hover:text-foreground"
            >
              Cancel
            </button>
          </div>
          {inviteError && (
            <div className="text-xs text-danger bg-danger/10 px-3 py-2 rounded-lg">
              {inviteError}
            </div>
          )}
          {inviteSuccess && (
            <div className="text-xs text-success bg-success/10 px-3 py-2 rounded-lg flex items-center gap-1.5">
              <Check size={12} />
              {inviteSuccess}
            </div>
          )}
        </form>
      )}

      {error && (
        <div className="text-xs text-danger bg-danger/10 px-3 py-2 rounded-lg mb-3">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 size={20} className="animate-spin text-muted" />
        </div>
      ) : users.length === 0 ? (
        <div className="text-center py-8 text-sm text-muted">
          No users found. Use &ldquo;Invite User&rdquo; to add team members.
        </div>
      ) : (
        <div className="border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface text-left">
                <th className="px-3 py-2 text-xs font-medium text-muted">Name</th>
                <th className="px-3 py-2 text-xs font-medium text-muted">Email</th>
                <th className="px-3 py-2 text-xs font-medium text-muted">Role</th>
                <th className="px-3 py-2 text-xs font-medium text-muted">Status</th>
                <th className="px-3 py-2 text-xs font-medium text-muted">Last Sign In</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const RoleIcon = roleIcon(u.role);
                return (
                  <tr
                    key={u.id}
                    className={`border-t border-border hover:bg-surface/50 transition-colors ${
                      !u.is_active ? "opacity-50" : ""
                    }`}
                  >
                    <td className="px-3 py-2.5 font-medium">{u.display_name}</td>
                    <td className="px-3 py-2.5 text-muted text-xs">
                      {u.email || "—"}
                    </td>
                    <td className="px-3 py-2.5">
                      {editingUserId === u.id ? (
                        <div className="flex items-center gap-1">
                          <select
                            value={u.role}
                            onChange={(e) => handleRoleChange(u.id, e.target.value)}
                            className="text-xs border border-border rounded px-2 py-1 bg-background"
                          >
                            {ROLE_OPTIONS.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                          <button
                            onClick={() => setEditingUserId(null)}
                            className="p-0.5 rounded hover:bg-border text-muted"
                          >
                            <X size={12} />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setEditingUserId(u.id)}
                          className="flex items-center gap-1 text-xs hover:text-primary transition-colors"
                          title="Click to change role"
                        >
                          <RoleIcon size={12} className="text-primary" />
                          {roleLabel(u.role)}
                          <ChevronDown size={10} className="text-muted" />
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <button
                        onClick={() => handleToggleActive(u.id, !u.is_active)}
                        className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                          u.is_active
                            ? "bg-success/10 text-success"
                            : "bg-muted/20 text-muted"
                        }`}
                        title={u.is_active ? "Click to deactivate" : "Click to reactivate"}
                      >
                        {u.is_active ? "Active" : "Inactive"}
                      </button>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-muted">
                      {u.last_sign_in
                        ? new Date(u.last_sign_in).toLocaleDateString()
                        : "Never"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[10px] text-muted mt-3">
        Invited users receive an email with a link to set their password.
        Users with &ldquo;Read Only&rdquo; role can view the schedule but cannot make changes.
      </p>
    </div>
  );
}
