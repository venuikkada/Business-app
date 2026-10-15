"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { LayoutDashboard, ReceiptIndianRupee, FileText, ClipboardList, Truck, Undo2, HandCoins, ShoppingCart, PackagePlus, PackageMinus, Users, Package, Warehouse, Wrench, CalendarClock, AlarmClock, Wallet, Landmark, ChartColumn, BadgeCheck, UserCog, Settings, Menu, Bell, Plus, ChevronsUpDown, Circle } from "lucide-react";

const ICONS: Record<string, React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>> = { LayoutDashboard, ReceiptIndianRupee, FileText, ClipboardList, Truck, Undo2, HandCoins, ShoppingCart, PackagePlus, PackageMinus, Users, Package, Warehouse, Wrench, CalendarClock, AlarmClock, Wallet, Landmark, ChartColumn, BadgeCheck, UserCog, Settings, Menu, Bell, Plus, ChevronsUpDown, Circle };
import { NAV, QUICK_CREATE } from "./nav";
import { cn } from "./ui";
import { api } from "@/lib/api-client";
import { ToastProvider } from "./client";

export interface ShellProps {
  children: ReactNode;
  businessName: string;
  userName: string;
  userEmail: string;
  roleName: string;
  permissions: string[];
  planName: string;
  planStatus: string;
  trialEndsAt: string | null;
  unread: number;
  pendingApprovals: number;
  multipleBusinesses: boolean;
  isSupport: boolean;
  suspended: boolean;
}

function Icon({ name, className }: { name: string; className?: string }) {
  const C = ICONS[name] ?? Circle;
  return <C className={className ?? "h-4 w-4"} aria-hidden />;
}

function useClickOutside(onOut: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOut();
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [onOut]);
  return ref;
}

