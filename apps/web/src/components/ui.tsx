import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { formatINR, STATUS_LABEL } from "@cba/core";

export function cn(...c: Array<string | false | null | undefined>) {
  return c.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "ghost" | "danger" | "success";
type Size = "sm" | "md" | "lg";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand-600 text-white hover:bg-brand-700 shadow-sm shadow-brand-600/20 disabled:bg-brand-300",
  secondary: "bg-white text-ink border border-line hover:bg-stone-50 hover:border-stone-300 disabled:text-stone-400",
  ghost: "text-ink hover:bg-stone-100 disabled:text-stone-400",
  danger: "bg-white text-red-700 border border-red-200 hover:bg-red-50 disabled:text-red-300",
  success: "bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-emerald-300",
};
const SIZES: Record<Size, string> = { sm: "h-8 px-3 text-sm gap-1.5", md: "h-10 px-4 text-sm gap-2", lg: "h-12 px-5 text-base gap-2" };

export function buttonClass(variant: Variant = "primary", size: Size = "md", extra?: string) {
  return cn("inline-flex items-center justify-center rounded-lg font-medium transition-colors disabled:cursor-not-allowed whitespace-nowrap", VARIANTS[variant], SIZES[size], extra);
}

export function Button({ variant = "primary", size = "md", className, ...p }: ComponentProps<"button"> & { variant?: Variant; size?: Size }) {
  return <button {...p} className={buttonClass(variant, size, className)} />;
}

export function LinkButton({ variant = "primary", size = "md", className, ...p }: ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return <Link {...p} className={buttonClass(variant, size, className)} />;
}

