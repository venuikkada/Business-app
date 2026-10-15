import { getSupportTicketAdmin } from "@cba/server/platform";
import { formatDateTimeIN } from "@cba/core";
import { requireAdmin } from "@/lib/session";
import { ReplyForm } from "@/components/forms";
import { Card, CardHeader, PageHeader, cn } from "@cba/ui";

export default async function Ticket({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const a = await requireAdmin();
  const t = await getSupportTicketAdmin(a, id);
  return (
    <>
      <PageHeader back={{ href: "/support", label: "Support desk" }} title={t.subject as string} subtitle={t.businessName as string} />
      <div className="space-y-3">
        {(t.messages as Array<Record<string, string | boolean>>).map((m) => (
          <Card key={m.id as string} className={cn("p-4", m.isStaff ? "ml-8 border-brand-200 bg-brand-50" : "mr-8")}>
            <div className="text-xs text-muted">{m.author as string} {m.isStaff ? "(staff)" : ""} · {formatDateTimeIN(m.createdAt as string)}</div>
            <p className="mt-1 whitespace-pre-line text-sm">{m.body as string}</p>
          </Card>
        ))}
        <Card><CardHeader title="Reply" /><ReplyForm id={id} /></Card>
      </div>
    </>
  );
}
