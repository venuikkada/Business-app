"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { api, ApiError } from "@/lib/api-client";
import { Button, Field, Input } from "@/components/ui";

function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  async function submit(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      await fn();
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.message);
        const issues = (e.details?.issues ?? []) as Array<{ path: string; message: string }>;
        setFieldErrors(Object.fromEntries(issues.map((i) => [i.path, i.message])));
      } else setError("Network problem. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, fieldErrors, submit, setError };
}

function safeNext(n: string | null) {
  return n && n.startsWith("/") && !n.startsWith("//") ? n : "/dashboard";
}

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { busy, error, submit } = useSubmit();
  const [needTotp, setNeedTotp] = useState(false);
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        submit(async () => {
          try {
            await api("POST", "auth/login", { email: f.get("email"), password: f.get("password"), totp: f.get("totp") || undefined });
            router.push(safeNext(params.get("next")));
            router.refresh();
          } catch (err) {
            if (err instanceof ApiError && err.code === "MFA_REQUIRED") setNeedTotp(true);
            throw err;
          }
        });
      }}
    >
      <Field label="Email">
        <Input name="email" type="email" autoComplete="email" required autoFocus />
      </Field>
      <Field label="Password">
        <Input name="password" type="password" autoComplete="current-password" required />
      </Field>
      {needTotp && (
        <Field label="Authenticator code" hint="6-digit code from your authenticator app">
          <Input name="totp" inputMode="numeric" pattern="\d{6}" maxLength={6} autoComplete="one-time-code" autoFocus />
        </Field>
      )}
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p>}
      <Button type="submit" className="w-full" size="lg" disabled={busy}>
        {busy ? "Signing in…" : "Sign in"}
      </Button>
      <div className="flex justify-between text-sm">
        <Link href="/forgot-password" className="text-brand-700 hover:underline">Forgot password?</Link>
        <Link href="/register" className="text-brand-700 hover:underline">Create account</Link>
      </div>
    </form>
  );
}

export function RegisterForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { busy, error, fieldErrors, submit } = useSubmit();
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        submit(async () => {
          await api("POST", "auth/register", { fullName: f.get("fullName"), email: f.get("email"), phone: f.get("phone") || null, password: f.get("password"), acceptTerms: f.get("acceptTerms") === "on" });
          const next = params.get("next");
          router.push(next && next.startsWith("/invite") ? next : "/onboarding");
          router.refresh();
        });
      }}
    >
      <Field label="Your name" error={fieldErrors.fullName} required>
        <Input name="fullName" autoComplete="name" required autoFocus />
      </Field>
      <Field label="Email" error={fieldErrors.email} required>
        <Input name="email" type="email" autoComplete="email" required defaultValue={params.get("email") ?? ""} />
      </Field>
      <Field label="Mobile number" hint="Optional — used for account recovery" error={fieldErrors.phone}>
        <Input name="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="98765 43210" />
      </Field>
      <Field label="Password" hint="At least 10 characters with letters and numbers" error={fieldErrors.password} required>
        <Input name="password" type="password" autoComplete="new-password" minLength={10} required />
      </Field>
      <label className="flex items-start gap-2 text-sm text-muted">
        <input type="checkbox" name="acceptTerms" className="mt-0.5 accent-brand-600" required />
        <span>
          I agree to the <Link href="/terms" className="text-brand-700 underline">Terms</Link> and <Link href="/privacy" className="text-brand-700 underline">Privacy Policy</Link>.
        </span>
      </label>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p>}
      <Button type="submit" className="w-full" size="lg" disabled={busy}>
        {busy ? "Creating account…" : "Create free account"}
      </Button>
      <p className="text-center text-sm text-muted">
        Already have an account? <Link href="/login" className="text-brand-700 hover:underline">Sign in</Link>
      </p>
    </form>
  );
}

export function ForgotForm() {
  const { busy, error, submit } = useSubmit();
  const [done, setDone] = useState(false);
  if (done) return <p className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">If an account exists for that email, we have sent a reset link. It is valid for 1 hour.</p>;
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        submit(async () => {
          await api("POST", "auth/forgot", { email: f.get("email") });
          setDone(true);
        });
      }}
    >
      <Field label="Email">
        <Input name="email" type="email" autoComplete="email" required autoFocus />
      </Field>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? "Sending…" : "Send reset link"}
      </Button>
      <p className="text-center text-sm"><Link href="/login" className="text-brand-700 hover:underline">Back to sign in</Link></p>
    </form>
  );
}

export function ResetForm({ token }: { token: string }) {
  const router = useRouter();
  const { busy, error, submit, setError } = useSubmit();
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        if (f.get("password") !== f.get("confirm")) return setError("Passwords do not match");
        submit(async () => {
          await api("POST", "auth/reset", { token, password: f.get("password") });
          router.push("/login?reset=1");
        });
      }}
    >
      <Field label="New password" hint="At least 10 characters with letters and numbers">
        <Input name="password" type="password" autoComplete="new-password" minLength={10} required autoFocus />
      </Field>
      <Field label="Confirm password">
        <Input name="confirm" type="password" autoComplete="new-password" required />
      </Field>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <Button type="submit" className="w-full" disabled={busy || !token}>
        {busy ? "Saving…" : "Set new password"}
      </Button>
    </form>
  );
}

export function VerifyEmail({ token }: { token: string }) {
  const [state, setState] = useState<"idle" | "ok" | "error">("idle");
  const [msg, setMsg] = useState("");
  return state === "ok" ? (
    <p className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">Email verified. <Link href="/dashboard" className="underline">Continue</Link></p>
  ) : (
    <div className="space-y-3">
      <Button
        className="w-full"
        onClick={async () => {
          try {
            await api("POST", "auth/verify-email", { token });
            setState("ok");
          } catch (e) {
            setState("error");
            setMsg(e instanceof ApiError ? e.message : "Failed");
          }
        }}
      >
        Verify my email
      </Button>
      {state === "error" && <p className="text-sm text-red-700">{msg}</p>}
    </div>
  );
}
