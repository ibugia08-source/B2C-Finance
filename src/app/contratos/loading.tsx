export default function Loading() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="h-8 w-56 rounded-md bg-muted" />
      <div className="h-16 rounded-xl bg-muted" />
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={`contract-card-${i}`} className="h-48 rounded-xl bg-muted" />
        ))}
      </div>
    </div>
  );
}
