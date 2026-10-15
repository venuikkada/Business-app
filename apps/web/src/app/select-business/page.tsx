import { redirect } from "next/navigation";
import { appTx, camelize } from "@cba/server";
import { getMyBusinesses, requireAuth } from "@/lib/session";
import { ToastProvider } from "@/components/client";
import { BusinessPicker } from "@/components/onboarding/picker";
import { LinkButton } from "@/components/ui";

export const metadata = { title: "Choose business" };

export default async function SelectBusinessPage() {
  const a = await requireAuth();
  const mine = await getMyBusinesses();
  const deleted = camelize<{ id: string; name: string; purgeAfter: string }>(await appTx({ userId: a.user.id }, (db) => db.query("select * from app.my_deleted_businesses()")));
  if (!mine.length && !deleted.length) redirect("/onboarding");
  return (
    <ToastProvider>
      <main className="mx-auto max-w-lg px-4 py-12">
        <h1 className="mb-1 text-2xl font-semibold">Choose a business</h1>
        <p className="mb-6 text-sm text-muted">Signed in as {a.user.email}</p>
        <BusinessPicker items={mine} deleted={deleted} />
        <div className="mt-6">
          <LinkButton href="/onboarding" variant="secondary">+ Add another business</LinkButton>
        </div>
      </main>
    </ToastProvider>
  );
}
