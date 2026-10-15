import Link from "next/link";
import { ToastProvider } from "@/components/client";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <div className="grid min-h-dvh lg:grid-cols-2">
        <div className="flex flex-col px-5 py-8 sm:px-10">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-sm font-bold text-white">C</span>
            CRAZY BUSINESS APP
          </Link>
          <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">{children}</div>
          <p className="text-center text-xs text-muted">
            <Link href="/privacy" className="hover:underline">Privacy</Link> · <Link href="/terms" className="hover:underline">Terms</Link>
          </p>
        </div>
        <div className="relative hidden overflow-hidden bg-brand-600 lg:block">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.18),transparent_55%)]" />
          <div className="relative flex h-full flex-col justify-end p-12 text-white">
            <p className="text-sm font-medium uppercase tracking-widest text-brand-100">One App. Complete Business Control.</p>
            <h2 className="mt-3 max-w-md text-3xl font-semibold leading-tight">GST-ready billing, stock, payments and service — built for Indian shops.</h2>
            <ul className="mt-6 space-y-2 text-brand-50">
              <li>✓ Quotation to invoice in two taps</li>
              <li>✓ Stock that updates itself, with serial numbers & warranty</li>
              <li>✓ Know who owes you — and remind them on WhatsApp</li>
            </ul>
          </div>
        </div>
      </div>
    </ToastProvider>
  );
}
