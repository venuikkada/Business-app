import { ForgotForm } from "@/components/auth/forms";

export const metadata = { title: "Reset password" };

export default function ForgotPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold">Forgot password</h1>
      <p className="mb-6 mt-1 text-sm text-muted">We will email you a link to set a new password.</p>
      <ForgotForm />
    </>
  );
}
