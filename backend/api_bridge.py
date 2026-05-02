import asyncio
import json
from collections import defaultdict
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Set

import asyncpg
from asyncua import Client
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from db_config import DB_CONFIG

# ---------------------------------------------------------------------------
# Kepware OPC UA endpoint
# ---------------------------------------------------------------------------
KEPWARE_URL = "opc.tcp://localhost:49320"

# Tag path template: ns=2;s=<kepware_path>
KEPWARE_TAG_MAP = {
    "ChilledWaterInletTemp_C":      "AHU_Channel.AHU_Device.AHU_001.CHW_Inlet_Temp",
    "ChilledWaterOutletTemp_C":     "AHU_Channel.AHU_Device.AHU_001.CHW_Outlet_Temp",
    "ChilledWaterFlowRate_kgps":    "AHU_Channel.AHU_Device.AHU_001.CHW_Flow_Rate",
    "MixedAirTemp_C":               "AHU_Channel.AHU_Device.AHU_001.Mixed_Air_Temp",
    "MixedAirPressure_Pa":          "AHU_Channel.AHU_Device.AHU_001.Mixed_Air_Pressure",
    "InletFilterDP_Pa":             "AHU_Channel.AHU_Device.AHU_001.Filter_DP",
    "DischargeAirTemp_C":           "AHU_Channel.AHU_Device.AHU_001.Discharge_Air_Temp",
    "DischargeAirMassFlow_kgps":    "AHU_Channel.AHU_Device.AHU_001.Discharge_Air_Mass_Flow",
    "CoolingDemand_TR":             "AHU_Channel.AHU_Device.AHU_001.Cooling_Demand",
    "FanSpeed_rpm":                 "AHU_Channel.AHU_Device.AHU_001.Fan_Speed",
    "CoilFoulingFactor":            "AHU_Channel.AHU_Device.AHU_001.Coil_Fouling_Factor",
    "OverallHeatTransferCoeff":     "AHU_Channel.AHU_Device.AHU_001.Overall_Heat_Transfer_Coeff",
    "RunningUsefulHoursOfBelt_hr":  "AHU_Channel.AHU_Device.AHU_001.Running_Useful_Hours_Belt",
    "ExpectedLifeOfFilter_hr":      "AHU_Channel.AHU_Device.AHU_001.Expected_Life_Filter",
    "RunningHours_hr":              "AHU_Channel.AHU_Device.AHU_001.Running_Hours",
    "AHUStatus":                    "AHU_Channel.AHU_Device.AHU_001.AHU_Status",
}

# Series tags shown on the dashboard charts.
# Computed from Kepware values — no separate OPC server needed.
SERIES_TAGS = ["CHW_Energy_Expected", "CHW_Energy_Current", "CoolingDemand_Btu", "CoolingDelivered_Btu"]

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(_: FastAPI):
    await db_init()
    asyncio.create_task(poll_kepware_forever())
    yield


app = FastAPI(title="AHU Pipeline — Kepware -> Postgres -> Dashboard", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000", "http://localhost:3001"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DB_POOL: Optional[asyncpg.Pool] = None

# In-memory cache — always populated from DB, never from OPC directly
LATEST: Dict[str, Any] = {"ahuId": "AHU-0001", "values": {}, "ts": None}
SERIES_BUFFER: List[Dict[str, Any]] = []


# ---------------------------------------------------------------------------
# WebSocket manager
# ---------------------------------------------------------------------------
class WSManager:
    def __init__(self):
        self.clients: Dict[str, Set[WebSocket]] = {}

    async def connect(self, ahu_id: str, ws: WebSocket):
        await ws.accept()
        self.clients.setdefault(ahu_id, set()).add(ws)

    def disconnect(self, ahu_id: str, ws: WebSocket):
        self.clients.get(ahu_id, set()).discard(ws)

    async def broadcast(self, ahu_id: str, payload: dict):
        dead = []
        msg = json.dumps(payload)
        for ws in list(self.clients.get(ahu_id, set())):
            try:
                await ws.send_text(msg)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ahu_id, ws)


ws_manager = WSManager()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _to_float(val) -> Optional[float]:
    try:
        if isinstance(val, bool):
            return None
        return float(val)
    except Exception:
        return None


