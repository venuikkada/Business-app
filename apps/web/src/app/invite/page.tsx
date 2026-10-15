import Link from "next/link";
import { getAuth } from "@/lib/session";
import { ToastProvider } from "@/components/client";
import { AcceptInvite } from "@/components/onboarding/accept-invite";
import { LinkButton } from "@/components/ui";

export const metadata = { title: "Join business" };

export default async function InvitePage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  const a = await getAuth();
  const next = encodeURIComponent(`/invite?token=${token}`);
  return (
    <ToastProvider>
      <main className="mx-auto max-w-md px-5 py-16">
        <Link href="/" className="mb-8 flex items-center gap-2 font-semibold">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-sm font-bold text-white">C</span>CRAZY BUSINESS APP
        </Link>
        <h1 className="text-2xl font-semibold">You have been invited</h1>
        {a ? (
          <>
            <p className="mb-6 mt-2 text-sm text-muted">Signed in as {a.user.email}. The invitation must have been sent to this email.</p>
            <AcceptInvite token={token} />
          </>
        ) : (
          <>
            <p className="mb-6 mt-2 text-sm text-muted">Sign in or create an account with the email address the invitation was sent to.</p>
            <div className="flex gap-2">
              <LinkButton href={`/login?next=${next}`}>Sign in</LinkButton>
              <LinkButton href={`/register?next=${next}`} variant="secondary">Create account</LinkButton>
            </div>
          </>
        )}
      </main>
    </ToastProvider>
  );
}
