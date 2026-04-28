"use client";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

interface DailyXpBarChartProps {
  data: Array<Record<string, unknown>>;
  courseIds: string[];
  colors: Record<string, string>;
  courseNames?: Record<string, string>;
  height?: number;
}

export function DailyXpBarChart({
  data,
  courseIds,
  colors,
  courseNames = {},
  height = 350,
}: DailyXpBarChartProps) {
  if (!data.length) {
    return <div className="text-zinc-500 text-sm">No XP history yet</div>;
  }

  // Only render bars for courses with any non-zero value in this window
  const activeCourseIds = courseIds.filter((id) =>
    data.some((d) => Number(d[id] ?? 0) > 0)
  );

  // Largest total at bottom of stack
  const sorted = [...activeCourseIds].sort((a, b) => {
    const ta = data.reduce((s, d) => s + Number(d[a] ?? 0), 0);
    const tb = data.reduce((s, d) => s + Number(d[b] ?? 0), 0);
    return tb - ta;
  });

  const hasUntracked = data.some((d) => Number(d._untracked ?? 0) > 0);

  const formatDate = (date: string) => {
    const parts = date.split("-");
    return `${Number(parts[1])}/${Number(parts[2])}`;
  };

  const formatXp = (v: number) =>
    v >= 1000 ? `${Math.round(v / 1000)}k` : String(v);

  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 5, right: 16, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fill: "#71717a", fontSize: 11 }}
            tickFormatter={formatDate}
            minTickGap={40}
          />
          <YAxis
            tick={{ fill: "#71717a", fontSize: 11 }}
            width={45}
            tickFormatter={formatXp}
          />
          <Tooltip
            wrapperStyle={{ zIndex: 50 }}
            cursor={{ fill: "rgba(255,255,255,0.03)" }}
            // Recharts' default tooltip lists every stacked <Bar> regardless
            // of value, so multi-day windows show a long row of "0" entries
            // for inactive courses. Filter to non-zero rows, sort desc, and
            // render the same chrome as the History tooltip.
            content={({ active, payload, label }) => {
              if (!active || !payload || payload.length === 0) return null;
              const items = payload
                .filter((p) => Number(p.value) > 0)
                .map((p) => {
                  const k = String(p.dataKey ?? "");
                  const name = k === "_untracked" ? "Untracked" : courseNames[k] ?? k;
                  return {
                    k,
                    name,
                    value: Number(p.value),
                    color: p.color ?? p.fill,
                  };
                })
                .sort((a, b) => b.value - a.value);
              if (items.length === 0) return null;
              const parts = String(label).split("-");
              const dateLabel = `${Number(parts[1])}/${Number(parts[2])}/${parts[0]}`;
              return (
                <div
                  style={{
                    backgroundColor: "#18181b",
                    border: "1px solid #27272a",
                    borderRadius: 6,
                    color: "#e4e4e7",
                    fontSize: 11,
                    padding: "6px 10px",
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
          {sorted.map((id) => (
            <Bar
              key={id}
              dataKey={id}
              stackId="xp"
              fill={colors[id]}
              name={courseNames[id] ?? id}
              isAnimationActive={false}
            />
          ))}
          {hasUntracked && (
            <Bar
              dataKey="_untracked"
              stackId="xp"
              fill="#3f3f46"
              name="Untracked"
              isAnimationActive={false}
            />
          )}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
