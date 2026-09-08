"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import { Mail, KeyRound, Lock, Loader2, AlertCircle, ArrowLeft } from "lucide-react";

type Step = "request" | "code" | "password" | "done";
type Status = "idle" | "sending" | "verifying" | "saving" | "error";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("request");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const busy =
    status === "sending" || status === "verifying" || status === "saving";

  function clearError() {
    if (status === "error") {
      setStatus("idle");
      setErrorMsg("");
    }
  }

  // Step 1 — email the 8-digit code.
  async function handleSendCode(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) return;

    const sb = getSupabase();
    if (!sb) {
      setStatus("error");
      setErrorMsg("No connection. Try again.");
      return;
    }

    setStatus("sending");
    setErrorMsg("");
    try {
      const { error } = await sb.auth.resetPasswordForEmail(trimmed);
      if (error) {
        setStatus("error");
        setErrorMsg(error.message);
      } else {
        setStatus("idle");
        setStep("code");
      }
    } catch {
      setStatus("error");
      setErrorMsg("Something went wrong. Try again.");
    }
  }

  // Step 2 — verify the code (establishes a recovery session).
  async function handleVerifyCode(e: React.FormEvent) {
    e.preventDefault();
    const trimmedEmail = email.trim().toLowerCase();
    const trimmedCode = code.trim();

    if (trimmedCode.length < 8) {
      setStatus("error");
      setErrorMsg("Enter the 8-digit code from your email.");
      return;
    }

    const sb = getSupabase();
    if (!sb) {
      setStatus("error");
      setErrorMsg("No connection. Try again.");
      return;
    }

    setStatus("verifying");
    setErrorMsg("");
    try {
      const { error } = await sb.auth.verifyOtp({
        email: trimmedEmail,
        token: trimmedCode,
        type: "recovery",
      });
      if (error) {
        setStatus("error");
        setErrorMsg(
          /expired|invalid/i.test(error.message)
            ? "That code is wrong or expired. Request a new one below."
            : error.message,
        );
        return;
      }
      setStatus("idle");
      setStep("password");
    } catch {
      setStatus("error");
      setErrorMsg("Something went wrong. Try again.");
    }
  }

  // Step 3 — set the new password on the now-authenticated session.
  async function handleSetPassword(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 6) {
      setStatus("error");
      setErrorMsg("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setStatus("error");
      setErrorMsg("Passwords don't match.");
      return;
    }

    const sb = getSupabase();
    if (!sb) {
      setStatus("error");
      setErrorMsg("No connection. Try again.");
      return;
    }

    setStatus("saving");
    setErrorMsg("");
    try {
      const { error } = await sb.auth.updateUser({ password });
      if (error) {
        setStatus("error");
        setErrorMsg(error.message);
        return;
      }
      setStatus("idle");
      setStep("done");
      setTimeout(() => {
        router.push("/");
        router.refresh();
      }, 1500);
    } catch {
      setStatus("error");
      setErrorMsg("Something went wrong. Try again.");
    }
  }

  function restart() {
    setStep("request");
    setCode("");
    setPassword("");
    setConfirm("");
    setStatus("idle");
    setErrorMsg("");
  }

  return (
    <div className="flex-1 flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.svg" alt="" className="w-16 h-16 mx-auto mb-3 rounded-2xl" />
          <h1 className="text-2xl font-bold">
            {step === "done"
              ? "Password updated"
              : step === "password"
                ? "Set a new password"
                : step === "code"
                  ? "Enter your code"
                  : "Reset your password"}
          </h1>
          <p className="text-sm text-muted mt-1">
            {step === "done" ? (
              "Taking you to the app…"
            ) : step === "password" ? (
              "Code confirmed. Choose a new password for your account."
            ) : step === "code" ? (
              <>
                We emailed an 8-digit code to{" "}
                <strong className="text-foreground">{email.trim().toLowerCase()}</strong>.
              </>
            ) : (
              "Enter your email and we'll send you an 8-digit code — no link to click."
            )}
          </p>
        </div>

        {step === "done" ? null : step === "password" ? (
          <form onSubmit={handleSetPassword} className="space-y-4">
            {status === "error" && (
              <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-600 dark:text-red-400 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-muted mb-1">New password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted pointer-events-none" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    clearError();
                  }}
                  required
                  autoFocus
                  autoComplete="new-password"
                  disabled={busy}
                  className="w-full border border-border rounded-lg pl-10 pr-3 py-2.5 text-sm bg-background disabled:opacity-60"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted mb-1">Confirm new password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted pointer-events-none" />
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => {
                    setConfirm(e.target.value);
                    clearError();
                  }}
                  required
                  autoComplete="new-password"
                  disabled={busy}
                  className="w-full border border-border rounded-lg pl-10 pr-3 py-2.5 text-sm bg-background disabled:opacity-60"
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={!password || !confirm || busy}
              className="w-full py-2.5 bg-primary text-white rounded-lg font-medium hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {status === "saving" && <Loader2 size={16} className="animate-spin" />}
              {status === "saving" ? "Saving…" : "Update password"}
            </button>
          </form>
        ) : step === "code" ? (
          <form onSubmit={handleVerifyCode} className="space-y-4">
            {status === "error" && (
              <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-600 dark:text-red-400 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-muted mb-1">8-digit code</label>
              <div className="relative">
                <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted pointer-events-none" />
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={8}
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value.replace(/\D/g, ""));
                    clearError();
                  }}
                  required
                  autoFocus
                  disabled={busy}
                  placeholder="00000000"
                  className="w-full border border-border rounded-lg pl-10 pr-3 py-2.5 text-center text-lg tracking-[0.3em] bg-background disabled:opacity-60"
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={code.trim().length < 8 || busy}
              className="w-full py-2.5 bg-primary text-white rounded-lg font-medium hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {status === "verifying" && <Loader2 size={16} className="animate-spin" />}
              {status === "verifying" ? "Checking…" : "Verify code"}
            </button>
            <button
              type="button"
              onClick={restart}
              className="w-full text-sm text-muted hover:text-foreground"
            >
              Use a different email or resend code
            </button>
          </form>
        ) : (
          <form onSubmit={handleSendCode} className="space-y-4">
            {status === "error" && (
              <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-600 dark:text-red-400 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{errorMsg}</span>
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
                    clearError();
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
            <button
              type="submit"
              disabled={!email.trim() || busy}
              className="w-full py-2.5 bg-primary text-white rounded-lg font-medium hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {status === "sending" && <Loader2 size={16} className="animate-spin" />}
              {status === "sending" ? "Sending…" : "Send code"}
            </button>
            <Link
              href="/login"
              className="w-full flex items-center justify-center gap-2 text-sm text-muted hover:text-foreground"
            >
              <ArrowLeft size={15} />
              Back to sign in
            </Link>
          </form>
        )}
      </div>
    </div>
  );
}
