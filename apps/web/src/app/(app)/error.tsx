"use client";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="mt-2 text-sm text-muted">Your data is safe. Please try again. If this keeps happening, contact support with code {error.digest ?? "—"}.</p>
      <button onClick={reset} className="mt-6 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white">Try again</button>
    </div>
  );
}
