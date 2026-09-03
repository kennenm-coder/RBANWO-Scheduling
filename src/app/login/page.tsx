"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import { fetchAllowlist, hasSchedulingAccess } from "@/lib/auth";
import { useAuth } from "@/components/AuthProvider";
import {
  Loader2,
  Mail,
  Lock,
  AlertCircle,
  ShieldX,
  User,
  CheckCircle,
} from "lucide-react";

type Mode = "sign-in" | "sign-up";
type Status =
  | "idle"
  | "checking"
  | "submitting"
  | "error"
  | "not-allowed"
  | "requested"
  | "already-exists";

export default function LoginPage() {
  const router = useRouter();
  const { hasAccess, loading: authLoading } = useAuth();
  const [mode, setMode] = useState<Mode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  // Already signed in with access → leave the login page.
  useEffect(() => {
    if (!authLoading && hasAccess) router.replace("/");
  }, [authLoading, hasAccess, router]);

  function clearInlineError() {
    if (status === "error" || status === "already-exists") setStatus("idle");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !password) return;

    if (mode === "sign-up") {
      if (!firstName.trim() || !lastName.trim()) {
        setStatus("error");
        setErrorMsg("First and last name are required.");
        return;
      }
      if (password !== confirmPassword) {
        setStatus("error");
        setErrorMsg("Passwords don't match.");
        return;
      }
      if (password.length < 6) {
        setStatus("error");
        setErrorMsg("Password must be at least 6 characters.");
        return;
      }
    }

    const sb = getSupabase();
    if (!sb) {
      setStatus("error");
      setErrorMsg("No connection. Try again.");
      return;
    }

    setStatus("checking");
    setErrorMsg("");
    try {
      // Friendly pre-check against the shared Duck Force allowlist.
      const { data: isAllowed, error: rpcErr } = await sb.rpc("is_email_allowed", {
        check_email: trimmed,
      });
      if (rpcErr) {
        setStatus("error");
        setErrorMsg("Could not verify access. Try again.");
        return;
      }

      if (mode === "sign-up") {
        // Always create the auth account, even if not yet approved, so the
        // user doesn't have to re-register once an admin grants access.
        setStatus("submitting");
        const fullName = `${firstName.trim()} ${lastName.trim()}`;
        const { data, error: signUpErr } = await sb.auth.signUp({
          email: trimmed,
          password,
          options: {
            data: {
              first_name: firstName.trim(),
              last_name: lastName.trim(),
              full_name: fullName,
            },
          },
        });

        if (signUpErr) {
          setStatus("error");
          setErrorMsg(signUpErr.message);
          return;
        }

        if (data.user?.identities?.length === 0) {
          setStatus("already-exists");
          return;
        }

        if (isAllowed) {
          // Already on the allowlist — save their name and continue in.
          await sb
            .from("allowed_emails")
            .update({ name: fullName })
            .eq("email", trimmed);
          router.push("/");
          router.refresh();
        } else {
          // Not yet approved — auto-submit an access request.
          const { data: existing } = await sb
            .from("access_requests")
            .select("id")
            .eq("email", trimmed)
            .maybeSingle();

          if (!existing) {
            await sb.from("access_requests").insert({
              email: trimmed,
              name: fullName,
            });
          }

          // Sign them out so the auth listener doesn't redirect-loop.
          await sb.auth.signOut();
          setStatus("requested");
        }
        return;
      }

      // Sign-in flow — must be on the allowlist.
      if (!isAllowed) {
        setStatus("not-allowed");
        return;
      }

      setStatus("submitting");
      const { error: signErr } = await sb.auth.signInWithPassword({
        email: trimmed,
        password,
      });
      if (signErr) {
        setStatus("error");
        setErrorMsg(
          signErr.message === "Invalid login credentials"
            ? "Wrong email or password."
            : signErr.message
        );
        return;
      }

      // Signed in — confirm they hold a scheduling role, else reject.
      const allow = await fetchAllowlist(trimmed);
      if (!allow || !hasSchedulingAccess(allow.roles)) {
        await sb.auth.signOut();
        setStatus("not-allowed");
        return;
      }

      router.push("/");
      router.refresh();
    } catch {
      setStatus("error");
      setErrorMsg("Something went wrong. Try again.");
    }
  }

  const busy = status === "checking" || status === "submitting";

  return (
    <div className="flex-1 flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.svg" alt="" className="w-16 h-16 mx-auto mb-3 rounded-2xl" />
          <h1 className="text-2xl font-bold">
            {mode === "sign-up" ? "Create your account" : "RBANWO Scheduling"}
          </h1>
          <p className="text-sm text-muted mt-1">
            {mode === "sign-up" ? (
              "Uses your Duck Force login. An admin grants scheduling access."
            ) : (
              <>
                Sign in with your <strong>Duck Force</strong> login — same email and
                password as the calendar app.
              </>
            )}
          </p>
        </div>

        {status === "requested" ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-surface p-4 text-center space-y-2">
              <CheckCircle className="w-8 h-8 text-green-600 dark:text-green-500 mx-auto" />
              <p className="font-medium text-sm">Request submitted</p>
              <p className="text-xs text-muted">
                An admin will review your request for{" "}
                <strong className="text-foreground">{email}</strong> and grant
                scheduling access.
              </p>
              <p className="text-xs text-muted">
                Your account is ready — just sign in once approved.
              </p>
            </div>
            <button
              onClick={() => {
                setMode("sign-in");
                setPassword("");
                setConfirmPassword("");
                setFirstName("");
                setLastName("");
                setStatus("idle");
                setErrorMsg("");
              }}
              className="w-full text-sm text-muted hover:text-foreground"
            >
              Back to sign in
            </button>
          </div>
        ) : status === "not-allowed" ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-surface p-4 text-center space-y-2">
              <ShieldX className="w-8 h-8 text-muted mx-auto" />
              <p className="font-medium text-sm">No scheduling access</p>
              <p className="text-xs text-muted">
                This account isn&apos;t approved for the Scheduling app. Ask an admin
                to add a <strong>Scheduling</strong> role in Duck Force.
              </p>
            </div>
            <button
              onClick={() => {
                setStatus("idle");
                setPassword("");
              }}
              className="w-full text-sm text-muted hover:text-foreground"
            >
              Try a different account
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {status === "error" && (
              <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-600 dark:text-red-400 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            {status === "already-exists" && (
              <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg text-sm text-amber-700 dark:text-amber-400 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>
                  This email already has an account.{" "}
                  <button
                    type="button"
                    onClick={() => {
                      setMode("sign-in");
                      setPassword("");
                      setConfirmPassword("");
                      setStatus("idle");
                    }}
                    className="font-medium underline"
                  >
                    Sign in instead
                  </button>
                </span>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-muted mb-1">Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted pointer-events-none" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    clearInlineError();
                  }}
                  required
                  autoFocus
                  autoComplete="email"
                  disabled={busy}
                  className="w-full border border-border rounded-lg pl-10 pr-3 py-2.5 text-sm bg-background disabled:opacity-60"
                  placeholder="you@rbanwo.com"
                />
              </div>
            </div>

            {mode === "sign-up" && (
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="block text-xs font-medium text-muted mb-1">
                    First name
                  </label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted pointer-events-none" />
                    <input
                      type="text"
                      value={firstName}
                      onChange={(e) => {
                        setFirstName(e.target.value);
                        clearInlineError();
                      }}
                      required
                      autoComplete="given-name"
                      disabled={busy}
                      className="w-full border border-border rounded-lg pl-10 pr-3 py-2.5 text-sm bg-background disabled:opacity-60"
                      placeholder="First"
                    />
                  </div>
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-medium text-muted mb-1">
                    Last name
                  </label>
                  <input
                    type="text"
                    value={lastName}
                    onChange={(e) => {
                      setLastName(e.target.value);
                      clearInlineError();
                    }}
                    required
                    autoComplete="family-name"
                    disabled={busy}
                    className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-background disabled:opacity-60"
                    placeholder="Last"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-muted mb-1">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted pointer-events-none" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    clearInlineError();
                  }}
                  required
                  autoComplete={
                    mode === "sign-in" ? "current-password" : "new-password"
                  }
                  disabled={busy}
                  className="w-full border border-border rounded-lg pl-10 pr-3 py-2.5 text-sm bg-background disabled:opacity-60"
                />
              </div>
            </div>

            {mode === "sign-up" && (
              <div>
                <label className="block text-xs font-medium text-muted mb-1">
                  Confirm password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted pointer-events-none" />
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => {
                      setConfirmPassword(e.target.value);
                      clearInlineError();
                    }}
                    required
                    autoComplete="new-password"
                    disabled={busy}
                    className="w-full border border-border rounded-lg pl-10 pr-3 py-2.5 text-sm bg-background disabled:opacity-60"
                  />
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={busy || !email.trim() || !password}
              className="w-full py-2.5 bg-primary text-white rounded-lg font-medium hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {busy && <Loader2 size={16} className="animate-spin" />}
              {status === "checking"
                ? "Checking access…"
                : mode === "sign-up"
                  ? busy
                    ? "Creating account…"
                    : "Create Account"
                  : busy
                    ? "Signing in…"
                    : "Sign In"}
            </button>

            <p className="text-sm text-center text-muted">
              {mode === "sign-in" ? (
                <>
                  First time?{" "}
                  <button
                    type="button"
                    onClick={() => {
                      setMode("sign-up");
                      setPassword("");
                      setConfirmPassword("");
                      setFirstName("");
                      setLastName("");
                      setStatus("idle");
                      setErrorMsg("");
                    }}
                    className="text-primary font-medium hover:underline"
                  >
                    Create account
                  </button>
                </>
              ) : (
                <>
                  Already have an account?{" "}
                  <button
                    type="button"
                    onClick={() => {
                      setMode("sign-in");
                      setPassword("");
                      setConfirmPassword("");
                      setFirstName("");
                      setLastName("");
                      setStatus("idle");
                      setErrorMsg("");
                    }}
                    className="text-primary font-medium hover:underline"
                  >
                    Sign in
                  </button>
                </>
              )}
            </p>

            <p className="text-xs text-center text-muted">
              Accounts are managed in Duck Force. Only approved scheduling team
              members can sign in.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
