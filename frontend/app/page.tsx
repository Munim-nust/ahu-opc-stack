"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import Link from "next/link";

type LatestPayload = {
  ahuId: string;
  values: Record<string, any>;
  ts: number | null;
};

type WsMessage =
  | { type: "snapshot"; latest: LatestPayload; series: any[] }
  | { type: "update"; latest: LatestPayload; series: any[] };

function Card({
  title,
  value,
  unit,
}: {
  title: string;
  value: any;
  unit?: string;
}) {
  return (
    <div className="group overflow-hidden rounded-2xl border border-sky-100 bg-white/90 shadow-lg backdrop-blur-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-2xl">
      {/* Accent strip */}
      <div className="h-1 w-full bg-gradient-to-r from-sky-400 via-cyan-400 to-blue-500" />

      <div className="p-4">
        <div className="text-[11px] font-semibold tracking-wide text-slate-500">
          {title}
        </div>

        <div className="mt-2 flex items-baseline gap-2">
          <div className="text-2xl font-extrabold tracking-tight text-slate-900">
            {value ?? "-"}
          </div>
          {unit && <div className="text-sm font-medium text-slate-500">{unit}</div>}
        </div>
      </div>
    </div>
  );
}

export default function Page() {
  const [latest, setLatest] = useState<LatestPayload | null>(null);
  const [series, setSeries] = useState<any[]>([]);
  const [wsState, setWsState] = useState<
    "connecting" | "connected" | "disconnected"
  >("connecting");

  useEffect(() => {
    let alive = true;
    const ahuId = "AHU-0001";
    const ws = new WebSocket(`ws://localhost:8000/ws/ahu/${ahuId}`);

    ws.onopen = () => {
      if (!alive) return;
      setWsState("connected");
      ws.send("hello");
    };

    ws.onmessage = (event) => {
      if (!alive) return;
      try {
        const msg: WsMessage = JSON.parse(event.data);
        setLatest(msg.latest);
        setSeries(msg.series ?? []);
      } catch {
        // ignore
      }
    };

    ws.onerror = () => {
      if (!alive) return;
      setWsState("disconnected");
    };

    ws.onclose = () => {
      if (!alive) return;
      setWsState("disconnected");
    };

    return () => {
      alive = false;
      try {
        ws.close();
      } catch {}
    };
  }, []);

  const v = latest?.values || {};
  const ahuId = latest?.ahuId || "AHU-0001";
  const status = v["AHUStatus"] || "OFF";

  const statusChip =
    status === "ON"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
      : status === "ALARM"
      ? "bg-red-50 text-red-700 ring-red-200"
      : "bg-slate-100 text-slate-700 ring-slate-200";

  const wsBadge = useMemo(() => {
    if (wsState === "connected")
      return {
        text: "Live",
        cls: "bg-emerald-50 text-emerald-700 ring-emerald-200",
        dot: "bg-emerald-500",
        pulse: true,
      };
    if (wsState === "connecting")
      return {
        text: "Connecting",
        cls: "bg-sky-50 text-sky-700 ring-sky-200",
        dot: "bg-sky-500",
        pulse: true,
      };
    return {
      text: "Disconnected",
      cls: "bg-slate-100 text-slate-700 ring-slate-200",
      dot: "bg-slate-400",
      pulse: false,
    };
  }, [wsState]);

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-100 via-sky-50 to-slate-100 p-6 font-sans">
      {/* HEADER */}
      <header className="mb-6 overflow-hidden rounded-2xl bg-gradient-to-r from-sky-500 via-cyan-500 to-blue-600 p-6 shadow-xl shadow-sky-500/20">
        <div className="grid items-center gap-4 md:grid-cols-3">
          {/* Left: AHU + chip */}
          <div className="flex items-center gap-3 md:justify-start">
            <div className="rounded-xl bg-white/15 px-3 py-2 text-xs font-semibold tracking-wide text-white/95 ring-1 ring-white/25">
              {ahuId} • Overview
            </div>
            <div
              className={`inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs font-semibold ring-1 ${wsBadge.cls}`}
            >
              <span
                className={`h-2 w-2 rounded-full ${wsBadge.dot} ${
                  wsBadge.pulse ? "animate-pulse" : ""
                }`}
              />
              {wsBadge.text}
            </div>
          </div>

          {/* Center: Title */}
          <div className="text-center">
            <h1 className="text-3xl font-extrabold tracking-tight text-white">
              AHU Dashboard
            </h1>
            <p className="mt-1 text-sm font-medium text-white/80">
              Live parameters & performance snapshots
            </p>
          </div>

          {/* Right: Nav button */}
          <div className="flex justify-center md:justify-end">
            <Link
              href="/analytics"
              className="inline-flex items-center justify-center rounded-xl bg-white px-5 py-3 text-sm font-bold tracking-wide text-blue-700 shadow-lg transition-all duration-300 hover:-translate-y-0.5 hover:bg-blue-50 hover:shadow-xl"
            >
              View Historical KPIs →
            </Link>
          </div>
        </div>
      </header>

      {/* TWO KPI ROWS */}
      <section className="mb-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold tracking-wide text-slate-700">
            Air & Water Parameters
          </h2>

          <div
            className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold ring-1 ${statusChip}`}
          >
            <span className="h-2 w-2 rounded-full bg-current opacity-80" />
            AHU Status: {status}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-5">
          <Card title="CHW Inlet Temp" value={v["ChilledWaterInletTemp_C"]} unit="°C" />
          <Card title="CHW Outlet Temp" value={v["ChilledWaterOutletTemp_C"]} unit="°C" />
          <Card title="CHW Flow Rate" value={v["ChilledWaterFlowRate_kgps"]} unit="kg/s" />
          <Card title="Mixed Air Temp" value={v["MixedAirTemp_C"]} unit="°C" />
          <Card title="Mixed Air Pressure" value={v["MixedAirPressure_Pa"]} unit="Pa" />
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-3 lg:grid-cols-5">
          <Card title="Inlet Filter ΔP" value={v["InletFilterDP_Pa"]} unit="Pa" />
          <Card title="Discharge Air Temp" value={v["DischargeAirTemp_C"]} unit="°C" />
          <Card
            title="Discharge Air Mass Flow"
            value={v["DischargeAirMassFlow_kgps"]}
            unit="kg/s"
          />
          <Card title="Cooling Demand" value={v["CoolingDemand_TR"]} unit="TR" />
          <Card title="Fan Speed" value={v["FanSpeed_rpm"]} unit="rpm" />
        </div>
      </section>

      {/* TWO GRAPHS */}
      <section className="mb-6 grid gap-6 lg:grid-cols-2">
        <div className="overflow-hidden rounded-2xl border border-sky-100 bg-white/90 p-4 shadow-lg backdrop-blur-sm">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold tracking-wide text-slate-800">
              CHW Energy Transfer
            </h3>
            <span className="text-xs font-medium text-slate-500">Last 30 points</span>
          </div>

          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="time" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="chwExpected" name="Expected" dot={false} />
                <Line type="monotone" dataKey="chwCurrent" name="Current" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-sky-100 bg-white/90 p-4 shadow-lg backdrop-blur-sm">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold tracking-wide text-slate-800">
              Cooling Demand vs Delivered
            </h3>
            <span className="text-xs font-medium text-slate-500">Last 30 points</span>
          </div>

          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="time" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="demand" name="Demand" dot={false} />
                <Line type="monotone" dataKey="delivered" name="Delivered" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      {/* BOTTOM STRIP */}
      <section className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
        <Card title="Coil Fouling Factor" value={v["CoilFoulingFactor"]} />
        <Card title="Overall Heat Transfer Coef" value={v["OverallHeatTransferCoeff"]} />
        <Card
          title="Running Useful Hours Belt"
          value={v["RunningUsefulHoursOfBelt_hr"]}
          unit="hr"
        />
        <Card title="Expected Life of Filter" value={v["ExpectedLifeOfFilter_hr"]} unit="hr" />
        <Card title="Running Hours" value={v["RunningHours_hr"]} unit="hr" />

        <div className="group overflow-hidden rounded-2xl border border-sky-100 bg-white/90 shadow-lg backdrop-blur-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-2xl">
          <div className="h-1 w-full bg-gradient-to-r from-emerald-400 via-sky-400 to-blue-500" />
          <div className="p-4">
            <div className="text-[11px] font-semibold tracking-wide text-slate-500">
              AHU Status
            </div>
            <div className="mt-2 inline-flex items-center gap-2 rounded-full bg-slate-50 px-3 py-2 text-sm font-bold text-slate-800 ring-1 ring-slate-200">
              <span
                className={`h-2.5 w-2.5 rounded-full ${
                  status === "ON"
                    ? "bg-emerald-500"
                    : status === "ALARM"
                    ? "bg-red-500"
                    : "bg-slate-400"
                }`}
              />
              {status}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}