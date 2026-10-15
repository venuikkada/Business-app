import { tenant } from "@/lib/session";
import { MoreMenu } from "@/components/shell";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "More" };

export default async function MorePage() {
  const perms = await tenant(async (t) => [...t.permissions]);
  return (
    <>
      <PageHeader title="All modules" />
      <MoreMenu permissions={perms} />
    </>
  );
}
