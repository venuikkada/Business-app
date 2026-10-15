import { redirect } from "next/navigation";
import { getAdmin } from "@/lib/session";
import { TotpSetup } from "@/components/client";

export const metadata = { title: "Set up two-factor authentication" };

export default async function Setup2fa() {
  const pending = await getAdmin(true);
  if (!pending) redirect("/login");
  if (pending.session.mfaVerified) redirect("/");
  return (
    <main className="mx-auto max-w-md px-4 py-20">
      <h1 className="text-xl font-semibold">Two-factor authentication is required</h1>
      <p className="mb-6 mt-2 text-sm text-muted">{pending.user.totpEnabled ? "Sign out and sign in again with your authenticator code." : "Scan the QR code with Google Authenticator, Microsoft Authenticator or a similar app."}</p>
      {!pending.user.totpEnabled && <TotpSetup />}
    </main>
  );
}