export function Shell(p: ShellProps) {
  const path = usePathname();
  const router = useRouter();
  const can = (perm?: string) => !perm || p.permissions.includes(perm);
  const [menu, setMenu] = useState<null | "new" | "user">(null);
  const ref = useClickOutside(() => setMenu(null));
  const isActive = (href: string, match?: string) => {
    const base = (match ?? href).split("?")[0]!;
    return path === base || path.startsWith(base + "/");
  };
  const trialDays = p.planStatus === "trialing" && p.trialEndsAt ? Math.max(0, Math.ceil((Date.parse(p.trialEndsAt) - Date.now()) / 86_400_000)) : null;

  const sidebar = (
    <nav className="flex flex-col gap-5 px-3 py-4" aria-label="Main">
      {NAV.map((g) => {
        const items = g.items.filter((i) => can(i.perm));
        if (!items.length) return null;
        return (
          <div key={g.label || "main"}>
            {g.label && <div className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted">{g.label}</div>}
            {items.map((i) => (
              <Link key={i.href} href={i.href} className={cn("flex items-center gap-3 rounded-lg px-3 py-2 text-sm", isActive(i.href, i.match) ? "bg-brand-50 font-medium text-brand-800" : "text-stone-700 hover:bg-stone-100")}>
                <Icon name={i.icon} className={cn("h-4 w-4", isActive(i.href, i.match) ? "text-brand-600" : "text-stone-400")} />
                <span className="flex-1">{i.label}</span>
                {i.href === "/approvals" && p.pendingApprovals > 0 && <span className="rounded-full bg-brand-600 px-1.5 text-[11px] font-semibold text-white">{p.pendingApprovals}</span>}
              </Link>
            ))}
          </div>
        );
      })}
    </nav>
  );

  const bottom = [
    { href: "/dashboard", label: "Home", icon: "LayoutDashboard", perm: "dashboard.view" },
    { href: "/documents/invoice", label: "Sales", icon: "ReceiptIndianRupee", perm: "invoices.view" },
    { href: "/products", label: "Inventory", icon: "Package", perm: "products.view" },
    { href: "/parties", label: "Customers", icon: "Users", perm: "parties.view" },
    { href: "/more", label: "More", icon: "Menu" },
  ].filter((i) => can(i.perm));

  return (
    <ToastProvider>
      <div className="flex min-h-dvh">
        <aside className="no-print sticky top-0 hidden h-dvh w-64 shrink-0 overflow-y-auto border-r border-line bg-white lg:block">
          <Link href="/dashboard" className="flex items-center gap-2 border-b border-line px-5 py-4">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-sm font-bold text-white">C</span>
            <span className="text-sm font-semibold leading-tight">
              CRAZY BUSINESS APP
              <span className="block text-[11px] font-normal text-muted">One App. Complete Business Control.</span>
            </span>
          </Link>
          {sidebar}
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          {(p.isSupport || p.suspended) && (
            <div className="no-print bg-amber-100 px-4 py-2 text-center text-sm text-amber-900">
              {p.isSupport ? "Support session — read-only access granted by the business owner." : "This business is suspended. Data is read-only. Contact support."}
            </div>
          )}
          {trialDays !== null && trialDays <= 7 && !p.isSupport && (
            <div className="no-print bg-brand-50 px-4 py-2 text-center text-sm text-brand-900">
              {trialDays === 0 ? "Your Pro trial ends today." : `${trialDays} day${trialDays === 1 ? "" : "s"} left in your Pro trial.`}{" "}
              <Link href="/settings/billing" className="font-medium underline">Choose a plan</Link>
            </div>
          )}
          <header className="no-print sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-line bg-white/90 px-3 backdrop-blur sm:px-5" ref={ref}>
            <Link href={p.multipleBusinesses ? "/select-business" : "/settings"} className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-stone-100">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-brand-100 text-xs font-bold text-brand-800 lg:hidden">C</span>
              <span className="truncate text-sm font-semibold">{p.businessName}</span>
              {p.multipleBusinesses && <ChevronsUpDown className="h-3.5 w-3.5 text-muted" aria-hidden />}
            </Link>
            <span className="hidden rounded-full bg-stone-100 px-2 py-0.5 text-[11px] text-muted sm:inline">{p.planName}</span>
            <div className="flex-1" />
            {QUICK_CREATE.some((q) => can(q.perm)) && !p.isSupport && (
              <div className="relative">
                <button onClick={() => setMenu(menu === "new" ? null : "new")} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-600 px-3 text-sm font-medium text-white hover:bg-brand-700" aria-haspopup="menu" aria-expanded={menu === "new"}>
                  <Plus className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">New</span>
                </button>
                {menu === "new" && (
                  <div role="menu" className="animate-in absolute right-0 mt-2 w-52 rounded-xl border border-line bg-white p-1 shadow-lg">
                    {QUICK_CREATE.filter((q) => can(q.perm)).map((q) => (
                      <Link key={q.href} role="menuitem" href={q.href} onClick={() => setMenu(null)} className="block rounded-lg px-3 py-2 text-sm hover:bg-brand-50">
                        {q.label}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            )}
            <Link href="/notifications" className="relative grid h-9 w-9 place-items-center rounded-lg hover:bg-stone-100" aria-label={`Notifications (${p.unread} unread)`}>
              <Bell className="h-5 w-5 text-stone-600" aria-hidden />
              {p.unread > 0 && <span className="absolute right-1 top-1 min-w-4 rounded-full bg-brand-600 px-1 text-center text-[10px] font-semibold leading-4 text-white">{p.unread > 99 ? "99+" : p.unread}</span>}
            </Link>
            <div className="relative">
              <button onClick={() => setMenu(menu === "user" ? null : "user")} className="grid h-9 w-9 place-items-center rounded-full bg-stone-800 text-sm font-semibold text-white" aria-label="Account menu" aria-haspopup="menu" aria-expanded={menu === "user"}>
                {p.userName.slice(0, 1).toUpperCase()}
              </button>
              {menu === "user" && (
                <div role="menu" className="animate-in absolute right-0 mt-2 w-60 rounded-xl border border-line bg-white p-1 shadow-lg">
                  <div className="px-3 py-2">
                    <div className="truncate text-sm font-medium">{p.userName}</div>
                    <div className="truncate text-xs text-muted">{p.userEmail}</div>
                    <div className="mt-1 text-xs text-brand-700">{p.roleName}</div>
                  </div>
                  <Link role="menuitem" href="/settings/security" onClick={() => setMenu(null)} className="block rounded-lg px-3 py-2 text-sm hover:bg-stone-100">Profile & security</Link>
                  {p.multipleBusinesses && <Link role="menuitem" href="/select-business" className="block rounded-lg px-3 py-2 text-sm hover:bg-stone-100">Switch business</Link>}
                  <Link role="menuitem" href="/settings/support" onClick={() => setMenu(null)} className="block rounded-lg px-3 py-2 text-sm hover:bg-stone-100">Help & support</Link>
                  <button
                    role="menuitem"
                    className="block w-full rounded-lg px-3 py-2 text-left text-sm text-red-700 hover:bg-red-50"
                    onClick={async () => {
                      await api("POST", "auth/logout").catch(() => undefined);
                      router.push("/login");
                      router.refresh();
                    }}
                  >
                    Sign out
                  </button>
                </div>
              )}
            </div>
          </header>
          <main className="mx-auto w-full max-w-7xl flex-1 px-3 pb-24 pt-5 sm:px-6 lg:pb-10">{p.children}</main>
        </div>
        <nav className="no-print fixed inset-x-0 bottom-0 z-30 grid border-t border-line bg-white pb-[env(safe-area-inset-bottom)] lg:hidden" style={{ gridTemplateColumns: `repeat(${bottom.length}, minmax(0, 1fr))` }} aria-label="Bottom">
          {bottom.map((i) => (
            <Link key={i.href} href={i.href} className={cn("flex flex-col items-center gap-0.5 py-2 text-[11px]", isActive(i.href) ? "text-brand-700" : "text-stone-500")}>
              <Icon name={i.icon} className="h-5 w-5" />
              {i.label}
            </Link>
          ))}
        </nav>
      </div>
    </ToastProvider>
  );
}

export function MoreMenu({ permissions }: { permissions: string[] }) {
  const can = (perm?: string) => !perm || permissions.includes(perm);
  return (
    <div className="space-y-5">
      {NAV.map((g) => {
        const items = g.items.filter((i) => can(i.perm));
        if (!items.length) return null;
        return (
          <div key={g.label || "main"}>
            {g.label && <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">{g.label}</h2>}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {items.map((i) => (
                <Link key={i.href} href={i.href} className="flex items-center gap-2 rounded-xl border border-line bg-white p-3 text-sm hover:border-brand-300">
                  <Icon name={i.icon} className="h-5 w-5 text-brand-600" />
                  {i.label}
                </Link>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
