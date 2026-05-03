"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import {
  LineChart, Line,
  BarChart, Bar,
  AreaChart, Area,
  ScatterChart, Scatter, ZAxis,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ComposedChart,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type Series = { key: string; label: string; color: string; type?: string };

type KPIResult = { label: string; value: number | string | null; unit: string };

type ChatResult = {
  title: string;
  chart_type: "line" | "bar" | "area" | "pie" | "scatter" | "histogram" |
              "radar" | "composed" | "multi_line" | "stacked_bar" | "stacked_area" | null;
  x_key: string;
  series: Series[];
  y_unit: string;
  data: Record<string, any>[];
  kpi_label: string | null;
  kpi_value: number | string | null;
  kpis: KPIResult[];
  sql: string | null;
};

type Message = {
  id: number;
  role: "user" | "assistant";
  text: string;
  result?: ChatResult;
  error?: string;
  loading?: boolean;
};

// ---------------------------------------------------------------------------
// Suggestion chips — icon + text pairs
// ---------------------------------------------------------------------------
const SUGGESTIONS: { icon: string; text: string; color: string }[] = [
  { icon: "📈", text: "Inlet vs outlet temp last 2 hours", color: "from-sky-500 to-blue-600" },
  { icon: "📊", text: "Histogram of fan speed distribution last 24h", color: "from-violet-500 to-purple-600" },
  { icon: "🔵", text: "Scatter: cooling demand vs flow rate today", color: "from-cyan-500 to-teal-600" },
  { icon: "🌊", text: "Stacked area: cooling demand vs delivered last 6h", color: "from-emerald-500 to-green-600" },
  { icon: "🕸️", text: "Radar chart of AHU health indicators", color: "from-orange-500 to-amber-600" },
  { icon: "🥧", text: "Pie chart: alarm vs normal operation last 24h", color: "from-rose-500 to-pink-600" },
  { icon: "⚡", text: "Electricity cost trend last 24 hours", color: "from-yellow-500 to-amber-500" },
  { icon: "🌡️", text: "Multi-line: inlet, outlet, mixed air temp last 3h", color: "from-red-500 to-orange-600" },
  { icon: "🔧", text: "Composed: fan speed bars + inlet temp line last 4h", color: "from-slate-500 to-gray-600" },
  { icon: "🔋", text: "What is the current filter remaining life %?", color: "from-lime-500 to-green-600" },
];

// ---------------------------------------------------------------------------
// KPI gradient colours — cycling through vivid pairs
// ---------------------------------------------------------------------------
const KPI_GRADIENTS = [
  { from: "#0ea5e9", to: "#6366f1", text: "from-sky-500 to-indigo-500" },
  { from: "#10b981", to: "#06b6d4", text: "from-emerald-500 to-cyan-500" },
  { from: "#f59e0b", to: "#f43f5e", text: "from-amber-500 to-rose-500" },
  { from: "#8b5cf6", to: "#ec4899", text: "from-violet-500 to-pink-500" },
];