def _compute_series(values: Dict[str, Any]) -> Dict[str, Optional[float]]:
    """Derive the 4 chart series from Kepware tag values."""
    chw_inlet = _to_float(values.get("ChilledWaterInletTemp_C"))
    chw_outlet = _to_float(values.get("ChilledWaterOutletTemp_C"))
    chw_flow = _to_float(values.get("ChilledWaterFlowRate_kgps"))
    cooling_tr = _to_float(values.get("CoolingDemand_TR"))

    # CHW energy: Q = m_dot * Cp * dT  (Cp water ~4.186 kJ/kg·K)
    cp = 4.186
    if chw_flow is not None and chw_inlet is not None and chw_outlet is not None:
        delta_t = chw_outlet - chw_inlet
        chw_current = chw_flow * cp * abs(delta_t)        # kW
        chw_expected = chw_flow * cp * 6.0                # expected dT = 6 K baseline
    else:
        chw_current = None
        chw_expected = None

    # Cooling demand/delivered in Btu/hr  (1 TR = 12000 Btu/hr)
    cooling_demand_btu = cooling_tr * 12000 if cooling_tr is not None else None
    # Delivered = current CHW energy transfer in same unit
    cooling_delivered_btu = chw_current * 3412.14 if chw_current is not None else None

    return {
        "CHW_Energy_Expected": round(chw_expected, 2) if chw_expected is not None else None,
        "CHW_Energy_Current": round(chw_current, 2) if chw_current is not None else None,
        "CoolingDemand_Btu": round(cooling_demand_btu, 1) if cooling_demand_btu is not None else None,
        "CoolingDelivered_Btu": round(cooling_delivered_btu, 1) if cooling_delivered_btu is not None else None,
    }


def _format_series_for_frontend(points: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [
        {
            "time": str(i + 1),
            "chwExpected": p.get("CHW_Energy_Expected"),
            "chwCurrent": p.get("CHW_Energy_Current"),
            "demand": p.get("CoolingDemand_Btu"),
            "delivered": p.get("CoolingDelivered_Btu"),
        }
        for i, p in enumerate(points)
    ]


# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------
async def db_init():
    global DB_POOL
    DB_POOL = await asyncpg.create_pool(
        host=DB_CONFIG["host"],
        port=DB_CONFIG["port"],
        user=DB_CONFIG["user"],
        password=DB_CONFIG["password"],
        database=DB_CONFIG["database"],
        min_size=2,
        max_size=10,
    )
    async with DB_POOL.acquire() as conn:
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS tag_reading (
                id        SERIAL PRIMARY KEY,
                time      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                ahu_id    TEXT NOT NULL,
                tag_name  TEXT NOT NULL,
                value_num DOUBLE PRECISION,
                value_text TEXT
            )
        """)
        await conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_tag_reading_lookup
            ON tag_reading (ahu_id, tag_name, time DESC)
        """)
    print("[DB] Connected and schema ready")


async def db_write(ahu_id: str, values: Dict[str, Any]):
    """Insert one row per tag into tag_reading."""
    now = datetime.now(timezone.utc)
    rows = []
    for tag, val in values.items():
        if isinstance(val, (int, float)) and not isinstance(val, bool):
            rows.append((now, ahu_id, tag, float(val), None))
        elif val is not None:
            rows.append((now, ahu_id, tag, None, str(val)))
    if not rows:
        return
    async with DB_POOL.acquire() as conn:
        await conn.executemany(
            "INSERT INTO tag_reading (time, ahu_id, tag_name, value_num, value_text) "
            "VALUES ($1, $2, $3, $4, $5)",
            rows,
        )


async def db_read_latest(ahu_id: str) -> Dict[str, Any]:
    """Return the single most-recent value for every tag."""
    async with DB_POOL.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT DISTINCT ON (tag_name) tag_name, value_num, value_text
            FROM tag_reading
            WHERE ahu_id = $1
            ORDER BY tag_name, time DESC
            """,
            ahu_id,
        )
    result = {}
    for r in rows:
        result[r["tag_name"]] = float(r["value_num"]) if r["value_num"] is not None else r["value_text"]
    return result


async def db_read_series(ahu_id: str, n: int = 120) -> List[Dict[str, Any]]:
    """Return the last n time-bucketed points for the 4 chart series tags."""
    async with DB_POOL.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT time, tag_name, value_num
            FROM tag_reading
            WHERE ahu_id = $1
              AND tag_name = ANY($2::text[])
            ORDER BY time DESC
            LIMIT $3
            """,
            ahu_id,
            SERIES_TAGS,
            n * len(SERIES_TAGS),
        )
    buckets: Dict[str, Dict[str, Any]] = defaultdict(dict)
    for r in rows:
        key = r["time"].replace(microsecond=0).isoformat()
        buckets[key][r["tag_name"]] = float(r["value_num"]) if r["value_num"] is not None else None

    sorted_keys = sorted(buckets)[-n:]
    return [{"ts": k, **buckets[k]} for k in sorted_keys]


