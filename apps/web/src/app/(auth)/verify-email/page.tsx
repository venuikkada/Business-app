import { VerifyEmail } from "@/components/auth/forms";

export const metadata = { title: "Verify email" };

export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold">Verify your email</h1>
      <VerifyEmail token={token} />
    </>
  );
}