// ---------------------------------------------------------------------------
// Chart palette
// ---------------------------------------------------------------------------
const PALETTE = [
  "#0ea5e9", "#f59e0b", "#10b981", "#f43f5e",
  "#8b5cf6", "#06b6d4", "#84cc16", "#fb923c",
  "#ec4899", "#14b8a6",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function formatXTick(val: string) {
  if (!val) return "";
  const d = new Date(val);
  if (isNaN(d.getTime())) return val;
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function fmt(n: number | null, digits = 2) {
  return n !== null && n !== undefined ? n.toFixed(digits) : "—";
}

function unitSuffix(y_unit: string) {
  return y_unit ? ` ${y_unit}` : "";
}

// ---------------------------------------------------------------------------
// Chart card shell — full-width, tall, with gradient header strip
// ---------------------------------------------------------------------------
function ChartCard({
  title, count, label, height = 400, children,
}: {
  title: string; count: number; label: string; height?: number; children: React.ReactNode;
}) {
  return (
    <div className="mt-4 w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
      {/* Gradient accent strip */}
      <div className="h-1.5 w-full bg-gradient-to-r from-sky-400 via-violet-500 to-pink-500" />
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
        <span className="text-base font-bold text-slate-800">{title}</span>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500">
          {count} {label}
        </span>
      </div>
      <div className="p-4" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          {children as React.ReactElement}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Common axis factory
// ---------------------------------------------------------------------------
function commonAxes(x_key: string, y_unit: string) {
  return {
    xAxis: (
      <XAxis dataKey={x_key} tickFormatter={formatXTick}
        tick={{ fontSize: 11, fill: "#94a3b8" }} minTickGap={40} />
    ),
    yAxis: (
      <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }}
        unit={unitSuffix(y_unit)} width={66} />
    ),
    grid: <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />,
    tooltip: (
      <Tooltip
        labelFormatter={(v) => formatXTick(String(v))}
        formatter={(v: any, name: string | undefined) => [
          v !== undefined && v !== null ? `${Number(v).toFixed(2)}${unitSuffix(y_unit)}` : "—",
          name ?? "",
        ]}
        contentStyle={{ fontSize: 12, borderRadius: 10, border: "none", boxShadow: "0 4px 20px rgba(0,0,0,0.12)" }}
      />
    ),
    legend: <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />,
  };
}

// ---------------------------------------------------------------------------
// DynamicChart
// ---------------------------------------------------------------------------
function DynamicChart({ result }: { result: ChatResult }) {
  const { chart_type, data, series, x_key, y_unit, title } = result;
  if (!chart_type || !data.length) return null;

  const ax = commonAxes(x_key, y_unit);
  const margin = { top: 8, right: 24, left: 0, bottom: 4 };

  // PIE
  if (chart_type === "pie") {
    const valueKey = series[0]?.key ?? "value";
    const nameKey = x_key ?? "name";
    return (
      <ChartCard title={title} count={data.length} label="slices" height={360}>
        <PieChart>
          <Pie data={data} dataKey={valueKey} nameKey={nameKey}
            cx="50%" cy="46%" outerRadius={130} innerRadius={50}
            label={({ name, percent }: { name?: string; percent?: number }) =>
              `${name ?? ""} ${((percent ?? 0) * 100).toFixed(1)}%`}
            labelLine paddingAngle={3}>
            {data.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
          </Pie>
          <Tooltip formatter={(v: any, _n: string | undefined) =>
            [`${Number(v).toFixed(2)}${unitSuffix(y_unit)}`, ""]}
            contentStyle={{ fontSize: 12, borderRadius: 10, border: "none", boxShadow: "0 4px 20px rgba(0,0,0,0.12)" }} />
          <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
        </PieChart>
      </ChartCard>
    );
  }

  // SCATTER
  if (chart_type === "scatter") {
    const xKey = series[0]?.key ?? "x";
    const yKey = series[1]?.key ?? "y";
    const xLabel = series[0]?.label ?? xKey;
    const yLabel = series[1]?.label ?? yKey;
    return (
      <ChartCard title={title} count={data.length} label="points">
        <ScatterChart margin={margin}>
          {ax.grid}
          <XAxis dataKey={xKey} name={xLabel} type="number"
            tick={{ fontSize: 11, fill: "#94a3b8" }}
            label={{ value: xLabel, position: "insideBottom", offset: -2, fontSize: 11 }} />
          <YAxis dataKey={yKey} name={yLabel} type="number"
            tick={{ fontSize: 11, fill: "#94a3b8" }} unit={unitSuffix(y_unit)} width={66} />
          <ZAxis range={[50, 50]} />
          <Tooltip cursor={{ strokeDasharray: "3 3" }}
            formatter={(v: any, name: string | undefined) =>
              [`${Number(v).toFixed(2)}${unitSuffix(y_unit)}`, name ?? ""]}
            contentStyle={{ fontSize: 12, borderRadius: 10, border: "none", boxShadow: "0 4px 20px rgba(0,0,0,0.12)" }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Scatter name={title} data={data} fill={PALETTE[0]} opacity={0.8} />
        </ScatterChart>
      </ChartCard>
    );
  }

  // HISTOGRAM
  if (chart_type === "histogram") {
    const valueKey = series[0]?.key ?? "count";
    return (
      <ChartCard title={title} count={data.length} label="buckets">
        <BarChart data={data} margin={margin}>
          {ax.grid}
          <XAxis dataKey={x_key} tick={{ fontSize: 11, fill: "#94a3b8" }} minTickGap={16} />
          <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} width={50} />
          <Tooltip contentStyle={{ fontSize: 12, borderRadius: 10, border: "none", boxShadow: "0 4px 20px rgba(0,0,0,0.12)" }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey={valueKey} name={series[0]?.label ?? "Count"} radius={[4, 4, 0, 0]}>
            {data.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
          </Bar>
        </BarChart>
      </ChartCard>
    );
  }

  // RADAR
  if (chart_type === "radar") {
    return (
      <ChartCard title={title} count={data.length} label="metrics" height={360}>
        <RadarChart cx="50%" cy="50%" outerRadius={130} data={data}>
          <PolarGrid stroke="#e2e8f0" />
          <PolarAngleAxis dataKey={x_key} tick={{ fontSize: 11, fill: "#475569" }} />
          <PolarRadiusAxis angle={30} tick={{ fontSize: 10, fill: "#94a3b8" }} />
          {series.map((s, i) => (
            <Radar key={s.key} name={s.label} dataKey={s.key}
              stroke={s.color || PALETTE[i]} fill={s.color || PALETTE[i]} fillOpacity={0.3} strokeWidth={2} />
          ))}
          <Tooltip contentStyle={{ fontSize: 12, borderRadius: 10, border: "none", boxShadow: "0 4px 20px rgba(0,0,0,0.12)" }} />
          <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
        </RadarChart>
      </ChartCard>
    );
  }

  // STACKED BAR
  if (chart_type === "stacked_bar") {
    return (
      <ChartCard title={title} count={data.length} label="points">
        <BarChart data={data} margin={margin}>
          {ax.grid}{ax.xAxis}{ax.yAxis}{ax.tooltip}{ax.legend}
          {series.map((s, i) => (
            <Bar key={s.key} dataKey={s.key} name={s.label}
              fill={s.color || PALETTE[i]} stackId="stack" radius={i === series.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]} />
          ))}
        </BarChart>
      </ChartCard>
    );
  }

  // STACKED AREA
  if (chart_type === "stacked_area") {
    return (
      <ChartCard title={title} count={data.length} label="points">
        <AreaChart data={data} margin={margin}>
          {ax.grid}{ax.xAxis}{ax.yAxis}{ax.tooltip}{ax.legend}
          {series.map((s, i) => (
            <Area key={s.key} type="monotone" dataKey={s.key} name={s.label}
              stroke={s.color || PALETTE[i]} fill={s.color || PALETTE[i]}
              fillOpacity={0.25} strokeWidth={2.5} stackId="stack" dot={false} />
          ))}
        </AreaChart>
      </ChartCard>
    );
  }

  // COMPOSED
  if (chart_type === "composed") {
    return (
      <ChartCard title={title} count={data.length} label="points">
        <ComposedChart data={data} margin={margin}>
          {ax.grid}{ax.xAxis}{ax.yAxis}{ax.tooltip}{ax.legend}
          {series.map((s, i) => {
            const t = s.type ?? (i === 0 ? "bar" : "line");
            if (t === "bar")
              return <Bar key={s.key} dataKey={s.key} name={s.label}
                fill={s.color || PALETTE[i]} radius={[4, 4, 0, 0]} />;
            if (t === "area")
              return <Area key={s.key} type="monotone" dataKey={s.key} name={s.label}
                stroke={s.color || PALETTE[i]} fill={s.color || PALETTE[i]}
                fillOpacity={0.15} strokeWidth={2.5} dot={false} />;
            return <Line key={s.key} type="monotone" dataKey={s.key} name={s.label}
              stroke={s.color || PALETTE[i]} strokeWidth={2.5} dot={false} isAnimationActive={false} />;
          })}
        </ComposedChart>
      </ChartCard>
    );
  }

  // BAR
  if (chart_type === "bar") {
    return (
      <ChartCard title={title} count={data.length} label="points">
        <BarChart data={data} margin={margin}>
          {ax.grid}{ax.xAxis}{ax.yAxis}{ax.tooltip}{ax.legend}
          {series.map((s, i) => (
            <Bar key={s.key} dataKey={s.key} name={s.label}
              fill={s.color || PALETTE[i]} radius={[4, 4, 0, 0]} />
          ))}
        </BarChart>
      </ChartCard>
    );
  }

  // AREA
  if (chart_type === "area") {
    return (
      <ChartCard title={title} count={data.length} label="points">
        <AreaChart data={data} margin={margin}>
          {ax.grid}{ax.xAxis}{ax.yAxis}{ax.tooltip}{ax.legend}
          {series.map((s, i) => (
            <Area key={s.key} type="monotone" dataKey={s.key} name={s.label}
              stroke={s.color || PALETTE[i]} fill={s.color || PALETTE[i]}
              fillOpacity={0.18} strokeWidth={2.5} dot={false} />
          ))}
        </AreaChart>
      </ChartCard>
    );
  }

  // LINE / MULTI_LINE — default
  return (
    <ChartCard title={title} count={data.length} label="points">
      <LineChart data={data} margin={margin}>
        {ax.grid}{ax.xAxis}{ax.yAxis}{ax.tooltip}{ax.legend}
        {series.map((s, i) => (
          <Line key={s.key} type="monotone" dataKey={s.key} name={s.label}
            stroke={s.color || PALETTE[i]} strokeWidth={2.5} dot={false} isAnimationActive={false} />
        ))}
      </LineChart>
    </ChartCard>
  );
}

// ---------------------------------------------------------------------------
// KPI card — big, colourful, full-width gradient
// ---------------------------------------------------------------------------
function KPICard({ label, value, unit, colorIndex = 0 }: { label: string; value: number | string | null; unit: string; colorIndex?: number }) {
  const grad = KPI_GRADIENTS[colorIndex % KPI_GRADIENTS.length];

  // Render value: string (e.g. "ON") shown directly; number formatted; null = "—"
  const display =
    value === null || value === undefined
      ? "—"
      : typeof value === "string"
      ? value
      : fmt(value as number, 2);

  // Status-aware accent for text values like ON / ALARM / OFF
  const statusStyle =
    value === "ON" ? "bg-emerald-400/30 ring-2 ring-emerald-300"
    : value === "ALARM" ? "bg-red-400/30 ring-2 ring-red-300"
    : "";

  return (
    <div className={`mt-4 w-full overflow-hidden rounded-2xl bg-gradient-to-br ${grad.text} p-px shadow-xl`}>
      <div className={`rounded-2xl bg-white/10 px-8 py-7 backdrop-blur-sm ${statusStyle}`}>
        <div className="text-sm font-bold uppercase tracking-widest text-white/80">{label}</div>
        <div className="mt-3 flex items-end gap-3">
          <span className="text-5xl font-black leading-none text-white drop-shadow break-all">
            {display}
          </span>
          {unit && typeof value !== "string" && (
            <span className="mb-1 text-xl font-semibold text-white/70">{unit}</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SQL badge
// ---------------------------------------------------------------------------
function SqlBadge({ sql }: { sql: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-sky-500 transition-colors"
      >
        <span className="font-mono">{open ? "▲" : "▼"}</span>
        {open ? "Hide SQL" : "Show SQL"}
      </button>
      {open && (
        <pre className="mt-2 overflow-x-auto rounded-xl bg-slate-950 px-5 py-4 text-[11px] leading-relaxed text-emerald-400 shadow-inner">
          {sql}
        </pre>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Typing indicator
// ---------------------------------------------------------------------------
function TypingIndicator() {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-sky-500 to-violet-600 text-sm font-black text-white shadow">
        AI
      </div>
      <div className="rounded-2xl rounded-tl-sm border border-slate-100 bg-white px-5 py-4 shadow-md">
        <div className="flex items-center gap-1.5">
          {[0, 150, 300].map((d) => (
            <span
              key={d}
              className="h-2.5 w-2.5 rounded-full bg-sky-400"
              style={{ animation: `bounce 1s ease-in-out ${d}ms infinite` }}
            />
          ))}
          <span className="ml-2 text-sm font-medium text-slate-400">Analysing your data…</span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Message bubble
// ---------------------------------------------------------------------------
function MessageBubble({ msg }: { msg: Message }) {
  if (msg.role === "user") {
    return (
      <div className="flex justify-end gap-3">
        <div className="max-w-[60%] rounded-2xl rounded-tr-sm bg-gradient-to-br from-sky-500 to-blue-600 px-5 py-3.5 text-base font-medium text-white shadow-lg shadow-sky-500/25">
          {msg.text}
        </div>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-200 text-sm font-bold text-slate-600">
          U
        </div>
      </div>
    );
  }

  if (msg.loading) return <TypingIndicator />;

  return (
    <div className="flex gap-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-sky-500 to-violet-600 text-sm font-black text-white shadow">
        AI
      </div>
      <div className="min-w-0 flex-1 rounded-2xl rounded-tl-sm border border-slate-100 bg-white px-5 py-5 shadow-md">
        {msg.error ? (
          <div className="flex items-center gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-600">
            <span className="text-lg">⚠</span> {msg.error}
          </div>
        ) : msg.result ? (
          <div>
            {/* Multiple KPI cards — side by side when more than one */}
            {msg.result.kpis && msg.result.kpis.length > 0 ? (
              <div className={`mt-1 grid gap-3 ${msg.result.kpis.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
                {msg.result.kpis.map((kpi, i) => (
                  <KPICard key={i} label={kpi.label} value={kpi.value} unit={kpi.unit} colorIndex={i} />
                ))}
              </div>
            ) : msg.result.kpi_label ? (
              <KPICard label={msg.result.kpi_label} value={msg.result.kpi_value} unit={msg.result.y_unit} colorIndex={0} />
            ) : null}
            {msg.result.chart_type && msg.result.data.length > 0 && (
              <DynamicChart result={msg.result} />
            )}
            {!msg.result.kpi_label && !(msg.result.kpis?.length) && (!msg.result.data || msg.result.data.length === 0) && (
              <div className="flex items-center gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm font-medium text-amber-700">
                <span className="text-lg">ℹ</span> No data found for that query in the selected time range.
              </div>
            )}
            {msg.result.sql && <SqlBadge sql={msg.result.sql} />}
          </div>
        ) : (
          <p className="text-base leading-relaxed text-slate-700">{msg.text}</p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Welcome hero (shown before any query)
// ---------------------------------------------------------------------------
function WelcomeHero({ onSubmit }: { onSubmit: (s: string) => void }) {
  return (
    <div className="flex flex-col items-center py-8">
      {/* Pulsing orb */}
      <div className="relative mb-6">
        <div className="h-20 w-20 rounded-full bg-gradient-to-br from-sky-400 to-violet-600 shadow-2xl shadow-sky-500/40" />
        <div className="absolute inset-0 animate-ping rounded-full bg-sky-400 opacity-20" />
        <div className="absolute inset-3 flex items-center justify-center rounded-full bg-white/20 text-2xl font-black text-white">
          AI
        </div>
      </div>

      <h2 className="text-2xl font-extrabold text-slate-800">AHU Analytics Assistant</h2>
      <p className="mt-2 text-center text-base text-slate-500 max-w-md">
        Ask anything about your AHU in plain English. I'll query live data and build the chart instantly.
      </p>

      {/* Chart type pills */}
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {["Line", "Bar", "Area", "Pie", "Scatter", "Histogram", "Radar", "Stacked", "Composed"].map((t) => (
          <span key={t} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-500 shadow-sm">
            {t}
          </span>
        ))}
      </div>

      <p className="mt-8 text-xs font-semibold uppercase tracking-widest text-slate-400">Try one of these</p>

      {/* Suggestion cards */}
      <div className="mt-4 grid w-full max-w-3xl grid-cols-2 gap-3 px-2 sm:grid-cols-2 lg:grid-cols-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s.text}
            onClick={() => onSubmit(s.text)}
            className="group flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-sky-200 hover:shadow-lg"
          >
            <span className="text-2xl">{s.icon}</span>
            <span className="text-sm font-medium leading-snug text-slate-700 group-hover:text-sky-700">
              {s.text}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function submit(prompt: string) {
    if (!prompt.trim() || loading) return;
    setInput("");
    setLoading(true);

    const userMsg: Message = { id: Date.now(), role: "user", text: prompt };
    const loadingMsg: Message = { id: Date.now() + 1, role: "assistant", text: "", loading: true };
    setMessages((prev) => [...prev, userMsg, loadingMsg]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, ahu_id: "AHU-0001" }),
      });
      const data = res.ok ? await res.json() : null;

      setMessages((prev) =>
        prev.map((m) =>
          m.id === loadingMsg.id
            ? { ...m, loading: false, result: res.ok ? data : undefined, error: res.ok ? undefined : `Error ${res.status}` }
            : m
        )
      );
    } catch (e: any) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === loadingMsg.id
            ? { ...m, loading: false, error: e?.message ?? "Network error" }
            : m
        )
      );
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  const hasMessages = messages.length > 0;

  return (
    <div className="flex h-screen flex-col bg-gradient-to-br from-slate-50 via-sky-50 to-indigo-50 font-sans">

      {/* ── HEADER ────────────────────────────────────────────────────────── */}
      <header className="flex shrink-0 items-center justify-between border-b border-white/60 bg-white/70 px-6 py-3.5 shadow-sm backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 to-violet-600 text-sm font-black text-white shadow">
            AI
          </div>
          <div>
            <div className="text-base font-extrabold text-slate-900">AHU Analytics Assistant</div>
            <div className="text-[11px] font-medium text-slate-400">Claude · Live PostgreSQL · 11 chart types</div>
          </div>
        </div>
        <div className="flex gap-2">
          <Link href="/"
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 shadow-sm hover:bg-slate-50 transition">
            ← Realtime
          </Link>
          <Link href="/analytics"
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 shadow-sm hover:bg-slate-50 transition">
            Analytics
          </Link>
        </div>
      </header>

      {/* ── MESSAGES ──────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {!hasMessages ? (
          <div className="mx-auto max-w-4xl px-6">
            <WelcomeHero onSubmit={submit} />
          </div>
        ) : (
          <div className="mx-auto max-w-6xl space-y-6 px-6 py-6">
            {messages.map((msg) => (
              <MessageBubble key={msg.id} msg={msg} />
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* ── INPUT BAR ─────────────────────────────────────────────────────── */}
      <div className="shrink-0 border-t border-white/60 bg-white/80 px-6 py-4 backdrop-blur-md shadow-[0_-4px_20px_rgba(0,0,0,0.06)]">
        <form
          onSubmit={(e) => { e.preventDefault(); submit(input); }}
          className="mx-auto flex max-w-6xl items-center gap-3"
        >
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about trends, KPIs, energy, maintenance…"
            disabled={loading}
            className="flex-1 rounded-2xl border border-slate-200 bg-white px-5 py-3.5 text-base font-medium text-slate-800 placeholder:font-normal placeholder:text-slate-400 outline-none shadow-sm focus:border-sky-400 focus:ring-3 focus:ring-sky-100 disabled:opacity-50 transition-all"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-500 to-violet-600 text-white shadow-lg shadow-sky-500/30 transition-all hover:scale-105 hover:shadow-sky-500/50 disabled:opacity-40 disabled:hover:scale-100"
          >
            {loading ? (
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
                <path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z" />
              </svg>
            )}
          </button>
        </form>
        <p className="mt-2 text-center text-[11px] font-medium text-slate-400">
          line · multi-line · bar · stacked bar · area · stacked area · scatter · histogram · radar · pie · composed
        </p>
      </div>

      {/* Bounce keyframes for typing dots */}
      <style>{`
        @keyframes bounce {
          0%, 80%, 100% { transform: translateY(0); }
          40% { transform: translateY(-6px); }
        }
      `}</style>
    </div>
  );
}
