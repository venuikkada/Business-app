import { redirect } from "next/navigation";
import { DOC_TYPE_META } from "@cba/core";
import { tenantOrError } from "@/lib/session";
import { asDocType } from "@/components/documents/meta";
import { DocumentEditor } from "@/components/documents/editor";
import { blankInitial, editorContext, partyForEditor } from "@/components/documents/load";
import { docPermFor } from "@/components/documents/perm";
import { ErrorPanel, PageHeader } from "@/components/ui";

export const metadata = { title: "New document" };

export default async function NewDocument({ searchParams }: { searchParams: Promise<{ type?: string; partyId?: string }> }) {
  const sp = await searchParams;
  const type = asDocType(sp.type ?? "invoice");
  if (!type) redirect("/documents/new?type=invoice");
  const res = await tenantOrError(async (t) => {
    t.require(docPermFor(type, "create"));
    if (DOC_TYPE_META[type].side === "purchase") t.requireFeature("purchases");
    const party = sp.partyId && /^[0-9a-f-]{36}$/.test(sp.partyId) ? await partyForEditor(t, sp.partyId) : null;
    return { ctx: await editorContext(t, type), initial: blankInitial(t, type, party) };
  });
  if (!res.ok) return <ErrorPanel code={res.code} message={res.message} />;
  return (
    <>
      <PageHeader title={`New ${DOC_TYPE_META[type].label.toLowerCase()}`} back={{ href: `/documents/${type}`, label: DOC_TYPE_META[type].plural }} />
      <DocumentEditor type={type} initial={res.data.initial} {...res.data.ctx} />
    </>
  );
}
