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
}

export function XpChart({ data, dataKey = "gained_xp", height = 300 }: XpChartProps) {
  if (!data.length) {
    return <div className="text-zinc-500 text-sm">No XP data yet</div>;
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
        <defs>
          <linearGradient id="xpGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#58cc02" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#58cc02" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
        <XAxis
          dataKey="date"
          tick={{ fill: "#71717a", fontSize: 11 }}
          tickFormatter={(v: string) => {
            const d = new Date(v);
            return `${d.getMonth() + 1}/${d.getDate()}`;
          }}
          interval="preserveStartEnd"
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
          labelFormatter={(v) => new Date(String(v)).toLocaleDateString()}
        />
        <Area
          type="monotone"
          dataKey={dataKey}
          stroke="#58cc02"
          fill="url(#xpGradient)"
          strokeWidth={2}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
