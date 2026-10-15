import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/session";
import { buttonClass } from "@/components/ui";

export const metadata = { title: "CRAZY BUSINESS APP — GST billing, inventory & payments for Indian businesses" };

const FEATURES = [
  ["GST-ready invoices in seconds", "CGST/SGST or IGST worked out from the place of supply. HSN, rate-wise tax summary, amount in words, UPI QR code — printed or shared as PDF."],
  ["Quotation → order → invoice", "Convert an accepted quotation into an invoice without retyping a single line. Track sent, accepted, expired and converted quotes."],
  ["Stock that keeps itself right", "Every sale, purchase and return moves stock exactly once. Serial numbers, warranty dates, low-stock alerts and branch transfers."],
  ["Know who owes you", "Partial payments, aging buckets, overdue alerts and one-tap WhatsApp reminders with your UPI ID."],
  ["Service desk & AMC", "Complaint tickets, technician assignment, spare parts, warranty checks and AMC renewal reminders — built for CCTV, IT and electronics businesses."],
  ["Staff with the right access", "Owner, manager, accountant, salesperson, inventory and technician roles. Salespeople never see your cost price or profit."],
];

export default async function Landing() {
  if (await getAuth()) redirect("/dashboard");
  return (
    <main>
      <section className="relative overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-[480px] bg-gradient-to-b from-brand-50 to-white" />
        <div className="relative mx-auto max-w-6xl px-4 pb-16 pt-16 sm:pt-24">
          <p className="text-sm font-semibold uppercase tracking-widest text-brand-700">One App. Complete Business Control.</p>
          <h1 className="mt-3 max-w-3xl text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">Billing, stock, payments and service for your shop — on your phone and computer.</h1>
          <p className="mt-5 max-w-2xl text-lg text-stone-600">Made for Indian retailers, wholesalers, distributors, IT & CCTV dealers, computer shops and service businesses. Start in 2 minutes. No accountant needed to get going.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/register" className={buttonClass("primary", "lg")}>Start free — 14-day Pro trial</Link>
            <Link href="/pricing" className={buttonClass("secondary", "lg")}>See pricing</Link>
          </div>
          <p className="mt-3 text-sm text-muted">No card needed · Free plan forever · Your data is yours, export any time</p>
        </div>
      </section>
      <section className="mx-auto max-w-6xl px-4 pb-20">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(([t, b]) => (
            <div key={t} className="rounded-2xl border border-line p-6">
              <h3 className="font-semibold">{t}</h3>
              <p className="mt-2 text-sm leading-6 text-stone-600">{b}</p>
            </div>
          ))}
        </div>
        <div className="mt-12 rounded-2xl bg-ink px-6 py-10 text-center text-white sm:px-12">
          <h2 className="text-2xl font-semibold">Honest numbers, not guesses</h2>
          <p className="mx-auto mt-3 max-w-2xl text-stone-300">We show revenue, cash collected, gross profit and net profit separately — so you always know the difference between what you billed, what you received and what you earned.</p>
          <Link href="/register" className={`${buttonClass("primary", "lg")} mt-6`}>Create your free account</Link>
        </div>
        <p className="mt-8 text-center text-xs text-muted">GST-ready: invoices follow GST invoice rules. This app does not file returns or generate e-invoices (IRN) on the GST portal.</p>
      </section>
    </main>
  );
}