# ---------------------------------------------------------------------------
# WebSocket endpoint
# ---------------------------------------------------------------------------
@app.websocket("/ws/ahu/{ahu_id}")
async def ws_ahu(ahu_id: str, ws: WebSocket):
    await ws_manager.connect(ahu_id, ws)
    try:
        # Send current DB state immediately on connect
        await ws.send_text(json.dumps({
            "type": "snapshot",
            "latest": LATEST if ahu_id == "AHU-0001" else {"ahuId": ahu_id, "values": {}, "ts": None},
            "series": _format_series_for_frontend(SERIES_BUFFER[-30:]),
        }))
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        ws_manager.disconnect(ahu_id, ws)


# ---------------------------------------------------------------------------
# REST endpoints (analytics page)
# ---------------------------------------------------------------------------
@app.get("/api/kpis")
async def get_kpis(ahuId: str = "AHU-0001"):
    if DB_POOL is None:
        return {"error": "DB not ready"}

    now = datetime.now(timezone.utc)
    t24 = now - timedelta(hours=24)
    t7d = now - timedelta(days=7)

    async with DB_POOL.acquire() as conn:
        avg_chw_inlet = await conn.fetchval(
            "SELECT AVG(value_num) FROM tag_reading "
            "WHERE ahu_id=$1 AND tag_name='ChilledWaterInletTemp_C' AND time>=$2",
            ahuId, t24,
        )
        avg_deltaT = await conn.fetchval(
            """
            WITH inlet AS (
              SELECT date_trunc('minute', time) t, AVG(value_num) v
              FROM tag_reading WHERE ahu_id=$1 AND tag_name='ChilledWaterInletTemp_C' AND time>=$2
              GROUP BY 1
            ), outlet AS (
              SELECT date_trunc('minute', time) t, AVG(value_num) v
              FROM tag_reading WHERE ahu_id=$1 AND tag_name='ChilledWaterOutletTemp_C' AND time>=$2
              GROUP BY 1
            )
            SELECT AVG(outlet.v - inlet.v) FROM inlet JOIN outlet USING (t)
            """,
            ahuId, t24,
        )
        dp_first = await conn.fetchval(
            "SELECT AVG(value_num) FROM tag_reading "
            "WHERE ahu_id=$1 AND tag_name='InletFilterDP_Pa' AND time>=$2 AND time<$3",
            ahuId, t7d, t7d + timedelta(days=1),
        )
        dp_last = await conn.fetchval(
            "SELECT AVG(value_num) FROM tag_reading "
            "WHERE ahu_id=$1 AND tag_name='InletFilterDP_Pa' AND time>=$2",
            ahuId, now - timedelta(days=1),
        )
        growth_rate = (
            (float(dp_last) - float(dp_first)) / 7.0
            if dp_first is not None and dp_last is not None
            else None
        )
        alarm_pct = await conn.fetchval(
            "SELECT 100.0 * AVG(CASE WHEN value_text='ALARM' THEN 1 ELSE 0 END) "
            "FROM tag_reading WHERE ahu_id=$1 AND tag_name='AHUStatus' AND time>=$2",
            ahuId, t24,
        )
        fan_on_pct = await conn.fetchval(
            "SELECT 100.0 * AVG(CASE WHEN value_num > 100 THEN 1 ELSE 0 END) "
            "FROM tag_reading WHERE ahu_id=$1 AND tag_name='FanSpeed_rpm' AND time>=$2",
            ahuId, t24,
        )
        fan_runtime_hours = (float(fan_on_pct) / 100.0) * 24.0 if fan_on_pct is not None else None
        peak_cooling = await conn.fetchval(
            "SELECT MAX(value_num) FROM tag_reading "
            "WHERE ahu_id=$1 AND tag_name='CoolingDemand_TR' AND time>=$2",
            ahuId, t24,
        )

        # --- Tier 1 KPIs ---

        # 1. Cooling energy (kWh) over 24h
        # Q = m_dot * Cp * |dT|  integrated over time (each sample = 1s interval)
        # Sum of (flow * 4.186 * |outlet - inlet|) per sample, then convert kJ -> kWh (/3600)
        cooling_energy_kwh = await conn.fetchval(
            """
            WITH flow AS (
              SELECT date_trunc('second', time) t, AVG(value_num) v
              FROM tag_reading WHERE ahu_id=$1 AND tag_name='ChilledWaterFlowRate_kgps' AND time>=$2
              GROUP BY 1
            ), inlet AS (
              SELECT date_trunc('second', time) t, AVG(value_num) v
              FROM tag_reading WHERE ahu_id=$1 AND tag_name='ChilledWaterInletTemp_C' AND time>=$2
              GROUP BY 1
            ), outlet AS (
              SELECT date_trunc('second', time) t, AVG(value_num) v
              FROM tag_reading WHERE ahu_id=$1 AND tag_name='ChilledWaterOutletTemp_C' AND time>=$2
              GROUP BY 1
            )
            SELECT SUM(flow.v * 4.186 * ABS(outlet.v - inlet.v)) / 3600.0
            FROM flow
            JOIN inlet  USING (t)
            JOIN outlet USING (t)
            WHERE flow.v IS NOT NULL AND inlet.v IS NOT NULL AND outlet.v IS NOT NULL
            """,
            ahuId, t24,
        )

        # 2. Filter remaining life %
        # Clean filter baseline ~50 Pa, replace threshold ~250 Pa
        FILTER_CLEAN_PA = 50.0
        FILTER_REPLACE_PA = 250.0
        avg_dp = await conn.fetchval(
            "SELECT AVG(value_num) FROM tag_reading "
            "WHERE ahu_id=$1 AND tag_name='InletFilterDP_Pa' AND time>=$2",
            ahuId, t24,
        )
        filter_remaining_pct = None
        if avg_dp is not None:
            dp = float(avg_dp)
            filter_remaining_pct = max(0.0, min(100.0,
                (FILTER_REPLACE_PA - dp) / (FILTER_REPLACE_PA - FILTER_CLEAN_PA) * 100.0
            ))

        # 3. Estimated electricity cost (24h)
        # Fan power estimated: P_fan ≈ (flow_rate * pressure_drop) / fan_efficiency
        # Using MixedAirPressure_Pa and DischargeAirMassFlow_kgps, eta=0.7, rho_air=1.2 kg/m3
        # P (kW) = (m_dot/rho * dP) / (eta * 1000)
        # Electricity rate: $0.12 / kWh (configurable)
        ELECTRICITY_RATE_USD_PER_KWH = 0.12
        FAN_EFFICIENCY = 0.70
        AIR_DENSITY = 1.2  # kg/m3

        fan_power_avg = await conn.fetchval(
            """
            WITH mflow AS (
              SELECT date_trunc('minute', time) t, AVG(value_num) v
              FROM tag_reading WHERE ahu_id=$1 AND tag_name='DischargeAirMassFlow_kgps' AND time>=$2
              GROUP BY 1
            ), dp AS (
              SELECT date_trunc('minute', time) t, AVG(value_num) v
              FROM tag_reading WHERE ahu_id=$1 AND tag_name='MixedAirPressure_Pa' AND time>=$2
              GROUP BY 1
            )
            SELECT AVG((mflow.v / $3) * dp.v / ($4 * 1000.0))
            FROM mflow JOIN dp USING (t)
            WHERE mflow.v IS NOT NULL AND dp.v IS NOT NULL
            """,
            ahuId, t24, AIR_DENSITY, FAN_EFFICIENCY,
        )
        # Total cost = (CHW pump energy + fan energy) * rate
        # CHW pump energy approximated as 15% of cooling energy
        est_electricity_cost = None
        if cooling_energy_kwh is not None or fan_power_avg is not None:
            chw_kwh = float(cooling_energy_kwh) if cooling_energy_kwh is not None else 0.0
            fan_kwh = float(fan_power_avg) * 24.0 if fan_power_avg is not None else 0.0
            total_kwh = chw_kwh + fan_kwh + (chw_kwh * 0.15)  # +15% for CHW pump
            est_electricity_cost = total_kwh * ELECTRICITY_RATE_USD_PER_KWH

        # 4. COP (Coefficient of Performance) over 24h
        # COP = Q_cooling / W_fan  (both in same unit, kW)
        avg_cooling_kw = await conn.fetchval(
            """
            WITH flow AS (
              SELECT date_trunc('minute', time) t, AVG(value_num) v
              FROM tag_reading WHERE ahu_id=$1 AND tag_name='ChilledWaterFlowRate_kgps' AND time>=$2
              GROUP BY 1
            ), inlet AS (
              SELECT date_trunc('minute', time) t, AVG(value_num) v
              FROM tag_reading WHERE ahu_id=$1 AND tag_name='ChilledWaterInletTemp_C' AND time>=$2
              GROUP BY 1
            ), outlet AS (
              SELECT date_trunc('minute', time) t, AVG(value_num) v
              FROM tag_reading WHERE ahu_id=$1 AND tag_name='ChilledWaterOutletTemp_C' AND time>=$2
              GROUP BY 1
            )
            SELECT AVG(flow.v * 4.186 * ABS(outlet.v - inlet.v))
            FROM flow JOIN inlet USING (t) JOIN outlet USING (t)
            WHERE flow.v IS NOT NULL AND inlet.v IS NOT NULL AND outlet.v IS NOT NULL
            """,
            ahuId, t24,
        )
        cop = None
        if avg_cooling_kw is not None and fan_power_avg is not None and float(fan_power_avg) > 0:
            cop = float(avg_cooling_kw) / float(fan_power_avg)

    f = lambda x: float(x) if x is not None else None
    return {
        "ahuId": ahuId,
        "window": {"from": t24.isoformat(), "to": now.isoformat()},
        "avg_chw_inlet_24h": f(avg_chw_inlet),
        "avg_chw_deltaT_24h": f(avg_deltaT),
        "filter_dp_growth_rate_7d_pa_per_day": f(growth_rate),
        "alarm_pct_24h": f(alarm_pct),
        "fan_runtime_hours_24h": f(fan_runtime_hours),
        "peak_cooling_demand_24h": f(peak_cooling),
        # Tier 1
        "cooling_energy_kwh_24h": f(cooling_energy_kwh),
        "filter_remaining_life_pct": f(filter_remaining_pct),
        "est_electricity_cost_usd_24h": f(est_electricity_cost),
        "cop_24h": f(cop),
    }


