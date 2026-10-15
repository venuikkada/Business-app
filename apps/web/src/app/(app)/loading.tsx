export default function Loading() {
  return (
    <div className="animate-pulse space-y-4" aria-busy="true" aria-label="Loading">
      <div className="h-8 w-48 rounded-lg bg-stone-200" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="h-24 rounded-2xl bg-stone-100" />)}</div>
      <div className="h-72 rounded-2xl bg-stone-100" />
    </div>
  );
}
