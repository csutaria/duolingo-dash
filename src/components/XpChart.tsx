"use client";

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

interface XpChartProps {
  data: Array<Record<string, unknown>>;
  dataKey?: string;
  height?: number;
  domainStart?: number;
}

export function XpChart({ data, dataKey = "gained_xp", height = 300, domainStart }: XpChartProps) {
  if (!data.length) {
    return <div className="text-zinc-500 text-sm">No XP data yet</div>;
  }

  // Parse date string (YYYY-MM-DD or YYYY-MM-DD HH:MM:SS) as local noon to avoid TZ shifts
  const toTimestamp = (d: Record<string, unknown>): number => {
    const dateStr = String(d.date ?? d.snapshot_time ?? "").split(" ")[0];
    const [y, m, day] = dateStr.split("-").map(Number);
    return new Date(y, m - 1, day, 12).getTime();
  };

  const dateKey = (d: Record<string, unknown>) =>
    String(d.date ?? d.snapshot_time ?? "").split(" ")[0];

  // Deduplicate to one point per calendar day (last snapshot wins)
  const byDay = new Map<string, Record<string, unknown>>();
  for (const d of data) byDay.set(dateKey(d), d);

  const withTime = [...byDay.values()]
    .map((d) => ({ ...d, _t: toTimestamp(d) }))
    .sort((a, b) => a._t - b._t);

  const formatTs = (ts: number) => {
    const d = new Date(ts);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={withTime} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
        <defs>
          <linearGradient id="xpGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#58cc02" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#58cc02" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
        <XAxis
          dataKey="_t"
          type="number"
          scale="time"
          domain={domainStart ? [domainStart, Date.now()] : ["dataMin", "dataMax"]}
          tick={{ fill: "#71717a", fontSize: 11 }}
          tickFormatter={formatTs}
          minTickGap={40}
        />
        <YAxis tick={{ fill: "#71717a", fontSize: 11 }} width={45} />
        <Tooltip
          contentStyle={{
            backgroundColor: "#18181b",
            border: "1px solid #27272a",
            borderRadius: "6px",
            color: "#e4e4e7",
            fontSize: 12,
          }}
          labelFormatter={(ts) => {
            const d = new Date(Number(ts));
            return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
          }}
        />
        <Area
          type="monotone"
          dataKey={dataKey}
          stroke="#58cc02"
          fill="url(#xpGradient)"
          strokeWidth={2}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
