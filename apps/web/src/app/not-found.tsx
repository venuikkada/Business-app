import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-4 text-center">
      <div>
        <p className="text-sm font-semibold text-brand-700">404</p>
        <h1 className="mt-2 text-2xl font-semibold">We couldn&apos;t find that page</h1>
        <p className="mt-2 text-muted">It may have been moved, or you may not have access.</p>
        <Link href="/dashboard" className="mt-6 inline-block rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white">Go to dashboard</Link>
      </div>
    </main>
  );
}
