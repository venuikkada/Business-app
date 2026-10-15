import { redirect } from "next/navigation";
import { DOC_TYPE_META } from "@cba/core";
import { tenantOrError } from "@/lib/session";
import { DocumentEditor } from "@/components/documents/editor";
import { editorContext, initialFromDocument } from "@/components/documents/load";
import { docPermFor } from "@/components/documents/perm";
import { ErrorPanel, PageHeader } from "@/components/ui";

export const metadata = { title: "Edit draft" };

export default async function EditDocument({ params }: { params: Promise<{ type: string; id: string }> }) {
  const { id } = await params;
  const res = await tenantOrError(async (t) => {
    const d = await initialFromDocument(t, id);
    t.require(docPermFor(d.type, "edit"));
    return { ...d, ctx: await editorContext(t, d.type) };
  });
  if (!res.ok) return <ErrorPanel code={res.code} message={res.message} />;
  const { type, initial, status, ctx } = res.data;
  if (status !== "draft") redirect(`/documents/${type}/${id}`);
  return (
    <>
      <PageHeader title={`Edit draft ${DOC_TYPE_META[type].label.toLowerCase()}`} back={{ href: `/documents/${type}/${id}`, label: "Back" }} />
      <DocumentEditor type={type} initial={initial} {...ctx} />
    </>
  );
}