@app.get("/api/history")
async def get_history(ahuId: str = "AHU-0001", tag: str = "ChilledWaterInletTemp_C", hours: int = 24):
    if DB_POOL is None:
        return {"error": "DB not ready"}

    start = datetime.now(timezone.utc) - timedelta(hours=hours)
    async with DB_POOL.acquire() as conn:
        rows = await conn.fetch(
            "SELECT time, value_num, value_text FROM tag_reading "
            "WHERE ahu_id=$1 AND tag_name=$2 AND time>=$3 ORDER BY time ASC",
            ahuId, tag, start,
        )
    return {
        "ahuId": ahuId,
        "tag": tag,
        "hours": hours,
        "points": [
            {
                "time": r["time"].isoformat(),
                "value": float(r["value_num"]) if r["value_num"] is not None else None,
                "text": r["value_text"],
            }
            for r in rows
        ],
    }


# ---------------------------------------------------------------------------
# Kepware polling loop  —  single source of truth
# Pipeline: Kepware -> DB write -> DB read -> WebSocket broadcast
# ---------------------------------------------------------------------------
async def poll_kepware_forever():
    global LATEST, SERIES_BUFFER
    ahu_id = "AHU-0001"

    while True:
        client = None
        try:
            client = Client(url=KEPWARE_URL, timeout=5)
            await client.connect()
            print("[OK] Connected to Kepware OPC UA")

            # Resolve all nodes once after connecting
            nodes = {
                name: client.get_node(f"ns=2;s={path}")
                for name, path in KEPWARE_TAG_MAP.items()
            }

            while True:
                # 1. Read all tags from Kepware
                raw: Dict[str, Any] = {}
                for name, node in nodes.items():
                    try:
                        val = await node.read_value()
                        raw[name] = _to_float(val) if not isinstance(val, str) else val
                    except Exception:
                        raw[name] = None

                # 2. Compute derived series values from Kepware data
                series = _compute_series(raw)
                all_values = {**raw, **series}

                # 3. Write to Postgres
                await db_write(ahu_id, all_values)

                # 4. Read back from Postgres (DB is now the single source)
                db_values = await db_read_latest(ahu_id)
                LATEST = {"ahuId": ahu_id, "values": db_values, "ts": datetime.now(timezone.utc).isoformat()}

                SERIES_BUFFER = await db_read_series(ahu_id, n=120)

                # 5. Push to all connected WebSocket clients
                await ws_manager.broadcast(ahu_id, {
                    "type": "update",
                    "latest": LATEST,
                    "series": _format_series_for_frontend(SERIES_BUFFER[-30:]),
                })

                await asyncio.sleep(1)

        except Exception as e:
            print(f"[WARN] Kepware connection lost: {e!r} — retrying in 3s")
            await asyncio.sleep(3)
        finally:
            if client:
                try:
                    await client.disconnect()
                except Exception:
                    pass


