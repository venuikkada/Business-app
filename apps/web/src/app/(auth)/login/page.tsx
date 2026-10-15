import { Suspense } from "react";
import { LoginForm } from "@/components/auth/forms";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ reset?: string }> }) {
  const sp = await searchParams;
  return (
    <>
      <h1 className="text-2xl font-semibold">Welcome back</h1>
      <p className="mb-6 mt-1 text-sm text-muted">Sign in to manage your business.</p>
      {sp.reset && <p className="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Password changed. Sign in with your new password.</p>}
      <Suspense>
        <LoginForm />
      </Suspense>
    </>
  );
}
