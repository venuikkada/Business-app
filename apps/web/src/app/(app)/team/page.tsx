import { team } from "@cba/server";
import { formatDateIN } from "@cba/core";
import { tenantOrError } from "@/lib/session";
import { ActionButton } from "@/components/client";
import { BranchEditor, InviteButton, MemberRow, RoleEditor } from "@/components/team/team-ui";
import { Badge, Card, CardHeader, ErrorPanel, PageHeader, Tabs } from "@/components/ui";

export const metadata = { title: "Team & roles" };

export default async function TeamPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const tab = (await searchParams).tab ?? "members";
  const res = await tenantOrError(async (t) => {
    t.require("team.view");
    const roles = (await team.listRoles(t)) as Array<{ id: string; name: string; key: string | null; description: string | null; permissions: string[]; isSystem: boolean; memberCount: number }>;
    const branches = (await team.listBranches(t)) as Array<{ id: string; name: string; code: string | null; gstin: string | null; phone: string | null; addressLine1: string | null; city: string | null; stateCode: string; pincode: string | null; isDefault: boolean; archivedAt: string | null }>;
    return {
      ...(await team.listMembers(t)),
      roles,
      branches,
      me: t.userId,
      myPerms: [...t.permissions],
      state: t.business.state_code,
      can: { invite: t.can("team.create") && !t.isSupport, del: t.can("team.delete") && !t.isSupport, employees: t.hasFeature("employees"), custom: t.hasFeature("custom_roles"), multi: t.hasFeature("multi_branch"), settings: t.can("settings.edit") },
      seats: t.plan.limits.users,
    };
  });
  if (!res.ok) return <ErrorPanel code={res.code} message={res.message} />;
  const d = res.data;
  const members = d.members as Array<{ id: string; userId: string; fullName: string; email: string; roleId: string; roleKey: string | null; status: string; lastLoginAt: string | null }>;
  const invites = d.invitations as Array<{ id: string; email: string; roleName: string; expiresAt: string }>;
  const activeBranches = d.branches.filter((b) => !b.archivedAt);
  return (
    <>
      <PageHeader
        title="Team & roles"
        subtitle={`${members.filter((m) => m.status === "active").length} active user(s)${d.seats ? ` of ${d.seats} on your plan` : ""}`}
        actions={tab === "members" && d.can.invite && <InviteButton roles={d.roles} branches={activeBranches} disabled={d.can.employees ? null : "Employee logins are available on the Pro plan"} />}
      />
      <Tabs active={tab} tabs={[{ key: "members", label: "Members", href: "/team" }, { key: "roles", label: "Roles & permissions", href: "/team?tab=roles" }, { key: "branches", label: "Branches", href: "/team?tab=branches" }]} />
      {tab === "members" && (
        <div className="space-y-5">
          {!d.can.employees && <Card className="border-brand-200 bg-brand-50 p-4 text-sm text-brand-900">Upgrade to Pro to give your staff their own logins with limited permissions.</Card>}
          <Card>
            <CardHeader title="Members" />
            <div className="divide-y divide-line">{members.map((m) => <MemberRow key={m.id} m={m} roles={d.roles} isMe={m.userId === d.me} />)}</div>
          </Card>
          {invites.length > 0 && (
            <Card>
              <CardHeader title="Pending invitations" />
              <ul className="divide-y divide-line text-sm">
                {invites.map((i) => (
                  <li key={i.id} className="flex items-center justify-between px-5 py-3">
                    <span>{i.email} <Badge>{i.roleName}</Badge> <span className="text-xs text-muted">expires {formatDateIN(i.expiresAt)}</span></span>
                    {d.can.del && <ActionButton size="sm" variant="ghost" method="DELETE" path={`team/invitations/${i.id}`} success="Invitation revoked">Revoke</ActionButton>}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}
      {tab === "roles" && (
        <Card>
          <CardHeader title="Roles" subtitle="Each role is a set of permissions checked by the server" action={<RoleEditor role={null} myPermissions={d.myPerms} canCustom={d.can.custom} />} />
          <ul className="divide-y divide-line">
            {d.roles.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div>
                  <div className="font-medium">{r.name} {r.isSystem ? <Badge>Built-in</Badge> : <Badge color="violet">Custom</Badge>}</div>
                  <div className="text-xs text-muted">{r.description} · {r.permissions.length} permissions · {r.memberCount} member(s)</div>
                </div>
                <div className="flex gap-1">
                  <RoleEditor role={r} myPermissions={d.myPerms} canCustom={d.can.custom} />
                  {!r.isSystem && d.can.del && <ActionButton size="sm" variant="ghost" method="DELETE" path={`roles/${r.id}`} success="Role deleted" confirm={{ title: `Delete role ${r.name}?`, danger: true }}>Delete</ActionButton>}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {tab === "branches" && (
        <Card>
          <CardHeader title="Branches" subtitle={d.can.multi ? "Stock and documents are tracked per branch" : "Multiple branches are available on the Business plan"} action={d.can.settings && <BranchEditor branch={null} defaultState={d.state} canCreate={d.can.multi} />} />
          <ul className="divide-y divide-line">
            {d.branches.map((b) => (
              <li key={b.id} className="flex items-center justify-between px-5 py-3">
                <div>
                  <div className="font-medium">{b.name} {b.isDefault && <Badge color="orange">Main</Badge>} {b.archivedAt && <Badge>Archived</Badge>}</div>
                  <div className="text-xs text-muted">{[b.city, b.gstin].filter(Boolean).join(" · ")}</div>
                </div>
                {d.can.settings && !b.archivedAt && (
                  <div className="flex gap-1">
                    <BranchEditor branch={b} defaultState={d.state} canCreate />
                    {!b.isDefault && <ActionButton size="sm" variant="ghost" path={`branches/${b.id}/archive`} success="Archived" confirm={{ title: `Archive ${b.name}?`, body: "Stock must be zero first." }}>Archive</ActionButton>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
