"use client";

import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceArea,
  ReferenceLine,
} from "recharts";

const FIRE_COLOR = "#ff9600";
const ICE_COLOR = "#1cb0f6";
const GRAY_COLOR = "#3f3f46";
const EPOCH_START_COLOR = "#3b82f6";
const EPOCH_END_COLOR = "#ef4444";
const HALF_DAY = 12 * 60 * 60 * 1000;

interface StreakEpoch {
  streak_start_date: string;
  streak_end_date: string | null;
}

interface DailyMetricChartProps {
  data: Array<Record<string, unknown>>;
  metric: "time" | "sessions";
  domainStart?: number;
  height?: number;
  streakEpochs?: StreakEpoch[];
}

function toNoon(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d, 12).getTime();
}

export function DailyMetricChart({
  data,
  metric,
  domainStart,
  height = 300,
  streakEpochs,
}: DailyMetricChartProps) {
  const epochs = streakEpochs ?? [];
  if (!data.length) {
    return <div className="text-zinc-500 text-sm">No data yet</div>;
  }

  const withTime = data.map((d) => {
    const t = toNoon(String(d.date));
    const value =
      metric === "time"
        ? Math.round(Number(d.total_session_time || 0) / 60)
        : Number(d.num_sessions || 0);
    return { ...d, _t: t, _value: value };
  });

  const domain: [number, number] = [
    domainStart ?? withTime[0]._t - HALF_DAY,
    withTime[withTime.length - 1]._t + HALF_DAY,
  ];

  const formatTs = (ts: number) => {
    const d = new Date(ts);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };

  const hasEpochEnds = epochs.some((e) => e.streak_end_date);

  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={withTime} margin={{ top: 5, right: 16, left: 0, bottom: 5 }}>
          <defs>
            <linearGradient id="metricGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#a1a1aa" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#a1a1aa" stopOpacity={0.05} />
            </linearGradient>
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
            tickFormatter={(v) => (metric === "time" ? `${v}m` : String(v))}
          />
          <Tooltip
            wrapperStyle={{ zIndex: 50 }}
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
            formatter={(value: unknown) => [
              metric === "time" ? `${value}m` : String(value),
              metric === "time" ? "Study time" : "Sessions",
            ]}
          />

          {/* Per-day streak background */}
          {withTime.map((d) => {
            const color =
              d.streak_extended
                ? FIRE_COLOR
                : Number(d.frozen) || Number(d.implied_freeze)
                  ? ICE_COLOR
                  : GRAY_COLOR;
            return (
              <ReferenceArea
                key={String(d.date)}
                x1={d._t - HALF_DAY}
                x2={d._t + HALF_DAY}
                fill={color}
                fillOpacity={0.18}
                stroke="none"
              />
            );
          })}

          {/* Epoch start lines (blue) and end lines (red) */}
          {epochs.flatMap((epoch) => {
            const lines = [
              <ReferenceLine
                key={`start-${epoch.streak_start_date}`}
                x={toNoon(epoch.streak_start_date)}
                stroke={EPOCH_START_COLOR}
                strokeWidth={1.5}
                strokeDasharray="4 3"
              />,
            ];
            if (epoch.streak_end_date) {
              lines.push(
                <ReferenceLine
                  key={`end-${epoch.streak_end_date}`}
                  x={toNoon(epoch.streak_end_date)}
                  stroke={EPOCH_END_COLOR}
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                />,
              );
            }
            return lines;
          })}

          <Area
            type="monotone"
            dataKey="_value"
            stroke="#a1a1aa"
            fill="url(#metricGrad)"
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>

      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 px-1 text-xs text-zinc-500">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: FIRE_COLOR, opacity: 0.7 }} />
          Streak
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: ICE_COLOR, opacity: 0.7 }} />
          Protected
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: GRAY_COLOR }} />
          No Streak
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block w-5 h-px"
            style={{
              backgroundImage: `repeating-linear-gradient(to right, ${EPOCH_START_COLOR} 0, ${EPOCH_START_COLOR} 4px, transparent 4px, transparent 7px)`,
            }}
          />
          Streak start
        </span>
        {hasEpochEnds && (
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block w-5 h-px"
              style={{
                backgroundImage: `repeating-linear-gradient(to right, ${EPOCH_END_COLOR} 0, ${EPOCH_END_COLOR} 4px, transparent 4px, transparent 7px)`,
              }}
            />
            Streak end
          </span>
        )}
      </div>
    </div>
  );
}
