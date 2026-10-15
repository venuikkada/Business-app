import Link from "next/link";
import { listBusinesses } from "@cba/server/platform";
import { formatDateIN, formatDateTimeIN } from "@cba/core";
import { requireAdmin } from "@/lib/session";
import { Card, PageHeader, SearchForm, StatusBadge, Table, Td, Th } from "@cba/ui";

export default async function Businesses({ searchParams }: { searchParams: Promise<{ q?: string; page?: string; status?: string; plan?: string }> }) {
  const sp = await searchParams;
  const a = await requireAdmin();
  const r = await listBusinesses(a, { q: sp.q, status: sp.status, plan: sp.plan, page: Number(sp.page ?? 1) });
  return (
    <>
      <PageHeader title="Businesses" subtitle="Account-level information only. Customer and invoice records are not visible here." />
      <Card>
        <SearchForm action="/businesses" q={sp.q} placeholder="Name, GSTIN, owner email, city" />
        <Table>
          <thead><tr><Th>Business</Th><Th>Owner</Th><Th>Plan</Th><Th align="right">Members</Th><Th align="right">Invoices (30d)</Th><Th>Last activity</Th><Th>Status</Th></tr></thead>
          <tbody>
            {(r.items as Array<Record<string, string | number | null>>).map((b) => (
              <tr key={b.id as string}>
                <Td><Link className="font-medium text-brand-700" href={`/businesses/${b.id}`}>{b.name}</Link><div className="text-xs text-muted">{[b.city, b.gstin].filter(Boolean).join(" · ")} · since {formatDateIN(b.createdAt as string)}</div></Td>
                <Td className="text-sm">{b.ownerEmail}</Td>
                <Td>{b.planName} <StatusBadge status={b.subscriptionStatus as string} /></Td>
                <Td align="right">{b.members}</Td>
                <Td align="right">{b.invoices30d}</Td>
                <Td className="text-xs">{formatDateTimeIN(b.lastActivity as string)}</Td>
                <Td><StatusBadge status={b.status as string} /></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
