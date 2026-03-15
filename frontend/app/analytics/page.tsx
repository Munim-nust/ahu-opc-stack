"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  RadialBarChart,
  RadialBar,
  ResponsiveContainer,
  PolarAngleAxis,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";

type KPIResponse = {
  ahuId: string;
  avg_chw_inlet_24h: number | null;
  avg_chw_deltaT_24h: number | null;
  filter_dp_growth_rate_7d_pa_per_day: number | null;
  alarm_pct_24h: number | null;
  fan_runtime_hours_24h: number | null;
  peak_cooling_demand_24h: number | null;
};

type HistoryPoint = {
  time: string;
  value: number | null;
  text?: string | null;
};

type HistoryResponse = {
  ahuId: string;
  tag: string;
  hours: number;
  points: HistoryPoint[];
};

type KPIItem = {
  key: keyof KPIResponse;
  title: string;
  unit?: string;
  digits?: number;
  hint?: string;
};

type TrendOption = {
  label: string;
  value: string;
  unit: string;
};

function clamp(n: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, n));
}

function fmt(n: number | null | undefined, digits = 2) {
  return typeof n === "number" ? n.toFixed(digits) : "—";
}

function AccentCard({
  title,
  value,
  unit,
  hint,
}: {
  title: string;
  value: string;
  unit?: string;
  hint?: string;
}) {
  return (
    <div className="group overflow-hidden rounded-2xl border border-sky-100 bg-white/90 shadow-lg backdrop-blur-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-2xl">
      <div className="h-1 w-full bg-gradient-to-r from-sky-400 via-cyan-400 to-blue-500" />
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="text-[11px] font-semibold tracking-wide text-slate-500">
            {title}
          </div>
          {hint ? (
            <span className="rounded-full bg-slate-50 px-2 py-1 text-[10px] font-semibold text-slate-600 ring-1 ring-slate-200">
              {hint}
            </span>
          ) : null}
        </div>

        <div className="mt-2 flex items-baseline gap-2">
          <div className="text-2xl font-extrabold tracking-tight text-slate-900">
            {value}
          </div>
          {unit ? (
            <div className="text-sm font-medium text-slate-500">{unit}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function AlarmGauge({ pct }: { pct: number | null | undefined }) {
  const value = typeof pct === "number" ? clamp(pct) : 0;

  const gaugeData = useMemo(() => [{ name: "alarm", value }], [value]);

  const label =
    typeof pct !== "number"
      ? "No data yet"
      : pct >= 50
      ? "High"
      : pct >= 10
      ? "Moderate"
      : "Low";

  const ringCls =
    typeof pct !== "number"
      ? "ring-slate-200"
      : pct >= 50
      ? "ring-red-200"
      : pct >= 10
      ? "ring-amber-200"
      : "ring-emerald-200";

  return (
    <div className="overflow-hidden rounded-2xl border border-sky-100 bg-white/90 shadow-lg backdrop-blur-sm">
      <div className="h-1 w-full bg-gradient-to-r from-red-400 via-amber-400 to-emerald-400" />
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold tracking-wide text-slate-500">
              Alarm Time Share (24h)
            </div>
            <div className="mt-1 text-sm font-semibold text-slate-800">
              % Time in ALARM
            </div>
          </div>

          <span
            className={`rounded-full bg-white px-2 py-1 text-[10px] font-bold text-slate-700 ring-1 ${ringCls}`}
          >
            {label}
          </span>
        </div>

        <div className="mt-3 grid items-center gap-4 md:grid-cols-[180px_1fr]">
          <div className="h-[170px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <RadialBarChart
                cx="50%"
                cy="50%"
                innerRadius="70%"
                outerRadius="100%"
                barSize={14}
                data={gaugeData}
                startAngle={90}
                endAngle={-270}
              >
                <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
                <RadialBar background dataKey="value" cornerRadius={10} />
              </RadialBarChart>
            </ResponsiveContainer>
          </div>

          <div>
            <div className="text-4xl font-extrabold tracking-tight text-slate-900">
              {typeof pct === "number" ? `${pct.toFixed(1)}%` : "—"}
            </div>
            <div className="mt-1 text-sm font-medium text-slate-600">
              Based on samples stored in Postgres over the last 24 hours.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AnalyticsPage() {
  const [kpis, setKpis] = useState<KPIResponse | null>(null);
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [selectedTag, setSelectedTag] = useState("ChilledWaterInletTemp_C");
  const [selectedHours, setSelectedHours] = useState("24");

  const KPI_LIST: KPIItem[] = [
    {
      key: "avg_chw_inlet_24h",
      title: "Avg CHW Inlet Temp (24h)",
      unit: "°C",
      digits: 2,
      hint: "Average",
    },
    {
      key: "avg_chw_deltaT_24h",
      title: "Avg CHW ΔT (24h)",
      unit: "°C",
      digits: 2,
      hint: "Outlet - Inlet",
    },
    {
      key: "filter_dp_growth_rate_7d_pa_per_day",
      title: "Filter ΔP Growth Rate (7d)",
      unit: "Pa/day",
      digits: 2,
      hint: "Trend",
    },
    {
      key: "fan_runtime_hours_24h",
      title: "Fan Runtime (24h)",
      unit: "hours",
      digits: 2,
      hint: "Approx",
    },
    {
      key: "peak_cooling_demand_24h",
      title: "Peak Cooling Demand (24h)",
      unit: "TR",
      digits: 1,
      hint: "Max",
    },
  ];

  const TREND_OPTIONS: TrendOption[] = [
    { label: "CHW Inlet Temp", value: "ChilledWaterInletTemp_C", unit: "°C" },
    { label: "CHW Outlet Temp", value: "ChilledWaterOutletTemp_C", unit: "°C" },
    { label: "Filter ΔP", value: "InletFilterDP_Pa", unit: "Pa" },
    { label: "Cooling Demand", value: "CoolingDemand_TR", unit: "TR" },
    { label: "Fan Speed", value: "FanSpeed_rpm", unit: "rpm" },
  ];

  const selectedTrend = TREND_OPTIONS.find((t) => t.value === selectedTag);

  useEffect(() => {
    const loadKpis = async () => {
      try {
        setErr(null);
        const r = await fetch("/api/kpis?ahuId=AHU-0001", { cache: "no-store" });
        if (!r.ok) throw new Error(await r.text());
        const j = await r.json();
        setKpis(j);
      } catch (e: any) {
        setErr(e?.message || "Failed to fetch KPIs");
      }
    };

    loadKpis();
    const id = setInterval(loadKpis, 5000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const loadHistory = async () => {
      try {
        const r = await fetch(
          `/api/history?ahuId=AHU-0001&tag=${encodeURIComponent(
            selectedTag
          )}&hours=${encodeURIComponent(selectedHours)}`,
          { cache: "no-store" }
        );
        if (!r.ok) throw new Error(await r.text());
        const j = await r.json();
        setHistory(j);
      } catch (e: any) {
        console.error(e?.message || "Failed to fetch history");
      }
    };

    loadHistory();
  }, [selectedTag, selectedHours]);

  const chartData =
    history?.points.map((p, index) => ({
      index,
      time: new Date(p.time).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
      value: p.value,
    })) ?? [];

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-100 via-sky-50 to-slate-100 p-6 font-sans">
      <header className="mb-6 overflow-hidden rounded-2xl bg-gradient-to-r from-sky-500 via-cyan-500 to-blue-600 p-6 shadow-xl shadow-sky-500/20">
        <div className="grid items-center gap-4 md:grid-cols-3">
          <div className="flex items-center gap-3 md:justify-start">
            <div className="rounded-xl bg-white/15 px-3 py-2 text-xs font-semibold tracking-wide text-white/95 ring-1 ring-white/25">
              {kpis?.ahuId ?? "AHU-0001"} • Analytics
            </div>
            {err ? (
              <div className="rounded-full bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 ring-1 ring-red-200">
                API error
              </div>
            ) : (
              <div className="rounded-full bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
                Updated every 5s
              </div>
            )}
          </div>

          <div className="text-center">
            <h1 className="text-3xl font-extrabold tracking-tight text-white">
              Historical KPIs
            </h1>
            <p className="mt-1 text-sm font-medium text-white/80">
              Last 24 hours + 7 day trend (Postgres backed)
            </p>
          </div>

          <div className="flex justify-center md:justify-end">
            <Link
              href="/"
              className="inline-flex items-center justify-center rounded-xl bg-white px-5 py-3 text-sm font-bold tracking-wide text-blue-700 shadow-lg transition-all duration-300 hover:-translate-y-0.5 hover:bg-blue-50 hover:shadow-xl"
            >
              ← Back to Realtime
            </Link>
          </div>
        </div>
      </header>

      <section className="mb-6">
        <AlarmGauge pct={kpis?.alarm_pct_24h ?? null} />
      </section>

      <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {KPI_LIST.map((k) => (
          <AccentCard
            key={k.key as string}
            title={k.title}
            value={fmt(kpis?.[k.key] as any, k.digits ?? 2)}
            unit={k.unit}
            hint={k.hint}
          />
        ))}
      </section>

      <section className="mt-6 overflow-hidden rounded-2xl border border-sky-100 bg-white/90 shadow-lg backdrop-blur-sm">
        <div className="h-1 w-full bg-gradient-to-r from-sky-400 via-cyan-400 to-blue-500" />
        <div className="p-4">
          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-[11px] font-semibold tracking-wide text-slate-500">
                Historical Trend Explorer
              </div>
              <h2 className="mt-1 text-lg font-bold text-slate-900">
                {selectedTrend?.label ?? "Trend"} Trend
              </h2>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <select
                value={selectedTag}
                onChange={(e) => setSelectedTag(e.target.value)}
                className="rounded-xl border border-sky-100 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm outline-none"
              >
                {TREND_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>

              <select
                value={selectedHours}
                onChange={(e) => setSelectedHours(e.target.value)}
                className="rounded-xl border border-sky-100 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm outline-none"
              >
                <option value="1">Last 1 hour</option>
                <option value="6">Last 6 hours</option>
                <option value="24">Last 24 hours</option>
                <option value="168">Last 7 days</option>
              </select>
            </div>
          </div>

          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="time" minTickGap={30} />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="value"
                  name={selectedTrend?.label ?? "Value"}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-3 text-xs font-medium text-slate-500">
            Showing {selectedTrend?.label} over the last {selectedHours} hour(s).
          </div>
        </div>
      </section>

      <div className="mt-6 text-center text-xs font-medium text-slate-500">
        Data source: OPC UA → FastAPI → PostgreSQL → KPI queries → Next.js UI
      </div>
    </main>
  );
}