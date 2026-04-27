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
  //
  // Single-row data (typically the 1d view) is special-cased: recharts
  // can't draw a stacked Area from a single point — it falls back to a
  // column of dots — and a 1-point stack has no shape for recharts to
  // anchor its stack baseline to, which makes ordering brittle on view
  // transitions. We synthesize a start-of-day and end-of-day point with
  // the same values so each course paints as a horizontal band across
  // the chart, and the stack has a proper area to render.
  const withTime = useMemo(() => {
    const rows = data.map((d) => {
      const [y, m, day] = String(d.date).split("-").map(Number);
      return { ...d, _t: new Date(y, m - 1, day, 12).getTime() };
    });
    if (rows.length !== 1) return rows;
    const only = rows[0];
    const t = new Date(only._t);
    const startOfDay = new Date(t.getFullYear(), t.getMonth(), t.getDate(), 0, 0, 0).getTime();
    const endOfDay = new Date(t.getFullYear(), t.getMonth(), t.getDate(), 23, 59, 59).getTime();
    return [
      { ...only, _t: startOfDay },
      { ...only, _t: endOfDay },
    ];
  }, [data]);

  // Render strategy notes:
  //
  // We render an <Area> for *every* course id in `courseIds`, plus the
  // `_prior` and `_pretrack` series, on every render — even when their
  // values for the current window are all zero. Two reasons:
  //
  // 1. Recharts decides each <Area>'s stack baseline from the order of
  //    cartesian items it's seen registered. When children mount/unmount
  //    between renders (e.g. 7d → 1d shrinks the active set, 1d → 7d
  //    grows it back), that internal registry order can drift, and the
  //    return trip to 7d can paint courses at the wrong y baseline.
  //    A stable child set side-steps that entirely.
  // 2. The dynamic sort (smallest delta first → bottom of the stack,
  //    biggest on top) is preserved by re-sorting the *render order* of
  //    the same Areas each render, not by adding/removing them.
  //
  // Inactive courses just contribute zero-height bands and are filtered
  // from the tooltip below. The (otherwise unused) `_prior`/`_pretrack`
  // dummy values are still painted invisibly so the children set stays
  // stable across modes.
  const { sortedIds, priorValue, yMin } = useMemo(() => {
    if (!data.length) {
      return { sortedIds: [] as string[], priorValue: 0, yMin: 0 };
    }
    const last = data[data.length - 1];
    let minTotal = Infinity;
    for (const row of data) {
      const t = Number(row._total ?? 0);
      if (t > 0 && t < minTotal) minTotal = t;
    }
    const ordered = [...courseIds].sort((a, b) => {
      const av = Number(last[a] ?? 0);
      const bv = Number(last[b] ?? 0);
      if (av !== bv) return av - bv;
      // Stable tiebreaker: alphabetical by id, so equal-valued series
      // (typically the inactive zero pile) keep a deterministic order
      // across views.
      return a < b ? -1 : a > b ? 1 : 0;
    });
    return {
      sortedIds: ordered,
      priorValue: Number(data[0]?._prior ?? 0),
      yMin: isFinite(minTotal) ? minTotal : 0,
    };
  }, [data, courseIds]);

  const hasPrior = priorValue > 0;

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
            // Custom tooltip content: we render every course as an Area
            // for stack-order stability (see top-of-file note), so the
            // default tooltip would list a long row of "0" entries for
            // inactive courses. Recharts' `formatter` can't exclude
            // rows, so we filter here, sort by value desc, and label.
            content={({ active, payload, label }) => {
              if (!active || !payload || payload.length === 0) return null;
              const items = payload
                .filter((p) => Number(p.value) > 0)
                .map((p) => {
                  const k = String(p.dataKey ?? "");
                  let name: string;
                  if (k === "_prior") name = "Prior";
                  else if (k === "_total") name = "Cumulative XP";
                  else if (k === "_pretrack") name = "Pre-tracking";
                  else name = courseNames[k] ?? k;
                  return { k, name, value: Number(p.value), color: p.color ?? p.stroke };
                })
                .sort((a, b) => b.value - a.value);
              if (items.length === 0) return null;
              const d = new Date(Number(label));
              const dateLabel = `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
              return (
                <div
                  style={{
                    backgroundColor: "#18181b",
                    border: "1px solid #27272a",
                    borderRadius: 6,
                    color: "#e4e4e7",
                    fontSize: 11,
                    padding: "6px 10px",
                    maxHeight: 280,
                    overflowY: "auto",
                  }}
                >
                  <div style={{ marginBottom: 4, color: "#a1a1aa" }}>{dateLabel}</div>
                  {items.map((it) => (
                    <div
                      key={it.k}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 12,
                        lineHeight: "16px",
                      }}
                    >
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <span
                          style={{
                            display: "inline-block",
                            width: 8,
                            height: 8,
                            borderRadius: 2,
                            backgroundColor: it.color || "#71717a",
                          }}
                        />
                        {it.name}
                      </span>
                      <span>{it.value.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              );
            }}
          />

          {/* `_prior`: invisible bottom slab so course Areas stack on
              top of the prior baseline. Always rendered (even when the
              value is 0) to keep the children set stable. */}
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

          {/* `_pretrack`: gap between profile/daily totals and per-course
              snapshot sums. Always rendered for stable stacking. */}
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
