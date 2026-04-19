export function StatCard({
  label,
  value,
  sub,
  compact,
}: {
  label: string;
  value: string | number;
  sub?: string;
  /** Smaller padding and type — e.g. secondary metrics on the overview page. */
  compact?: boolean;
}) {
  return (
    <div
      className={`bg-zinc-900 border border-zinc-800 rounded-lg ${compact ? "p-3" : "p-4"}`}
    >
      <div
        className={`text-zinc-500 uppercase tracking-wide ${compact ? "text-[10px]" : "text-xs"}`}
      >
        {label}
      </div>
      <div
        className={`font-bold text-zinc-100 mt-0.5 ${compact ? "text-lg" : "text-2xl mt-1"}`}
      >
        {value}
      </div>
      {sub && (
        <div className={`text-zinc-500 mt-0.5 ${compact ? "text-[10px]" : "text-xs mt-1"}`}>
          {sub}
        </div>
      )}
    </div>
  );
}
