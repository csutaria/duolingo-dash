"use client";

import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  ReferenceLine,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { CHART_TOTAL_COLOR, CHART_CEILING_COLOR } from "@/lib/colors";

interface StackedXpChartProps {
  data: Array<Record<string, unknown>>;
  courseIds: string[];
  colors: Record<string, string>;
  courseNames?: Record<string, string>;
  profileTotalXp: number;
  domainStart?: number;
  height?: number;
}

export function StackedXpChart({
  data,
  courseIds,
  colors,
  courseNames = {},
  profileTotalXp,
  domainStart,
  height = 350,
}: StackedXpChartProps) {
  if (!data.length || !courseIds.length) {
    return <div className="text-zinc-500 text-sm">No XP history yet</div>;
  }

  const withTime = data.map((d) => {
    const [y, m, day] = String(d.date).split("-").map(Number);
    return { ...d, _t: new Date(y, m - 1, day, 12).getTime() };
  });

  // Only render areas for courses with at least one non-zero value
  const activeCourseIds = courseIds.filter((id) =>
    data.some((d) => Number(d[id] ?? 0) > 0)
  );

  // Stack largest at bottom
  const sortedIds = [...activeCourseIds].sort(
    (a, b) =>
      Number(data[data.length - 1][b] ?? 0) -
      Number(data[data.length - 1][a] ?? 0)
  );

  const formatTs = (ts: number) => {
    const d = new Date(ts);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };

  const formatXp = (v: number) =>
    v >= 1000 ? `${Math.round(v / 1000)}k` : String(v);

  const domain: [number | string, number | string] = [
    domainStart ?? "dataMin",
    "dataMax",
  ];

  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={withTime} margin={{ top: 5, right: 16, left: 0, bottom: 5 }}>
          <defs>
            {sortedIds.map((id) => (
              <linearGradient key={id} id={`sg-${id}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={colors[id]} stopOpacity={0.55} />
                <stop offset="95%" stopColor={colors[id]} stopOpacity={0.15} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
          <XAxis
            dataKey="_t"
            type="number"
            scale="time"
            domain={domain}
            tick={{ fill: "#71717a", fontSize: 11 }}
            tickFormatter={formatTs}
            minTickGap={40}
          />
          <YAxis
            tick={{ fill: "#71717a", fontSize: 11 }}
            width={45}
            tickFormatter={formatXp}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#18181b",
              border: "1px solid #27272a",
              borderRadius: "6px",
              color: "#e4e4e7",
              fontSize: 11,
            }}
            labelFormatter={(ts) => {
              const d = new Date(Number(ts));
              return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
            }}
            formatter={(value: unknown, key: unknown) => {
              const k = String(key ?? "");
              if (k === "_total") return [Number(value).toLocaleString(), "Tracked total"];
              return [Number(value).toLocaleString(), courseNames[k] ?? k];
            }}
            itemSorter={(item) => -(Number(item.value) || 0)}
          />

          {sortedIds.map((id) => (
            <Area
              key={id}
              type="monotone"
              dataKey={id}
              stackId="xp"
              stroke={colors[id]}
              fill={`url(#sg-${id})`}
              strokeWidth={1}
              dot={false}
              isAnimationActive={false}
              name={courseNames[id] ?? id}
            />
          ))}

          <Line
            type="monotone"
            dataKey="_total"
            stroke={CHART_TOTAL_COLOR}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
            name="Tracked total"
          />

          {profileTotalXp > 0 && (
            <ReferenceLine
              y={profileTotalXp}
              stroke={CHART_CEILING_COLOR}
              strokeDasharray="4 4"
              strokeWidth={1}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>

      {/* Small inline legend for the two reference lines */}
      <div className="flex gap-4 mt-1 px-1 text-xs text-zinc-500 justify-end">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-5 h-px" style={{ backgroundColor: CHART_TOTAL_COLOR }} />
          Tracked
        </span>
        {profileTotalXp > 0 && (
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block w-5 h-px"
              style={{
                backgroundImage: `repeating-linear-gradient(to right, ${CHART_CEILING_COLOR} 0, ${CHART_CEILING_COLOR} 3px, transparent 3px, transparent 6px)`,
              }}
            />
            Duolingo total
          </span>
        )}
      </div>
    </div>
  );
}
