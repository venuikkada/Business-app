import Link from "next/link";
import { buttonClass } from "@/components/ui";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-white">
      <header className="sticky top-0 z-30 border-b border-line bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-sm font-bold text-white">C</span>
            <span className="hidden sm:inline">CRAZY BUSINESS APP</span>
          </Link>
          <nav className="flex items-center gap-1 text-sm sm:gap-4">
            <Link href="/pricing" className="px-2 text-stone-600 hover:text-ink">Pricing</Link>
            <Link href="/login" className="px-2 text-stone-600 hover:text-ink">Sign in</Link>
            <Link href="/register" className={buttonClass("primary", "sm")}>Start free</Link>
          </nav>
        </div>
      </header>
      {children}
      <footer className="border-t border-line bg-stone-50">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-8 text-sm text-muted sm:flex-row sm:justify-between">
          <div>© {new Date().getFullYear()} CRAZY BUSINESS APP · One App. Complete Business Control.</div>
          <div className="flex gap-4"><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><Link href="/pricing">Pricing</Link></div>
        </div>
      </footer>
    </div>
  );
}
