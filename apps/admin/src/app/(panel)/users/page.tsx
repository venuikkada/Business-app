import { listUsers } from "@cba/server/platform";
import { formatDateTimeIN } from "@cba/core";
import { requireAdmin } from "@/lib/session";
import { AdminAction } from "@/components/client";
import { Badge, Card, PageHeader, SearchForm, StatusBadge, Table, Td, Th } from "@cba/ui";

export default async function Users({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const sp = await searchParams;
  const a = await requireAdmin();
  const r = await listUsers(a, { q: sp.q, page: Number(sp.page ?? 1) });
  return (
    <>
      <PageHeader title="Users" />
      <Card>
        <SearchForm action="/users" q={sp.q} placeholder="Email, name or phone" />
        <Table>
          <thead><tr><Th>User</Th><Th align="right">Businesses</Th><Th>Security</Th><Th>Last login</Th><Th>Status</Th><Th /></tr></thead>
          <tbody>
            {(r.items as Array<Record<string, string | number | boolean | null>>).map((u) => (
              <tr key={u.id as string}>
                <Td><div className="font-medium">{u.fullName}</div><div className="text-xs text-muted">{u.email} {u.isPlatformAdmin ? <Badge color="violet">Admin</Badge> : null}</div></Td>
                <Td align="right">{u.businesses}</Td>
                <Td>{u.emailVerifiedAt ? <Badge color="green">Verified</Badge> : <Badge>Unverified</Badge>} {u.totpEnabledAt ? <Badge color="blue">2FA</Badge> : null}</Td>
                <Td className="text-xs">{formatDateTimeIN(u.lastLoginAt as string)}</Td>
                <Td><StatusBadge status={u.status === "disabled" ? "cancelled" : (u.status as string)} /></Td>
                <Td>{u.status === "active" && u.id !== a.user.id ? <AdminAction danger path={`users/${u.id}/status`} body={{ status: "disabled" }} label="Disable" /> : u.status === "disabled" ? <AdminAction path={`users/${u.id}/status`} body={{ status: "active" }} label="Enable" /> : null}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
