"use client";

import { useMemo } from "react";
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

type ChartRow = Record<string, unknown> & {
  _t: number;
  _value: number;
  _row: Record<string, unknown>;
};

function formatDayLong(ts: number) {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

export function DailyMetricChart({
  data,
  metric,
  domainStart,
  height = 300,
  streakEpochs,
}: DailyMetricChartProps) {
  const epochs = streakEpochs ?? [];

  const rowsForBands = useMemo(() => {
    const rows: ChartRow[] = data.map((d) => {
      const t = toNoon(String(d.date));
      const value =
        metric === "time"
          ? Math.round(Number(d.total_session_time || 0) / 60)
          : Number(d.num_sessions || 0);
      return { ...d, _t: t, _value: value, _row: d };
    });
    rows.sort((a, b) => a._t - b._t);
    return rows;
  }, [data, metric]);

  const chartData = useMemo(() => {
    if (rowsForBands.length === 0) return [];
    if (rowsForBands.length === 1) {
      const r = rowsForBands[0];
      const d = new Date(r._t);
      const startOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0).getTime();
      const endOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59).getTime();
      return [{ ...r, _t: startOfDay }, { ...r, _t: endOfDay }];
    }
    return rowsForBands;
  }, [rowsForBands]);

  const domain = useMemo((): [number, number] => {
    const todayNoonDate = new Date();
    todayNoonDate.setHours(12, 0, 0, 0);
    const todayNoon = todayNoonDate.getTime();
    const todayEnd = todayNoon + HALF_DAY;
    const firstAreaStart = rowsForBands.length
      ? rowsForBands[0]._t - HALF_DAY
      : todayNoon - HALF_DAY;
    const lastAreaEnd = rowsForBands.length
      ? rowsForBands[rowsForBands.length - 1]._t + HALF_DAY
      : todayEnd;
    return [
      Math.min(domainStart ?? firstAreaStart, firstAreaStart),
      Math.max(lastAreaEnd, todayEnd),
    ];
  }, [rowsForBands, domainStart]);

  const formatTs = (ts: number) => {
    const d = new Date(ts);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };

  const hasEpochEnds = epochs.some((e) => e.streak_end_date);

  if (!chartData.length) {
    return <div className="text-zinc-500 text-sm">No daily metrics yet</div>;
  }

  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={chartData} margin={{ top: 5, right: 16, left: 0, bottom: 5 }}>
          <defs>
            <linearGradient id="metricGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#a1a1aa" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#a1a1aa" stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
          {/* Linear scale on numeric ms: same mapping for ReferenceArea / ReferenceLine / Area (time scale was skewing x vs bands). */}
          <XAxis
            dataKey="_t"
            type="number"
            scale="linear"
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
            shared
            cursor={{
              stroke: "#71717a",
              strokeOpacity: 0.45,
              strokeDasharray: "4 4",
            }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const pt = payload[0]?.payload as ChartRow | undefined;
              if (!pt || typeof pt._t !== "number") return null;
              const v = pt._value;
              return (
                <div
                  style={{
                    backgroundColor: "#18181b",
                    border: "1px solid #27272a",
                    borderRadius: "6px",
                    color: "#e4e4e7",
                    fontSize: 11,
                    padding: "6px 10px",
                  }}
                >
                  <div style={{ marginBottom: 4, color: "#a1a1aa" }}>{formatDayLong(pt._t)}</div>
                  <div>
                    {metric === "time" ? `${v}m` : String(v)}{" "}
                    <span style={{ color: "#71717a" }}>
                      · {metric === "time" ? "Study time" : "Sessions"}
                    </span>
                  </div>
                </div>
              );
            }}
          />

          {/* Paint order: bands → area fill → epoch lines on top (was covering dashed lines). */}
          {rowsForBands.map((d) => {
            const row = d._row;
            const color = row.streak_extended
              ? FIRE_COLOR
              : Number(row.frozen) || Number(row.implied_freeze)
                ? ICE_COLOR
                : GRAY_COLOR;
            return (
              <ReferenceArea
                key={String(row.date)}
                x1={d._t - HALF_DAY}
                x2={d._t + HALF_DAY}
                fill={color}
                fillOpacity={0.18}
                stroke="none"
              />
            );
          })}

          <Area
            type="linear"
            dataKey="_value"
            stroke="#a1a1aa"
            fill="url(#metricGrad)"
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />

          {epochs.flatMap((epoch) => {
            // Bands span [noon−12h, noon+12h] per calendar day. Start line: left edge of
            // first streak day (matches current UX). End line: left edge of last streak day
            // (streak_end_date is inclusive per streak_epochs semantics).
            const lines = [
              <ReferenceLine
                key={`start-${epoch.streak_start_date}`}
                x={toNoon(epoch.streak_start_date) - HALF_DAY}
                stroke={EPOCH_START_COLOR}
                strokeWidth={2}
                strokeDasharray="4 3"
                zIndex={600}
              />,
            ];
            if (epoch.streak_end_date) {
              lines.push(
                <ReferenceLine
                  key={`end-${epoch.streak_end_date}`}
                  x={toNoon(epoch.streak_end_date) - HALF_DAY}
                  stroke={EPOCH_END_COLOR}
                  strokeWidth={2}
                  strokeDasharray="4 3"
                  zIndex={600}
                />,
              );
            }
            return lines;
          })}
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
