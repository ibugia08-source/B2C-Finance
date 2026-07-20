export default function Loading() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="h-8 w-64 rounded-md bg-muted" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="h-[480px] rounded-2xl bg-muted" />
        <div className="h-[480px] rounded-2xl bg-muted" />
      </div>
    </div>
  );
}
