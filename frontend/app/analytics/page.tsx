"use client";

import { useEffect, useMemo, useState } from "react";
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
  // Tier 1
  cooling_energy_kwh_24h: number | null;
  filter_remaining_life_pct: number | null;
  est_electricity_cost_usd_24h: number | null;
  cop_24h: number | null;
  // Tier 2
  coil_fouling_slope_7d: number | null;
  belt_remaining_life_pct: number | null;
  mtba_hours_7d: number | null;
  dp_acceleration_pa_per_day: number | null;
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

type TreeTag = {
  label: string;
  value: string;
  unit: string;
};

type TreeGroup = {
  group: string;
  tags: TreeTag[];
};

type TagStats = {
  min: number | null;
  avg: number | null;
  max: number | null;
  count: number;
};

function clamp(n: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, n));
}

function fmt(n: number | null | undefined, digits = 2) {
  return typeof n === "number" ? n.toFixed(digits) : "—";
}

function formatXAxis(ts: string, selectedHours: string) {
  const d = new Date(ts);

  if (Number(selectedHours) <= 24) {
    return d.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  return d.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function computeStats(points: { value: number | null }[]): TagStats {
  const values = points
    .map((p) => p.value)
    .filter((v): v is number => typeof v === "number" && !Number.isNaN(v));

  if (!values.length) {
    return {
      min: null,
      avg: null,
      max: null,
      count: 0,
    };
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const avg = values.reduce((a, b) => a + b, 0) / values.length;

  return {
    min,
    avg,
    max,
    count: values.length,
  };
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

function StatCard({
  title,
  value,
  unit,
}: {
  title: string;
  value: string;
  unit?: string;
}) {
  return (
    <div className="rounded-xl bg-slate-50 px-4 py-3 ring-1 ring-slate-200">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </div>
      <div className="mt-1 text-xl font-bold text-slate-900">
        {value} {unit ?? ""}
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

function SidebarTree({
  ahuId,
  tree,
  selectedTag,
  onSelectTag,
}: {
  ahuId: string;
  tree: TreeGroup[];
  selectedTag: string;
  onSelectTag: (tag: TreeTag) => void;
}) {
  return (
    <aside className="overflow-hidden rounded-2xl border border-sky-100 bg-white/90 shadow-lg backdrop-blur-sm no-print">
      <div className="h-1 w-full bg-gradient-to-r from-sky-400 via-cyan-400 to-blue-500" />
      <div className="p-4">
        <div className="mb-3 text-[11px] font-semibold tracking-wide text-slate-500">
          TAG HIERARCHY
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
          <div className="text-sm font-bold text-slate-800">{ahuId}</div>

          <div className="mt-3 space-y-3">
            {tree.map((group) => (
              <div key={group.group}>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {group.group}
                </div>

                <div className="space-y-1">
                  {group.tags.map((tag) => {
                    const active = selectedTag === tag.value;

                    return (
                      <button
                        key={tag.value}
                        onClick={() => onSelectTag(tag)}
                        className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition ${
                          active
                            ? "bg-sky-100 font-semibold text-sky-800 ring-1 ring-sky-200"
                            : "bg-white text-slate-700 hover:bg-slate-100"
                        }`}
                      >
                        <span>{tag.label}</span>
                        <span className="text-xs text-slate-400">{tag.unit}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
}

export default function AnalyticsPage() {
  const ahuId = "AHU-0001";

  const [kpis, setKpis] = useState<KPIResponse | null>(null);
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [history1h, setHistory1h] = useState<HistoryResponse | null>(null);
  const [history24h, setHistory24h] = useState<HistoryResponse | null>(null);

  const [err, setErr] = useState<string | null>(null);
  const [historyErr, setHistoryErr] = useState<string | null>(null);

  const TAG_TREE: TreeGroup[] = [
    {
      group: "Water Side",
      tags: [
        { label: "CHW Inlet Temp", value: "ChilledWaterInletTemp_C", unit: "°C" },
        { label: "CHW Outlet Temp", value: "ChilledWaterOutletTemp_C", unit: "°C" },
        { label: "CHW Flow Rate", value: "ChilledWaterFlowRate_kgps", unit: "kg/s" },
      ],
    },
    {
      group: "Air Side",
      tags: [
        { label: "Mixed Air Temp", value: "MixedAirTemp_C", unit: "°C" },
        { label: "Mixed Air Pressure", value: "MixedAirPressure_Pa", unit: "Pa" },
        { label: "Discharge Air Temp", value: "DischargeAirTemp_C", unit: "°C" },
        {
          label: "Discharge Air Mass Flow",
          value: "DischargeAirMassFlow_kgps",
          unit: "kg/s",
        },
      ],
    },
    {
      group: "Performance",
      tags: [
        { label: "Filter ΔP", value: "InletFilterDP_Pa", unit: "Pa" },
        { label: "Cooling Demand", value: "CoolingDemand_TR", unit: "TR" },
        { label: "Fan Speed", value: "FanSpeed_rpm", unit: "rpm" },
        { label: "Coil Fouling Factor", value: "CoilFoulingFactor", unit: "" },
        {
          label: "Overall Heat Transfer Coeff",
          value: "OverallHeatTransferCoeff",
          unit: "",
        },
      ],
    },
    {
      group: "Maintenance",
      tags: [
        {
          label: "Running Useful Hours Of Belt",
          value: "RunningUsefulHoursOfBelt_hr",
          unit: "hr",
        },
        {
          label: "Expected Life Of Filter",
          value: "ExpectedLifeOfFilter_hr",
          unit: "hr",
        },
        { label: "Running Hours", value: "RunningHours_hr", unit: "hr" },
      ],
    },
  ];

  const ALL_TAGS = TAG_TREE.flatMap((g) => g.tags);

  const [selectedTag, setSelectedTag] = useState<string>("ChilledWaterInletTemp_C");
  const [selectedHours, setSelectedHours] = useState<string>("24");

  const selectedTrend = ALL_TAGS.find((t) => t.value === selectedTag);

  useEffect(() => {
    const loadKpis = async () => {
      try {
        setErr(null);
        const r = await fetch(`/api/kpis?ahuId=${ahuId}`, { cache: "no-store" });
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
  }, [ahuId]);

  useEffect(() => {
    const fetchHistoryForHours = async (hours: string) => {
      const r = await fetch(
        `/api/history?ahuId=${ahuId}&tag=${encodeURIComponent(
          selectedTag
        )}&hours=${encodeURIComponent(hours)}`,
        { cache: "no-store" }
      );

      if (!r.ok) throw new Error(await r.text());
      return r.json();
    };

    const loadHistory = async () => {
      try {
        setHistoryErr(null);

        const [selectedRangeData, data1h, data24h] = await Promise.all([
          fetchHistoryForHours(selectedHours),
          fetchHistoryForHours("1"),
          fetchHistoryForHours("24"),
        ]);

        setHistory(selectedRangeData);
        setHistory1h(data1h);
        setHistory24h(data24h);
      } catch (e: any) {
        setHistoryErr(e?.message || "Failed to fetch history");
        setHistory(null);
        setHistory1h(null);
        setHistory24h(null);
      }
    };

    loadHistory();
  }, [ahuId, selectedTag, selectedHours]);

  const chartData =
    history?.points.map((p) => ({
      time: p.time,
      value: p.value,
    })) ?? [];

  const printChartData = chartData.map((p) => ({
    ...p,
    label: formatXAxis(p.time, selectedHours),
  }));

  const selectedStats = useMemo(() => computeStats(chartData), [chartData]);

  const stats1h = useMemo(
    () =>
      computeStats(
        history1h?.points.map((p) => ({
          value: p.value,
        })) ?? []
      ),
    [history1h]
  );

  const stats24h = useMemo(
    () =>
      computeStats(
        history24h?.points.map((p) => ({
          value: p.value,
        })) ?? []
      ),
    [history24h]
  );

  const handleDownloadPdf = () => {
    setTimeout(() => {
      window.print();
    }, 300);
  };

  return (
    <>
      <main className="min-h-screen bg-gradient-to-br from-slate-100 via-sky-50 to-slate-100 p-6 font-sans screen-root">
        <header className="mb-6 overflow-hidden rounded-2xl bg-gradient-to-r from-sky-500 via-cyan-500 to-blue-600 p-6 shadow-xl shadow-sky-500/20">
          <div className="grid items-center gap-4 md:grid-cols-3">
            <div className="flex items-center gap-3 md:justify-start">
              <div className="rounded-xl bg-white/15 px-3 py-2 text-xs font-semibold tracking-wide text-white/95 ring-1 ring-white/25">
                {kpis?.ahuId ?? ahuId} • Analytics
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
                Sidebar tag hierarchy + trend explorer
              </p>
            </div>

            <div className="flex justify-center gap-3 md:justify-end no-print">
              <Link
                href="/"
                className="inline-flex items-center justify-center rounded-xl bg-white px-5 py-3 text-sm font-bold tracking-wide text-blue-700 shadow-lg transition-all duration-300 hover:-translate-y-0.5 hover:bg-blue-50 hover:shadow-xl"
              >
                ← Back to Realtime
              </Link>

              <button
                onClick={handleDownloadPdf}
                className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold tracking-wide text-white shadow-lg transition-all duration-300 hover:-translate-y-0.5 hover:bg-slate-800 hover:shadow-xl"
              >
                Download PDF Report
              </button>
            </div>
          </div>
        </header>

        <section className="mb-6">
          <AlarmGauge pct={kpis?.alarm_pct_24h ?? null} />
        </section>

        {/* Existing KPIs */}
        <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <AccentCard
            title="Avg CHW Inlet Temp (24h)"
            value={fmt(kpis?.avg_chw_inlet_24h, 2)}
            unit="°C"
            hint="Average"
          />
          <AccentCard
            title="Avg CHW ΔT (24h)"
            value={fmt(kpis?.avg_chw_deltaT_24h, 2)}
            unit="°C"
            hint="Outlet - Inlet"
          />
          <AccentCard
            title="Filter ΔP Growth Rate (7d)"
            value={fmt(kpis?.filter_dp_growth_rate_7d_pa_per_day, 2)}
            unit="Pa/day"
            hint="Trend"
          />
          <AccentCard
            title="Fan Runtime (24h)"
            value={fmt(kpis?.fan_runtime_hours_24h, 2)}
            unit="hours"
            hint="Approx"
          />
          <AccentCard
            title="Peak Cooling Demand (24h)"
            value={fmt(kpis?.peak_cooling_demand_24h, 1)}
            unit="TR"
            hint="Max"
          />
        </section>

        {/* Tier 1 — Energy, Cost & Efficiency KPIs */}
        <div className="mt-4 mb-1 flex items-center gap-3">
          <div className="h-px flex-1 bg-sky-100" />
          <span className="text-xs font-semibold tracking-widest text-sky-600 uppercase">Energy · Cost · Efficiency</span>
          <div className="h-px flex-1 bg-sky-100" />
        </div>

        <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {/* Cooling Energy */}
          <div className="group overflow-hidden rounded-2xl border border-emerald-100 bg-white/90 shadow-lg backdrop-blur-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-2xl">
            <div className="h-1 w-full bg-gradient-to-r from-emerald-400 via-teal-400 to-cyan-500" />
            <div className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="text-[11px] font-semibold tracking-wide text-slate-500">Cooling Energy (24h)</div>
                <span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-700 ring-1 ring-emerald-200">kWh</span>
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <div className="text-2xl font-extrabold tracking-tight text-slate-900">
                  {fmt(kpis?.cooling_energy_kwh_24h, 1)}
                </div>
                <div className="text-sm font-medium text-slate-500">kWh</div>
              </div>
              <div className="mt-1 text-[10px] text-slate-400">Q = m·Cp·ΔT integrated over 24h</div>
            </div>
          </div>

          {/* Filter Remaining Life */}
          {(() => {
            const pct = kpis?.filter_remaining_life_pct ?? null;
            const color = pct === null ? "slate" : pct > 50 ? "emerald" : pct > 20 ? "amber" : "red";
            const colorMap: Record<string, string> = {
              emerald: "from-emerald-400 to-teal-400",
              amber:   "from-amber-400 to-orange-400",
              red:     "from-red-400 to-rose-500",
              slate:   "from-slate-300 to-slate-400",
            };
            const badgeMap: Record<string, string> = {
              emerald: "bg-emerald-50 text-emerald-700 ring-emerald-200",
              amber:   "bg-amber-50 text-amber-700 ring-amber-200",
              red:     "bg-red-50 text-red-700 ring-red-200",
              slate:   "bg-slate-50 text-slate-600 ring-slate-200",
            };
            const label = pct === null ? "—" : pct > 50 ? "Good" : pct > 20 ? "Monitor" : "Replace Soon";
            return (
              <div className="group overflow-hidden rounded-2xl border border-amber-100 bg-white/90 shadow-lg backdrop-blur-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-2xl">
                <div className={`h-1 w-full bg-gradient-to-r ${colorMap[color]}`} />
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-[11px] font-semibold tracking-wide text-slate-500">Filter Remaining Life</div>
                    <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ring-1 ${badgeMap[color]}`}>{label}</span>
                  </div>
                  <div className="mt-2 flex items-baseline gap-2">
                    <div className="text-2xl font-extrabold tracking-tight text-slate-900">
                      {pct !== null ? pct.toFixed(1) : "—"}
                    </div>
                    <div className="text-sm font-medium text-slate-500">%</div>
                  </div>
                  {pct !== null && (
                    <div className="mt-2 h-1.5 w-full rounded-full bg-slate-100">
                      <div
                        className={`h-1.5 rounded-full bg-gradient-to-r ${colorMap[color]} transition-all`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Estimated Electricity Cost */}
          <div className="group overflow-hidden rounded-2xl border border-violet-100 bg-white/90 shadow-lg backdrop-blur-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-2xl">
            <div className="h-1 w-full bg-gradient-to-r from-violet-400 via-purple-400 to-indigo-500" />
            <div className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="text-[11px] font-semibold tracking-wide text-slate-500">Est. Electricity Cost (24h)</div>
                <span className="rounded-full bg-violet-50 px-2 py-1 text-[10px] font-semibold text-violet-700 ring-1 ring-violet-200">$0.12/kWh</span>
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <div className="text-sm font-extrabold tracking-tight text-slate-500">$</div>
                <div className="text-2xl font-extrabold tracking-tight text-slate-900">
                  {fmt(kpis?.est_electricity_cost_usd_24h, 2)}
                </div>
              </div>
              <div className="mt-1 text-[10px] text-slate-400">Fan + CHW pump + cooling energy</div>
            </div>
          </div>

          {/* COP */}
          {(() => {
            const cop = kpis?.cop_24h ?? null;
            const color = cop === null ? "slate" : cop >= 4 ? "emerald" : cop >= 2.5 ? "sky" : "amber";
            const badgeMap: Record<string, string> = {
              emerald: "bg-emerald-50 text-emerald-700 ring-emerald-200",
              sky:     "bg-sky-50 text-sky-700 ring-sky-200",
              amber:   "bg-amber-50 text-amber-700 ring-amber-200",
              slate:   "bg-slate-50 text-slate-600 ring-slate-200",
            };
            const label = cop === null ? "—" : cop >= 4 ? "Excellent" : cop >= 2.5 ? "Good" : "Low";
            return (
              <div className="group overflow-hidden rounded-2xl border border-sky-100 bg-white/90 shadow-lg backdrop-blur-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-2xl">
                <div className="h-1 w-full bg-gradient-to-r from-sky-400 via-cyan-400 to-blue-500" />
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-[11px] font-semibold tracking-wide text-slate-500">COP (24h Avg)</div>
                    <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ring-1 ${badgeMap[color]}`}>{label}</span>
                  </div>
                  <div className="mt-2 flex items-baseline gap-2">
                    <div className="text-2xl font-extrabold tracking-tight text-slate-900">
                      {cop !== null ? cop.toFixed(2) : "—"}
                    </div>
                    <div className="text-sm font-medium text-slate-500">Q/W</div>
                  </div>
                  <div className="mt-1 text-[10px] text-slate-400">Cooling output ÷ fan power</div>
                </div>
              </div>
            );
          })()}
        </section>

        {/* Tier 2 — Predictive Maintenance KPIs */}
        <div className="mt-4 mb-1 flex items-center gap-3">
          <div className="h-px flex-1 bg-rose-100" />
          <span className="text-xs font-semibold tracking-widest text-rose-600 uppercase">Predictive Maintenance</span>
          <div className="h-px flex-1 bg-rose-100" />
        </div>

        <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {/* Coil Fouling Trend */}
          {(() => {
            const slope = kpis?.coil_fouling_slope_7d ?? null;
            const color = slope === null ? "slate" : slope <= 0.1 ? "emerald" : slope <= 0.5 ? "amber" : "red";
            const badgeMap: Record<string, string> = {
              emerald: "bg-emerald-50 text-emerald-700 ring-emerald-200",
              amber:   "bg-amber-50 text-amber-700 ring-amber-200",
              red:     "bg-red-50 text-red-700 ring-red-200",
              slate:   "bg-slate-50 text-slate-600 ring-slate-200",
            };
            const gradMap: Record<string, string> = {
              emerald: "from-emerald-400 to-teal-400",
              amber:   "from-amber-400 to-orange-400",
              red:     "from-red-400 to-rose-500",
              slate:   "from-slate-300 to-slate-400",
            };
            const label = slope === null ? "—" : slope <= 0.1 ? "Stable" : slope <= 0.5 ? "Watch" : "Clean Soon";
            return (
              <div className="group overflow-hidden rounded-2xl border border-orange-100 bg-white/90 shadow-lg backdrop-blur-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-2xl">
                <div className={`h-1 w-full bg-gradient-to-r ${gradMap[color]}`} />
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-[11px] font-semibold tracking-wide text-slate-500">Coil Fouling Trend (7d)</div>
                    <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ring-1 ${badgeMap[color]}`}>{label}</span>
                  </div>
                  <div className="mt-2 flex items-baseline gap-2">
                    <div className="text-2xl font-extrabold tracking-tight text-slate-900">
                      {slope !== null ? slope.toFixed(3) : "—"}
                    </div>
                    <div className="text-sm font-medium text-slate-500">units/day</div>
                  </div>
                  <div className="mt-1 text-[10px] text-slate-400">Linear slope of CoilFoulingFactor over 7d</div>
                </div>
              </div>
            );
          })()}

          {/* Belt Remaining Life */}
          {(() => {
            const pct = kpis?.belt_remaining_life_pct ?? null;
            const color = pct === null ? "slate" : pct > 40 ? "emerald" : pct > 15 ? "amber" : "red";
            const badgeMap: Record<string, string> = {
              emerald: "bg-emerald-50 text-emerald-700 ring-emerald-200",
              amber:   "bg-amber-50 text-amber-700 ring-amber-200",
              red:     "bg-red-50 text-red-700 ring-red-200",
              slate:   "bg-slate-50 text-slate-600 ring-slate-200",
            };
            const gradMap: Record<string, string> = {
              emerald: "from-emerald-400 to-teal-400",
              amber:   "from-amber-400 to-orange-400",
              red:     "from-red-400 to-rose-500",
              slate:   "from-slate-300 to-slate-400",
            };
            const label = pct === null ? "—" : pct > 40 ? "Good" : pct > 15 ? "Monitor" : "Replace Soon";
            return (
              <div className="group overflow-hidden rounded-2xl border border-rose-100 bg-white/90 shadow-lg backdrop-blur-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-2xl">
                <div className={`h-1 w-full bg-gradient-to-r ${gradMap[color]}`} />
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-[11px] font-semibold tracking-wide text-slate-500">Belt Remaining Life</div>
                    <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ring-1 ${badgeMap[color]}`}>{label}</span>
                  </div>
                  <div className="mt-2 flex items-baseline gap-2">
                    <div className="text-2xl font-extrabold tracking-tight text-slate-900">
                      {pct !== null ? pct.toFixed(1) : "—"}
                    </div>
                    <div className="text-sm font-medium text-slate-500">%</div>
                  </div>
                  {pct !== null && (
                    <div className="mt-2 h-1.5 w-full rounded-full bg-slate-100">
                      <div className={`h-1.5 rounded-full bg-gradient-to-r ${gradMap[color]} transition-all`} style={{ width: `${pct}%` }} />
                    </div>
                  )}
                  <div className="mt-1 text-[10px] text-slate-400">Based on 2000 hr design life</div>
                </div>
              </div>
            );
          })()}

          {/* MTBA */}
          {(() => {
            const mtba = kpis?.mtba_hours_7d ?? null;
            const color = mtba === null ? "slate" : mtba >= 48 ? "emerald" : mtba >= 12 ? "amber" : "red";
            const badgeMap: Record<string, string> = {
              emerald: "bg-emerald-50 text-emerald-700 ring-emerald-200",
              amber:   "bg-amber-50 text-amber-700 ring-amber-200",
              red:     "bg-red-50 text-red-700 ring-red-200",
              slate:   "bg-slate-50 text-slate-600 ring-slate-200",
            };
            const label = mtba === null ? "—" : mtba >= 48 ? "Reliable" : mtba >= 12 ? "Watch" : "Unstable";
            return (
              <div className="group overflow-hidden rounded-2xl border border-indigo-100 bg-white/90 shadow-lg backdrop-blur-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-2xl">
                <div className="h-1 w-full bg-gradient-to-r from-indigo-400 via-violet-400 to-purple-500" />
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-[11px] font-semibold tracking-wide text-slate-500">MTBA (7d)</div>
                    <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ring-1 ${badgeMap[color]}`}>{label}</span>
                  </div>
                  <div className="mt-2 flex items-baseline gap-2">
                    <div className="text-2xl font-extrabold tracking-tight text-slate-900">
                      {mtba !== null ? mtba.toFixed(1) : "—"}
                    </div>
                    <div className="text-sm font-medium text-slate-500">hrs</div>
                  </div>
                  <div className="mt-1 text-[10px] text-slate-400">Mean time between alarm events</div>
                </div>
              </div>
            );
          })()}

          {/* Filter DP Acceleration */}
          {(() => {
            const acc = kpis?.dp_acceleration_pa_per_day ?? null;
            const color = acc === null ? "slate" : acc <= 0 ? "emerald" : acc <= 2 ? "amber" : "red";
            const badgeMap: Record<string, string> = {
              emerald: "bg-emerald-50 text-emerald-700 ring-emerald-200",
              amber:   "bg-amber-50 text-amber-700 ring-amber-200",
              red:     "bg-red-50 text-red-700 ring-red-200",
              slate:   "bg-slate-50 text-slate-600 ring-slate-200",
            };
            const gradMap: Record<string, string> = {
              emerald: "from-emerald-400 to-teal-400",
              amber:   "from-amber-400 to-orange-400",
              red:     "from-red-400 to-rose-500",
              slate:   "from-slate-300 to-slate-400",
            };
            const label = acc === null ? "—" : acc <= 0 ? "Stable" : acc <= 2 ? "Speeding Up" : "Spike";
            return (
              <div className="group overflow-hidden rounded-2xl border border-red-100 bg-white/90 shadow-lg backdrop-blur-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-2xl">
                <div className={`h-1 w-full bg-gradient-to-r ${gradMap[color]}`} />
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-[11px] font-semibold tracking-wide text-slate-500">Filter DP Acceleration</div>
                    <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ring-1 ${badgeMap[color]}`}>{label}</span>
                  </div>
                  <div className="mt-2 flex items-baseline gap-2">
                    <div className="text-2xl font-extrabold tracking-tight text-slate-900">
                      {acc !== null ? (acc > 0 ? "+" : "") + acc.toFixed(2) : "—"}
                    </div>
                    <div className="text-sm font-medium text-slate-500">Pa/day</div>
                  </div>
                  <div className="mt-1 text-[10px] text-slate-400">Change in DP growth rate vs prior 24h</div>
                </div>
              </div>
            );
          })()}
        </section>

        <section className="mt-6 grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
          <SidebarTree
            ahuId={ahuId}
            tree={TAG_TREE}
            selectedTag={selectedTag}
            onSelectTag={(tag) => setSelectedTag(tag.value)}
          />

          <div className="overflow-hidden rounded-2xl border border-sky-100 bg-white/90 shadow-lg backdrop-blur-sm">
            <div className="h-1 w-full bg-gradient-to-r from-sky-400 via-cyan-400 to-blue-500" />
            <div className="p-4">
              <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                <div>
                  <div className="text-[11px] font-semibold tracking-wide text-slate-500">
                    SELECTED TAG TREND
                  </div>
                  <h2 className="mt-1 text-lg font-bold text-slate-900">
                    {selectedTrend?.label ?? "Trend"}
                  </h2>
                  <div className="mt-1 text-sm text-slate-500">
                    AHU: {ahuId} • Unit: {selectedTrend?.unit || "—"}
                  </div>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row no-print">
                  <select
                    value={selectedHours}
                    onChange={(e) => setSelectedHours(e.target.value)}
                    className="rounded-xl border border-sky-100 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm outline-none"
                  >
                    <option value="1">Last 1 hour</option>
                    <option value="6">Last 6 hours</option>
                    <option value="12">Last 12 hours</option>
                    <option value="24">Last 24 hours</option>
                    <option value="72">Last 3 days</option>
                    <option value="168">Last 7 days</option>
                  </select>
                </div>
              </div>

              <div className="mb-4">
                <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-600">
                  Selected Range Summary
                </h3>
                <div className="grid gap-3 sm:grid-cols-3">
                  <StatCard
                    title="Min"
                    value={fmt(selectedStats.min, 2)}
                    unit={selectedTrend?.unit}
                  />
                  <StatCard
                    title="Avg"
                    value={fmt(selectedStats.avg, 2)}
                    unit={selectedTrend?.unit}
                  />
                  <StatCard
                    title="Max"
                    value={fmt(selectedStats.max, 2)}
                    unit={selectedTrend?.unit}
                  />
                </div>
              </div>

              <div className="mb-4 grid gap-4 lg:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-600">
                    Last 1 Hour Statistics
                  </h3>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <StatCard
                      title="Min"
                      value={fmt(stats1h.min, 2)}
                      unit={selectedTrend?.unit}
                    />
                    <StatCard
                      title="Avg"
                      value={fmt(stats1h.avg, 2)}
                      unit={selectedTrend?.unit}
                    />
                    <StatCard
                      title="Max"
                      value={fmt(stats1h.max, 2)}
                      unit={selectedTrend?.unit}
                    />
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-600">
                    Last 24 Hours Statistics
                  </h3>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <StatCard
                      title="Min"
                      value={fmt(stats24h.min, 2)}
                      unit={selectedTrend?.unit}
                    />
                    <StatCard
                      title="Avg"
                      value={fmt(stats24h.avg, 2)}
                      unit={selectedTrend?.unit}
                    />
                    <StatCard
                      title="Max"
                      value={fmt(stats24h.max, 2)}
                      unit={selectedTrend?.unit}
                    />
                  </div>
                </div>
              </div>

              <div className="mb-3 text-sm font-semibold text-slate-700">
                Trend for selected range: Last {selectedHours} hour(s)
              </div>

              <div className="h-[420px] rounded-xl border border-slate-200 bg-white p-2">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      dataKey="time"
                      minTickGap={30}
                      tickFormatter={(value) => formatXAxis(value, selectedHours)}
                    />
                    <YAxis />
                    <Tooltip
                      labelFormatter={(value) => formatXAxis(value, selectedHours)}
                      formatter={(value: number) => [
                        `${Number(value).toFixed(2)} ${selectedTrend?.unit ?? ""}`,
                        selectedTrend?.label ?? "Value",
                      ]}
                    />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="value"
                      name={selectedTrend?.label ?? "Value"}
                      dot={false}
                      strokeWidth={2}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <div className="mt-3 text-xs font-medium text-slate-500">
                {historyErr
                  ? `History error: ${historyErr}`
                  : `Showing ${selectedTrend?.label} over the last ${selectedHours} hour(s). Click any tag in the left sidebar to change the trend.`}
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* ------------------------------------------------------------------ */}
      {/* PDF PRINT LAYOUT                                                   */}
      {/* ------------------------------------------------------------------ */}
      <div className="print-only">
        {/* Cover / Header */}
        <div className="pdf-header">
          <div className="pdf-header-left">
            <div className="pdf-logo">IntelliAHU</div>
            <div className="pdf-tagline">Air Handling Unit Analytics Platform</div>
          </div>
          <div className="pdf-header-right">
            <div className="pdf-report-title">Performance Report</div>
            <div className="pdf-meta-line">AHU: <strong>{ahuId}</strong></div>
            <div className="pdf-meta-line">Generated: <strong>{new Date().toLocaleString()}</strong></div>
          </div>
        </div>

        {/* Divider */}
        <div className="pdf-divider" />

        {/* Report scope */}
        <div className="pdf-scope-bar">
          <span>Tag: <strong>{selectedTrend?.label ?? "—"}</strong></span>
          <span>Unit: <strong>{selectedTrend?.unit || "—"}</strong></span>
          <span>Range: <strong>Last {selectedHours} hour(s)</strong></span>
          <span>Data points: <strong>{selectedStats.count}</strong></span>
        </div>

        {/* Section 1 — System KPIs (24h) */}
        <div className="pdf-section-title">System KPIs — Last 24 Hours</div>
        <div className="pdf-kpi-grid">
          <div className="pdf-kpi-card">
            <div className="pdf-kpi-label">Avg CHW Inlet Temp</div>
            <div className="pdf-kpi-value">{fmt(kpis?.avg_chw_inlet_24h, 2)}<span className="pdf-kpi-unit"> °C</span></div>
          </div>
          <div className="pdf-kpi-card">
            <div className="pdf-kpi-label">Avg CHW ΔT</div>
            <div className="pdf-kpi-value">{fmt(kpis?.avg_chw_deltaT_24h, 2)}<span className="pdf-kpi-unit"> °C</span></div>
          </div>
          <div className="pdf-kpi-card">
            <div className="pdf-kpi-label">Filter ΔP Growth (7d)</div>
            <div className="pdf-kpi-value">{fmt(kpis?.filter_dp_growth_rate_7d_pa_per_day, 2)}<span className="pdf-kpi-unit"> Pa/day</span></div>
          </div>
          <div className="pdf-kpi-card">
            <div className="pdf-kpi-label">Fan Runtime</div>
            <div className="pdf-kpi-value">{fmt(kpis?.fan_runtime_hours_24h, 2)}<span className="pdf-kpi-unit"> hrs</span></div>
          </div>
          <div className="pdf-kpi-card">
            <div className="pdf-kpi-label">Peak Cooling Demand</div>
            <div className="pdf-kpi-value">{fmt(kpis?.peak_cooling_demand_24h, 1)}<span className="pdf-kpi-unit"> TR</span></div>
          </div>
          <div className="pdf-kpi-card pdf-kpi-card-alarm">
            <div className="pdf-kpi-label">Alarm Time Share</div>
            <div className="pdf-kpi-value">{typeof kpis?.alarm_pct_24h === "number" ? kpis.alarm_pct_24h.toFixed(1) : "—"}<span className="pdf-kpi-unit"> %</span></div>
          </div>
        </div>

        {/* Section 1b — Energy, Cost & Efficiency KPIs */}
        <div className="pdf-section-title">Energy · Cost · Efficiency — Last 24 Hours</div>
        <div className="pdf-kpi-grid">
          <div className="pdf-kpi-card pdf-kpi-card-energy">
            <div className="pdf-kpi-label">Cooling Energy</div>
            <div className="pdf-kpi-value">{fmt(kpis?.cooling_energy_kwh_24h, 1)}<span className="pdf-kpi-unit"> kWh</span></div>
          </div>
          <div className="pdf-kpi-card pdf-kpi-card-energy">
            <div className="pdf-kpi-label">Filter Remaining Life</div>
            <div className="pdf-kpi-value">{fmt(kpis?.filter_remaining_life_pct, 1)}<span className="pdf-kpi-unit"> %</span></div>
          </div>
          <div className="pdf-kpi-card pdf-kpi-card-energy">
            <div className="pdf-kpi-label">Est. Electricity Cost</div>
            <div className="pdf-kpi-value">${fmt(kpis?.est_electricity_cost_usd_24h, 2)}</div>
          </div>
          <div className="pdf-kpi-card pdf-kpi-card-energy">
            <div className="pdf-kpi-label">COP (Avg)</div>
            <div className="pdf-kpi-value">{fmt(kpis?.cop_24h, 2)}<span className="pdf-kpi-unit"> Q/W</span></div>
          </div>
        </div>

        {/* Section 1c — Predictive Maintenance KPIs */}
        <div className="pdf-section-title">Predictive Maintenance — 7-Day Analysis</div>
        <div className="pdf-kpi-grid">
          <div className="pdf-kpi-card pdf-kpi-card-maint">
            <div className="pdf-kpi-label">Coil Fouling Trend (7d)</div>
            <div className="pdf-kpi-value">{fmt(kpis?.coil_fouling_slope_7d, 3)}<span className="pdf-kpi-unit"> units/day</span></div>
          </div>
          <div className="pdf-kpi-card pdf-kpi-card-maint">
            <div className="pdf-kpi-label">Belt Remaining Life</div>
            <div className="pdf-kpi-value">{fmt(kpis?.belt_remaining_life_pct, 1)}<span className="pdf-kpi-unit"> %</span></div>
          </div>
          <div className="pdf-kpi-card pdf-kpi-card-maint">
            <div className="pdf-kpi-label">MTBA (7d)</div>
            <div className="pdf-kpi-value">{fmt(kpis?.mtba_hours_7d, 1)}<span className="pdf-kpi-unit"> hrs</span></div>
          </div>
          <div className="pdf-kpi-card pdf-kpi-card-maint">
            <div className="pdf-kpi-label">Filter DP Acceleration</div>
            <div className="pdf-kpi-value">
              {kpis?.dp_acceleration_pa_per_day !== null && kpis?.dp_acceleration_pa_per_day !== undefined
                ? (kpis.dp_acceleration_pa_per_day > 0 ? "+" : "") + kpis.dp_acceleration_pa_per_day.toFixed(2)
                : "—"}
              <span className="pdf-kpi-unit"> Pa/day</span>
            </div>
          </div>
        </div>

        {/* Section 2 — Selected Tag Statistics */}
        <div className="pdf-section-title">Tag Statistics — {selectedTrend?.label ?? "Selected Tag"}</div>
        <div className="pdf-stats-grid">
          {/* Selected range */}
          <div className="pdf-stats-block">
            <div className="pdf-stats-block-title">Selected Range (last {selectedHours}h)</div>
            <table className="pdf-stats-table">
              <tbody>
                <tr><td>Min</td><td><strong>{fmt(selectedStats.min, 2)} {selectedTrend?.unit}</strong></td></tr>
                <tr><td>Avg</td><td><strong>{fmt(selectedStats.avg, 2)} {selectedTrend?.unit}</strong></td></tr>
                <tr><td>Max</td><td><strong>{fmt(selectedStats.max, 2)} {selectedTrend?.unit}</strong></td></tr>
                <tr><td>Samples</td><td><strong>{selectedStats.count}</strong></td></tr>
              </tbody>
            </table>
          </div>
          {/* 1h */}
          <div className="pdf-stats-block">
            <div className="pdf-stats-block-title">Last 1 Hour</div>
            <table className="pdf-stats-table">
              <tbody>
                <tr><td>Min</td><td><strong>{fmt(stats1h.min, 2)} {selectedTrend?.unit}</strong></td></tr>
                <tr><td>Avg</td><td><strong>{fmt(stats1h.avg, 2)} {selectedTrend?.unit}</strong></td></tr>
                <tr><td>Max</td><td><strong>{fmt(stats1h.max, 2)} {selectedTrend?.unit}</strong></td></tr>
                <tr><td>Samples</td><td><strong>{stats1h.count}</strong></td></tr>
              </tbody>
            </table>
          </div>
          {/* 24h */}
          <div className="pdf-stats-block">
            <div className="pdf-stats-block-title">Last 24 Hours</div>
            <table className="pdf-stats-table">
              <tbody>
                <tr><td>Min</td><td><strong>{fmt(stats24h.min, 2)} {selectedTrend?.unit}</strong></td></tr>
                <tr><td>Avg</td><td><strong>{fmt(stats24h.avg, 2)} {selectedTrend?.unit}</strong></td></tr>
                <tr><td>Max</td><td><strong>{fmt(stats24h.max, 2)} {selectedTrend?.unit}</strong></td></tr>
                <tr><td>Samples</td><td><strong>{stats24h.count}</strong></td></tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Section 3 — Trend Chart */}
        <div className="pdf-section-title">Trend — Last {selectedHours} Hour(s)</div>
        <div className="pdf-chart-box">
          <LineChart
            width={720}
            height={280}
            data={printChartData}
            margin={{ top: 10, right: 20, left: 10, bottom: 20 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="label" minTickGap={30} tick={{ fontSize: 10, fill: "#64748b" }} />
            <YAxis tick={{ fontSize: 10, fill: "#64748b" }} />
            <Tooltip
              formatter={(value: number) => [
                `${Number(value).toFixed(2)} ${selectedTrend?.unit ?? ""}`,
                selectedTrend?.label ?? "Value",
              ]}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line
              type="monotone"
              dataKey="value"
              name={selectedTrend?.label ?? "Value"}
              stroke="#0ea5e9"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </div>

        {/* Section 4 — Data table (last 30 readings) */}
        <div className="pdf-section-title">Recent Readings (last 30 samples)</div>
        <table className="pdf-data-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Timestamp</th>
              <th>Value ({selectedTrend?.unit || "—"})</th>
              <th>vs Avg</th>
            </tr>
          </thead>
          <tbody>
            {printChartData.slice(-30).map((p, i) => {
              const diff = selectedStats.avg !== null && p.value !== null
                ? p.value - selectedStats.avg
                : null;
              return (
                <tr key={i}>
                  <td>{printChartData.length - 30 + i + 1}</td>
                  <td>{p.label}</td>
                  <td>{typeof p.value === "number" ? p.value.toFixed(2) : "—"}</td>
                  <td style={{ color: diff === null ? "#94a3b8" : diff > 0 ? "#dc2626" : "#16a34a" }}>
                    {diff === null ? "—" : `${diff > 0 ? "+" : ""}${diff.toFixed(2)}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Footer */}
        <div className="pdf-footer">
          <span>IntelliAHU Analytics Platform</span>
          <span>Confidential — For internal use only</span>
          <span>Generated {new Date().toLocaleDateString()}</span>
        </div>
      </div>

      <style jsx global>{`
        @page {
          size: A4;
          margin: 14mm 12mm;
        }

        .print-only {
          display: none;
        }

        @media print {
          html, body {
            background: white !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
            font-family: "Segoe UI", system-ui, sans-serif;
            font-size: 11px;
            color: #1e293b;
          }

          .screen-root { display: none !important; }
          .print-only  { display: block !important; }
          .no-print    { display: none !important; }

          /* ---- Header ---- */
          .pdf-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            padding-bottom: 12px;
          }
          .pdf-logo {
            font-size: 22px;
            font-weight: 900;
            color: #0369a1;
            letter-spacing: -0.5px;
          }
          .pdf-tagline {
            font-size: 10px;
            color: #64748b;
            margin-top: 2px;
          }
          .pdf-header-right { text-align: right; }
          .pdf-report-title {
            font-size: 15px;
            font-weight: 700;
            color: #0f172a;
          }
          .pdf-meta-line {
            font-size: 10px;
            color: #475569;
            margin-top: 2px;
          }

          /* ---- Divider ---- */
          .pdf-divider {
            height: 3px;
            background: linear-gradient(to right, #0ea5e9, #06b6d4, #3b82f6);
            border-radius: 2px;
            margin: 8px 0;
          }

          /* ---- Scope bar ---- */
          .pdf-scope-bar {
            display: flex;
            gap: 24px;
            background: #f0f9ff;
            border: 1px solid #bae6fd;
            border-radius: 6px;
            padding: 7px 12px;
            font-size: 10px;
            color: #0369a1;
            margin-bottom: 14px;
          }

          /* ---- Section titles ---- */
          .pdf-section-title {
            font-size: 11px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: #0369a1;
            border-bottom: 1px solid #bae6fd;
            padding-bottom: 4px;
            margin: 14px 0 8px;
          }

          /* ---- KPI grid ---- */
          .pdf-kpi-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 8px;
            margin-bottom: 4px;
          }
          .pdf-kpi-card {
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            padding: 8px 10px;
            background: #f8fafc;
          }
          .pdf-kpi-card-alarm {
            background: #fff7ed;
            border-color: #fed7aa;
          }
          .pdf-kpi-card-energy {
            background: #f0fdf4;
            border-color: #bbf7d0;
          }
          .pdf-kpi-card-maint {
            background: #fff1f2;
            border-color: #fecdd3;
          }
          .pdf-kpi-label {
            font-size: 9px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.04em;
            color: #64748b;
            margin-bottom: 4px;
          }
          .pdf-kpi-value {
            font-size: 18px;
            font-weight: 800;
            color: #0f172a;
            line-height: 1;
          }
          .pdf-kpi-unit {
            font-size: 11px;
            font-weight: 500;
            color: #64748b;
          }

          /* ---- Stats grid ---- */
          .pdf-stats-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 8px;
          }
          .pdf-stats-block {
            border: 1px solid #e2e8f0;
            border-radius: 6px;
            padding: 8px 10px;
          }
          .pdf-stats-block-title {
            font-size: 9px;
            font-weight: 700;
            text-transform: uppercase;
            color: #475569;
            margin-bottom: 6px;
          }
          .pdf-stats-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 10px;
          }
          .pdf-stats-table td {
            padding: 2px 4px;
            color: #374151;
          }
          .pdf-stats-table td:first-child {
            color: #94a3b8;
            width: 50%;
          }

          /* ---- Chart ---- */
          .pdf-chart-box {
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            padding: 8px;
            background: #ffffff;
          }

          /* ---- Data table ---- */
          .pdf-data-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 9.5px;
          }
          .pdf-data-table th {
            background: #0ea5e9;
            color: white;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.03em;
            padding: 5px 8px;
            text-align: left;
          }
          .pdf-data-table td {
            padding: 4px 8px;
            border-bottom: 1px solid #f1f5f9;
            color: #334155;
          }
          .pdf-data-table tr:nth-child(even) td {
            background: #f8fafc;
          }

          /* ---- Footer ---- */
          .pdf-footer {
            display: flex;
            justify-content: space-between;
            margin-top: 16px;
            padding-top: 8px;
            border-top: 1px solid #e2e8f0;
            font-size: 9px;
            color: #94a3b8;
          }
        }
      `}</style>
    </>
  );
}