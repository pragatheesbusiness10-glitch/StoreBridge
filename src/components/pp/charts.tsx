import type { ReactNode } from "react";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fmtShort } from "@/lib/pp/dates";
import { EmptyHint } from "./ui";

export type SeriesDef = {
  key: string;
  label: string;
  color?: string; // CSS color; defaults to chart palette
  type?: "line" | "bar" | "area";
  dashed?: boolean;
  dot?: boolean;
  stackId?: string;
  yAxis?: "left" | "right";
};

/** Compact axis labels: 93.95 → 94, 2500 → 2.5k, 0.25 → 0.25 */
const axisTick = (v: number) => {
  const a = Math.abs(v);
  if (a >= 10000) return `${Math.round(v / 1000)}k`;
  if (a >= 1000) return `${Number((v / 1000).toFixed(1))}k`;
  if (a >= 10)
    return String(Math.round(v * 10) / 10 === Math.round(v) ? Math.round(v) : Number(v.toFixed(1)));
  return String(Number(v.toFixed(2)));
};

const PALETTE = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

/**
 * Generic time-series chart over real records. `data` rows must contain `date` (yyyy-MM-dd).
 * Missing values must be null (never zero-filled), so gaps are shown as gaps.
 */
export function TimeChart({
  data,
  series,
  height = 240,
  unit,
  yDomain,
  refLines,
  band,
  emptyText = "No records in this period yet.",
  rightUnit,
}: {
  data: object[];
  series: SeriesDef[];
  height?: number;
  unit?: string;
  yDomain?: [number | string, number | string];
  refLines?: { y: number; label: string; color?: string }[];
  band?: { y1: number; y2: number; label?: string };
  emptyText?: ReactNode;
  rightUnit?: string;
}) {
  const hasData = (data as Record<string, unknown>[]).some((d) =>
    series.some((s) => d[s.key] !== null && d[s.key] !== undefined),
  );
  if (!hasData) return <EmptyHint>{emptyText}</EmptyHint>;
  const hasRight = series.some((s) => s.yAxis === "right");
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: hasRight ? 0 : 8, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={(d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? fmtShort(d) : d)}
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            tickLine={false}
            axisLine={false}
            minTickGap={24}
          />
          <YAxis
            yAxisId="left"
            domain={yDomain ?? ["auto", "auto"]}
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            tickLine={false}
            axisLine={false}
            width={52}
            allowDecimals
            tickFormatter={axisTick}
          />
          {hasRight && (
            <YAxis
              yAxisId="right"
              orientation="right"
              tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
              tickLine={false}
              axisLine={false}
              width={48}
              tickFormatter={axisTick}
            />
          )}
          <Tooltip
            contentStyle={{
              background: "var(--popover)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              fontSize: 12,
              color: "var(--popover-foreground)",
            }}
            labelFormatter={(d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? fmtShort(d) : d)}
            formatter={(v: number | string, name: string, item) => {
              const s = series.find((x) => x.label === name || x.key === item?.dataKey);
              const u = s?.yAxis === "right" ? rightUnit : unit;
              return [
                typeof v === "number" ? `${Number(v.toFixed(2))}${u ? ` ${u}` : ""}` : v,
                name,
              ];
            }}
          />
          {series.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} iconType="plainline" />}
          {band && (
            <ReferenceArea
              yAxisId="left"
              y1={band.y1}
              y2={band.y2}
              fill="var(--primary)"
              fillOpacity={0.08}
              label={undefined}
            />
          )}
          {refLines?.map((r) => (
            <ReferenceLine
              key={r.label}
              yAxisId="left"
              y={r.y}
              stroke={r.color ?? "var(--muted-foreground)"}
              strokeDasharray="4 4"
              label={{
                value: r.label,
                position: "insideTopRight",
                fontSize: 10,
                fill: "var(--muted-foreground)",
              }}
            />
          ))}
          {series.map((s, i) => {
            const color = s.color ?? PALETTE[i % PALETTE.length];
            const yAxisId = s.yAxis ?? "left";
            if (s.type === "bar")
              return (
                <Bar
                  key={s.key}
                  yAxisId={yAxisId}
                  dataKey={s.key}
                  name={s.label}
                  fill={color}
                  radius={[3, 3, 0, 0]}
                  stackId={s.stackId}
                  maxBarSize={28}
                />
              );
            if (s.type === "area")
              return (
                <Area
                  key={s.key}
                  yAxisId={yAxisId}
                  type="monotone"
                  dataKey={s.key}
                  name={s.label}
                  stroke={color}
                  fill={color}
                  fillOpacity={0.15}
                  connectNulls
                />
              );
            return (
              <Line
                key={s.key}
                yAxisId={yAxisId}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                stroke={color}
                strokeWidth={s.dashed ? 1.5 : 2}
                strokeDasharray={s.dashed ? "5 4" : undefined}
                dot={s.dot ?? false}
                activeDot={{ r: 4 }}
                connectNulls
              />
            );
          })}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
