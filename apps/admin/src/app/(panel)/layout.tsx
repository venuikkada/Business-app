import Link from "next/link";
import { requireAdmin } from "@/lib/session";
import { PostButton } from "@/components/client";

const NAV = [["/", "Overview"], ["/businesses", "Businesses"], ["/plans", "Plans & pricing"], ["/users", "Users"], ["/support", "Support desk"], ["/settings", "Platform settings"], ["/audit", "Audit log"]] as const;

export const dynamic = "force-dynamic";

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const a = await requireAdmin();
  return (
    <div className="flex min-h-dvh">
      <aside className="hidden w-56 shrink-0 bg-ink text-stone-300 md:block">
        <div className="px-5 py-5 font-semibold text-white">CBA · Platform</div>
        <nav className="space-y-1 px-3">{NAV.map(([h, l]) => <Link key={h} href={h} className="block rounded-lg px-3 py-2 text-sm hover:bg-white/10 hover:text-white">{l}</Link>)}</nav>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="flex h-14 items-center justify-between border-b border-line bg-white px-5">
          <nav className="flex gap-3 overflow-x-auto text-sm md:hidden">{NAV.map(([h, l]) => <Link key={h} href={h} className="whitespace-nowrap">{l}</Link>)}</nav>
          <span className="hidden text-sm text-muted md:inline">Signed in as {a.user.email} · tenant business data is not accessible from here</span>
          <PostButton path="logout" label="Sign out" variant="ghost" />
        </header>
        <main className="mx-auto max-w-7xl p-5">{children}</main>
      </div>
    </div>
  );
}
