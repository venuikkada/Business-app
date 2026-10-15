import { Suspense } from "react";
import { RegisterForm } from "@/components/auth/forms";

export const metadata = { title: "Create account" };

export default function RegisterPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold">Start free</h1>
      <p className="mb-6 mt-1 text-sm text-muted">14-day Pro trial. No card needed.</p>
      <Suspense>
        <RegisterForm />
      </Suspense>
    </>
  );
}