export function Card({ className, children, ...p }: ComponentProps<"div">) {
  return (
    <div {...p} className={cn("min-w-0 rounded-[14px] border border-line bg-white", className)}>
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, action }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {back && (
          <Link href={back.href} className="mb-1 inline-flex items-center text-sm text-muted hover:text-brand-700">
            ← {back.label}
          </Link>
        )}
        <h1 className="truncate text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

const BADGE: Record<string, string> = {
  gray: "bg-stone-100 text-stone-700 ring-stone-200",
  orange: "bg-brand-50 text-brand-800 ring-brand-200",
  green: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  red: "bg-red-50 text-red-700 ring-red-200",
  blue: "bg-sky-50 text-sky-800 ring-sky-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  violet: "bg-violet-50 text-violet-800 ring-violet-200",
};
export function Badge({ color = "gray", children, className }: { color?: keyof typeof BADGE; children: ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", BADGE[color], className)}>{children}</span>;
}

const STATUS_COLOR: Record<string, keyof typeof BADGE> = {
  draft: "gray", sent: "blue", accepted: "green", rejected: "red", expired: "amber", issued: "orange", partially_paid: "amber", paid: "green",
  overdue: "red", cancelled: "gray", converted: "violet", fulfilled: "green", partially_received: "amber", received: "green",
  active: "green", void: "gray", open: "orange", assigned: "blue", in_progress: "violet", on_hold: "amber", completed: "green", renewed: "violet",
  pending: "amber", approved: "green", used: "gray", trialing: "blue", past_due: "red",
};
export function StatusBadge({ status, overdue }: { status: string; overdue?: boolean }) {
  if (overdue) return <Badge color="red">Overdue</Badge>;
  const label = (STATUS_LABEL as Record<string, string>)[status] ?? status.replace(/_/g, " ").replace(/^\w/, (x) => x.toUpperCase());
  return <Badge color={STATUS_COLOR[status] ?? "gray"}>{label}</Badge>;
}

export function Money({ value, className, colored }: { value: string | number | null | undefined; className?: string; colored?: boolean }) {
  if (value === null || value === undefined) return <span className="text-muted">—</span>;
  const n = Number(value);
  return <span className={cn("tabular whitespace-nowrap", colored && n < 0 && "text-red-700", colored && n > 0 && "text-ink", className)}>{formatINR(value)}</span>;
}

export function Stat({ label, value, hint, tone = "default", href }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "default" | "brand" | "good" | "bad"; href?: string }) {
  const body = (
    <div className={cn("h-full rounded-[14px] border bg-white p-4 transition-colors", tone === "brand" ? "border-brand-200 bg-gradient-to-b from-brand-50 to-white" : "border-line", href && "hover:border-brand-300")}>
      <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className={cn("mt-1.5 text-xl font-semibold tabular sm:text-2xl", tone === "bad" && "text-red-700", tone === "good" && "text-emerald-700")}>{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
  return href ? (
    <Link href={href} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}

export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      {icon && <div className="mb-3 grid h-12 w-12 place-items-center rounded-full bg-brand-50 text-brand-600">{icon}</div>}
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      {body && <p className="mt-1 max-w-md text-sm text-muted">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full min-w-[640px] border-collapse text-sm">{children}</table>
    </div>
  );
}
export function Th({ children, className, align }: { children?: ReactNode; className?: string; align?: "left" | "right" | "center" }) {
  return <th className={cn("border-b border-line bg-stone-50/70 px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted first:pl-4 last:pr-4 sm:first:pl-5 sm:last:pr-5", align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left", className)}>{children}</th>;
}
export function Td({ children, className, align }: { children?: ReactNode; className?: string; align?: "left" | "right" | "center" }) {
  return <td className={cn("border-b border-line/70 px-3 py-3 align-middle first:pl-4 last:pr-4 sm:first:pl-5 sm:last:pr-5", align === "right" ? "text-right" : align === "center" ? "text-center" : "", className)}>{children}</td>;
}

export const inputClass =
  "block w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink shadow-xs placeholder:text-stone-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:bg-stone-50 disabled:text-stone-500 aria-[invalid=true]:border-red-400";

export function Field({ label, hint, error, children, required, className }: { label: ReactNode; hint?: ReactNode; error?: string | null; children: ReactNode; required?: boolean; className?: string }) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1 block text-sm font-medium text-ink">
        {label}
        {required && <span className="text-brand-600"> *</span>}
      </span>
      {children}
      {error ? <span className="mt-1 block text-xs text-red-700">{error}</span> : hint ? <span className="mt-1 block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

export function Input(p: ComponentProps<"input">) {
  return <input {...p} className={cn(inputClass, p.className)} />;
}
export function Select(p: ComponentProps<"select">) {
  return <select {...p} className={cn(inputClass, "pr-8", p.className)} />;
}
export function Textarea(p: ComponentProps<"textarea">) {
  return <textarea rows={3} {...p} className={cn(inputClass, p.className)} />;
}

export function Tabs({ tabs, active }: { tabs: Array<{ href: string; label: ReactNode; key: string }>; active: string }) {
  return (
    <div className="mb-4 flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} className={cn("-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium", t.key === active ? "border-brand-600 text-brand-700" : "border-transparent text-muted hover:text-ink")}>
          {t.label}
        </Link>
      ))}
    </div>
  );
}

export function Pagination({ page, pageSize, total, hrefFor }: { page: number; pageSize: number; total: number; hrefFor: (p: number) => string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-between border-t border-line px-4 py-3 text-sm sm:px-5">
      <span className="text-muted">
        {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
      </span>
      <div className="flex gap-2">
        {page > 1 ? <LinkButton href={hrefFor(page - 1)} variant="secondary" size="sm">Previous</LinkButton> : null}
        {page < pages ? <LinkButton href={hrefFor(page + 1)} variant="secondary" size="sm">Next</LinkButton> : null}
      </div>
    </div>
  );
}

export function ErrorPanel({ code, message }: { code: string; message: string }) {
  if (code === "FEATURE_NOT_IN_PLAN" || code === "PLAN_LIMIT") {
    return (
      <Card className="border-brand-200">
        <EmptyState icon={<span className="text-lg">★</span>} title="Upgrade to unlock this" body={message} action={<LinkButton href="/settings/billing">See plans</LinkButton>} />
      </Card>
    );
  }
  if (code === "FORBIDDEN") {
    return (
      <Card>
        <EmptyState icon={<span className="text-lg">🔒</span>} title="You don't have access" body={`${message}. Ask the business owner to change your role.`} />
      </Card>
    );
  }
  return (
    <Card>
      <EmptyState title="Something went wrong" body={message} />
    </Card>
  );
}

export function SearchForm({ action, q, placeholder = "Search…", children }: { action: string; q?: string; placeholder?: string; children?: ReactNode }) {
  return (
    <form action={action} method="get" className="flex flex-col gap-2 border-b border-line p-3 sm:flex-row sm:items-center sm:px-5">
      <input name="q" defaultValue={q} placeholder={placeholder} className={cn(inputClass, "sm:max-w-xs")} aria-label="Search" />
      {children}
      <Button type="submit" variant="secondary" size="md">
        Apply
      </Button>
    </form>
  );
}

export function DefinitionList({ items }: { items: Array<[ReactNode, ReactNode]> }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
      {items.map(([k, v], i) => (
        <div key={i} className="min-w-0">
          <dt className="text-xs font-medium uppercase tracking-wide text-muted">{k}</dt>
          <dd className="mt-0.5 break-words text-ink">{v || <span className="text-muted">—</span>}</dd>
        </div>
      ))}
    </dl>
  );
}
