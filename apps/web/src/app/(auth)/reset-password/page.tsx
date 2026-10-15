import { ResetForm } from "@/components/auth/forms";

export const metadata = { title: "Set new password" };

export default async function ResetPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  return (
    <>
      <h1 className="text-2xl font-semibold">Set a new password</h1>
      <p className="mb-6 mt-1 text-sm text-muted">You will be signed out on all other devices.</p>
      <ResetForm token={token} />
    </>
  );
}
