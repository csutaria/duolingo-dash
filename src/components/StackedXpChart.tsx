"use client";

import { useMemo } from "react";
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
  // All derived state is memoized so switching to all-time (which pushes
  // ~365 rows through the chart) doesn't re-walk `data` for every slice
  // on every render.
  const withTime = useMemo(
    () =>
      data.map((d) => {
        const [y, m, day] = String(d.date).split("-").map(Number);
        return { ...d, _t: new Date(y, m - 1, day, 12).getTime() };
      }),
    [data],
  );

  const { sortedIds, hasPretrack, hasPrior, priorValue, yMin } = useMemo(() => {
    if (!data.length) {
      return { sortedIds: [] as string[], hasPretrack: false, hasPrior: false, priorValue: 0, yMin: 0 };
    }
    const last = data[data.length - 1];
    const activeSet: string[] = [];
    const nonZero: Record<string, boolean> = {};
    let pretrack = false;
    let minTotal = Infinity;
    for (const row of data) {
      const t = Number(row._total ?? 0);
      if (t > 0 && t < minTotal) minTotal = t;
      if (!pretrack && Number(row._pretrack ?? 0) > 0) pretrack = true;
      for (const id of courseIds) {
        if (!nonZero[id] && Number(row[id] ?? 0) > 0) nonZero[id] = true;
      }
    }
    for (const id of courseIds) if (nonZero[id]) activeSet.push(id);
    activeSet.sort(
      (a, b) => Number(last[a] ?? 0) - Number(last[b] ?? 0),
    );
    const prior = Number(data[0]?._prior ?? 0);
    return {
      sortedIds: activeSet,
      hasPretrack: pretrack,
      hasPrior: prior > 0,
      priorValue: prior,
      yMin: isFinite(minTotal) ? minTotal : 0,
    };
  }, [data, courseIds]);

  if (!data.length) {
    return <div className="text-zinc-500 text-sm">No XP history yet</div>;
  }

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

  // Y-axis: anchor just below _prior whenever it exists so the constant
  // baseline slab sits at the floor and the window's deltas (plus any
  // _pretrack) fill the visible range. Falls back to a tight zoom on
  // _total when _prior is absent (e.g. no profile data).
  const yDomain: [number | string, number | string] = hasPrior
    ? [Math.floor(priorValue * 0.99), "dataMax"]
    : domainStart != null
      ? [Math.floor(yMin * 0.98), "dataMax"]
      : [0, "dataMax"];
  const yFloorValue = typeof yDomain[0] === "number" ? yDomain[0] : null;

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
            tick={(props) => {
              const { x, y, payload } = props as {
                x: number;
                y: number;
                payload: { value: number };
              };
              const isFloor = yFloorValue != null && Number(payload.value) === yFloorValue;
              return (
                <text
                  x={x}
                  y={y}
                  dx={-4}
                  textAnchor="end"
                  fill={isFloor ? "#d4d4d8" : "#71717a"}
                  fontSize={11}
                  fontWeight={isFloor ? 600 : 400}
                >
                  {formatXp(Number(payload.value))}
                </text>
              );
            }}
            width={45}
            tickFormatter={formatXp}
            domain={yDomain}
            allowDataOverflow
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
            formatter={(value: unknown, key: unknown) => {
              const k = String(key ?? "");
              if (k === "_prior") return [Number(value).toLocaleString(), "Prior"];
              if (k === "_total") return [Number(value).toLocaleString(), "Cumulative XP"];
              if (k === "_pretrack") return [Number(value).toLocaleString(), "Pre-tracking"];
              return [Number(value).toLocaleString(), courseNames[k] ?? k];
            }}
            itemSorter={(item) => -(Number(item.value) || 0)}
          />

          {hasPrior && (
            <Area
              type="linear"
              dataKey="_prior"
              stackId="xp"
              stroke="transparent"
              fill="#18181b"
              fillOpacity={1}
              strokeWidth={0}
              dot={false}
              isAnimationActive={false}
              activeDot={false}
              name="Prior"
              legendType="none"
            />
          )}

          {hasPretrack && (
            <Area
              type="linear"
              dataKey="_pretrack"
              stackId="xp"
              stroke="#52525b"
              fill="#3f3f46"
              fillOpacity={0.55}
              strokeWidth={1}
              dot={false}
              isAnimationActive={false}
              name="Pre-tracking"
            />
          )}

          {sortedIds.map((id) => (
            <Area
              key={id}
              type="linear"
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
            type="linear"
            dataKey="_total"
            stroke={CHART_TOTAL_COLOR}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
            name="Cumulative XP"
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

      {/* Inline legend for the non-language series */}
      <div className="flex gap-4 mt-1 px-1 text-xs text-zinc-500 justify-end flex-wrap">
        {hasPretrack && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: "#3f3f46" }} />
            Pre-tracking
          </span>
        )}
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-5 h-px" style={{ backgroundColor: CHART_TOTAL_COLOR }} />
          Cumulative XP
        </span>
        {profileTotalXp > 0 && (
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block w-5 h-px"
              style={{
                backgroundImage: `repeating-linear-gradient(to right, ${CHART_CEILING_COLOR} 0, ${CHART_CEILING_COLOR} 3px, transparent 3px, transparent 6px)`,
              }}
            />
            Profile total XP
          </span>
        )}
      </div>
    </div>
  );
}
