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
      className={`rounded-md border border-zinc-800 bg-zinc-900 ${
        compact ? "p-2 sm:rounded-lg sm:p-3" : "p-2 sm:rounded-lg sm:p-4"
      }`}
    >
      <div
        className={`uppercase leading-tight tracking-wide text-zinc-500 ${
          compact ? "text-[8px] sm:text-[10px]" : "text-[8px] sm:text-xs"
        }`}
      >
        {label}
      </div>
      <div
        className={`mt-0.5 font-bold leading-tight text-zinc-100 ${
          compact ? "text-sm sm:text-lg" : "text-base sm:mt-1 sm:text-2xl"
        }`}
      >
        {value}
      </div>
      {sub && (
        <div className={`mt-0.5 hidden text-zinc-500 sm:block ${
          compact ? "text-[10px]" : "sm:mt-1 sm:text-xs"
        }`}>
          {sub}
        </div>
      )}
    </div>
  );
}
