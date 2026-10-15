import { LoginForm } from "@/components/client";

export const metadata = { title: "Sign in" };

export default function AdminLogin() {
  return (
    <main className="mx-auto max-w-sm px-4 py-20">
      <div className="mb-6 flex items-center gap-2 font-semibold"><span className="grid h-8 w-8 place-items-center rounded-lg bg-ink text-sm font-bold text-white">C</span>Platform admin</div>
      <p className="mb-6 text-sm text-muted">Restricted area. All actions are recorded in the platform audit log.</p>
      <LoginForm />
    </main>
  );
}
