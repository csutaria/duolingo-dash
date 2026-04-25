interface MetaSeriesCardProps {
  title: string;
  value?: number;
  label: string;
  subtitle?: string;
  indicatorColor?: string;
  dimmed?: boolean;
}

export function MetaSeriesCard({
  title,
  value,
  label,
  subtitle,
  indicatorColor,
  dimmed,
}: MetaSeriesCardProps) {
  return (
    <div
      className={`relative rounded-lg p-5 ${
        dimmed
          ? "bg-zinc-900/40 border border-zinc-800/60 opacity-60"
          : "bg-zinc-900 border border-zinc-800"
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-zinc-100">{title}</h3>
          {subtitle && <p className="text-xs text-zinc-500 mt-1">{subtitle}</p>}
        </div>
        <div className="text-right">
          <div className="text-xl font-bold text-zinc-100">
            {value != null && value > 0 ? value.toLocaleString() : "—"}
          </div>
          <div className="text-xs text-zinc-500">{label}</div>
        </div>
      </div>
      {indicatorColor && (
        <span
          className="absolute bottom-3 right-3 w-2.5 h-2.5 rounded-full"
          style={{ backgroundColor: indicatorColor }}
        />
      )}
    </div>
  );
}
