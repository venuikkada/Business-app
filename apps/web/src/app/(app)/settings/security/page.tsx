import { auth } from "@cba/server";
import { formatDateTimeIN } from "@cba/core";
import { requireAuth } from "@/lib/session";
import { ActionButton } from "@/components/client";
import { DangerCard, PasswordCard, ProfileCard, TotpCard } from "@/components/settings/account";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui";

export const metadata = { title: "Profile & security" };

export default async function SecurityPage() {
  const a = await requireAuth();
  const sessions = (await auth.listSessions(a.user.id)) as Array<Record<string, string>>;
  return (
    <>
      <PageHeader back={{ href: "/settings", label: "Settings" }} title="Profile & security" />
      <div className="space-y-5">
        <ProfileCard fullName={a.user.fullName} phone={a.user.phone} email={a.user.email} verified={a.user.emailVerified} />
        <PasswordCard />
        <TotpCard enabled={a.user.totpEnabled} />
        <Card>
          <CardHeader title="Where you're signed in" />
          <ul className="divide-y divide-line text-sm">
            {sessions.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <div className="truncate">{s.user_agent ?? "Unknown device"} {s.id === a.session.id && <Badge color="green">This device</Badge>} <Badge>{s.kind}</Badge></div>
                  <div className="text-xs text-muted">{s.ip ?? ""} · last active {formatDateTimeIN(s.last_seen_at)}</div>
                </div>
                {s.id !== a.session.id && <ActionButton size="sm" variant="ghost" method="DELETE" path={`me/sessions/${s.id}`} success="Signed out">Sign out</ActionButton>}
              </li>
            ))}
          </ul>
        </Card>
        <DangerCard kind="account" />
      </div>
    </>
  );
}
