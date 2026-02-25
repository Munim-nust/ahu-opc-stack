import asyncio
import json
from datetime import datetime, timedelta, timezone
from typing import Dict, Any, List, Set, Optional

import asyncpg
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from asyncua import Client

from db_config import DB_CONFIG

OPC_ENDPOINT = "opc.tcp://localhost:4840/ahu-opcua/"

TAGS = [
    "ChilledWaterInletTemp_C",
    "ChilledWaterOutletTemp_C",
    "ChilledWaterFlowRate_kgps",
    "MixedAirTemp_C",
    "MixedAirPressure_Pa",
    "InletFilterDP_Pa",
    "DischargeAirTemp_C",
    "DischargeAirMassFlow_kgps",
    "CoolingDemand_TR",
    "FanSpeed_rpm",
    "CoilFoulingFactor",
    "OverallHeatTransferCoeff",
    "RunningUsefulHoursOfBelt_hr",
    "ExpectedLifeOfFilter_hr",
    "RunningHours_hr",
    "AHUStatus",
]

SERIES_TAGS = [
    "CHW_Energy_Expected",
    "CHW_Energy_Current",
    "CoolingDemand_Btu",
    "CoolingDelivered_Btu",
]

app = FastAPI(title="AHU OPC Bridge API (WebSockets + Postgres)")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

LATEST: Dict[str, Any] = {"ahuId": "AHU-0001", "values": {}, "ts": None}
SERIES_BUFFER: List[Dict[str, Any]] = []

DB_POOL: Optional[asyncpg.Pool] = None


# ----------------------------
# WebSocket connection manager
# ----------------------------
class WSManager:
    def __init__(self):
        self.clients_by_ahu: Dict[str, Set[WebSocket]] = {}

    async def connect(self, ahu_id: str, ws: WebSocket):
        await ws.accept()
        self.clients_by_ahu.setdefault(ahu_id, set()).add(ws)

    def disconnect(self, ahu_id: str, ws: WebSocket):
        if ahu_id in self.clients_by_ahu:
            self.clients_by_ahu[ahu_id].discard(ws)
            if not self.clients_by_ahu[ahu_id]:
                del self.clients_by_ahu[ahu_id]

    async def broadcast(self, ahu_id: str, payload: dict):
        clients = list(self.clients_by_ahu.get(ahu_id, set()))
        if not clients:
            return

        dead = []
        msg = json.dumps(payload)

        for ws in clients:
            try:
                await ws.send_text(msg)
            except Exception:
                dead.append(ws)

        for ws in dead:
            self.disconnect(ahu_id, ws)


ws_manager = WSManager()


def _format_series_for_frontend(points: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out = []
    for i, p in enumerate(points):
        out.append({
            "time": f"{i+1}",
            "chwExpected": p.get("CHW_Energy_Expected"),
            "chwCurrent": p.get("CHW_Energy_Current"),
            "demand": p.get("CoolingDemand_Btu"),
            "delivered": p.get("CoolingDelivered_Btu"),
        })
    return out


# ----------------------------
# WebSocket endpoint
# ----------------------------
@app.websocket("/ws/ahu/{ahu_id}")
async def ws_ahu(ahu_id: str, ws: WebSocket):
    await ws_manager.connect(ahu_id, ws)
    try:
        await ws.send_text(json.dumps({
            "type": "snapshot",
            "latest": LATEST if ahu_id == "AHU-0001" else {"ahuId": ahu_id, "values": {}, "ts": None},
            "series": _format_series_for_frontend(SERIES_BUFFER[-30:]),
        }))
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        ws_manager.disconnect(ahu_id, ws)


# ----------------------------
# DB helpers
# ----------------------------
async def db_init():
    global DB_POOL
    DB_POOL = await asyncpg.create_pool(
        host=DB_CONFIG["host"],
        port=DB_CONFIG["port"],
        user=DB_CONFIG["user"],
        password=DB_CONFIG["password"],
        database=DB_CONFIG["database"],
        min_size=1,
        max_size=5,
    )

    # Ensure table exists
    async with DB_POOL.acquire() as conn:
        await conn.execute("""
        CREATE TABLE IF NOT EXISTS tag_reading (
            id SERIAL PRIMARY KEY,
            time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            ahu_id TEXT NOT NULL,
            tag_name TEXT NOT NULL,
            value_num DOUBLE PRECISION,
            value_text TEXT
        );
        """)
        await conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_tag_reading_lookup
        ON tag_reading (ahu_id, tag_name, time DESC);
        """)


async def db_insert_snapshot(ahu_id: str, values: Dict[str, Any]):
    """
    Insert ONE snapshot worth of tag readings.
    Numeric tags go into value_num, text tags go into value_text.
    """
    if DB_POOL is None:
        return

    now = datetime.now(timezone.utc)

    rows = []
    for tag, val in values.items():
        if isinstance(val, (int, float)):
            rows.append((now, ahu_id, tag, float(val), None))
        else:
            rows.append((now, ahu_id, tag, None, str(val)))

    async with DB_POOL.acquire() as conn:
        await conn.executemany(
            """
            INSERT INTO tag_reading (time, ahu_id, tag_name, value_num, value_text)
            VALUES ($1, $2, $3, $4, $5)
            """,
            rows,
        )


# ----------------------------
# KPI endpoint (6 historical KPIs)
# ----------------------------
@app.get("/api/kpis")
async def get_kpis(ahuId: str = "AHU-0001"):
    """
    Returns:
    1) avg_chw_inlet_24h
    2) avg_chw_deltaT_24h = (Outlet - Inlet)
    3) filter_dp_growth_rate_7d (Pa/day) (rough)
    4) alarm_pct_24h
    5) fan_runtime_hours_24h (approx)
    6) peak_cooling_demand_24h
    """
    if DB_POOL is None:
        return {"error": "DB not initialized"}

    now = datetime.now(timezone.utc)
    t24 = now - timedelta(hours=24)
    t7d = now - timedelta(days=7)

    async with DB_POOL.acquire() as conn:
        # 1) Avg CHW inlet 24h
        avg_chw_inlet = await conn.fetchval(
            """
            SELECT AVG(value_num)
            FROM tag_reading
            WHERE ahu_id=$1 AND tag_name='ChilledWaterInletTemp_C'
              AND time >= $2
            """,
            ahuId, t24
        )

        # 2) Avg DeltaT 24h (Outlet - Inlet) using minute buckets
        avg_deltaT = await conn.fetchval(
            """
            WITH inlet AS (
              SELECT date_trunc('minute', time) AS t, AVG(value_num) AS v
              FROM tag_reading
              WHERE ahu_id=$1 AND tag_name='ChilledWaterInletTemp_C' AND time >= $2
              GROUP BY 1
            ),
            outlet AS (
              SELECT date_trunc('minute', time) AS t, AVG(value_num) AS v
              FROM tag_reading
              WHERE ahu_id=$1 AND tag_name='ChilledWaterOutletTemp_C' AND time >= $2
              GROUP BY 1
            )
            SELECT AVG(outlet.v - inlet.v)
            FROM inlet
            JOIN outlet USING (t)
            """,
            ahuId, t24
        )

        # 3) Filter DP growth rate 7d (Pa/day) = (avg last day - avg first day) / 7
        dp_first = await conn.fetchval(
            """
            SELECT AVG(value_num)
            FROM tag_reading
            WHERE ahu_id=$1 AND tag_name='InletFilterDP_Pa'
              AND time >= $2 AND time < $3
            """,
            ahuId, t7d, t7d + timedelta(days=1)
        )

        dp_last = await conn.fetchval(
            """
            SELECT AVG(value_num)
            FROM tag_reading
            WHERE ahu_id=$1 AND tag_name='InletFilterDP_Pa'
              AND time >= $2
            """,
            ahuId, now - timedelta(days=1)
        )

        growth_rate = None
        if dp_first is not None and dp_last is not None:
            growth_rate = (float(dp_last) - float(dp_first)) / 7.0

        # 4) % time in ALARM (24h) based on samples
        alarm_pct = await conn.fetchval(
            """
            SELECT 100.0 * AVG(CASE WHEN value_text='ALARM' THEN 1 ELSE 0 END)
            FROM tag_reading
            WHERE ahu_id=$1 AND tag_name='AHUStatus'
              AND time >= $2
            """,
            ahuId, t24
        )

        # 5) Fan runtime hours (24h) approx: % samples FanSpeed > 100 rpm * 24h
        fan_on_pct = await conn.fetchval(
            """
            SELECT 100.0 * AVG(CASE WHEN value_num > 100 THEN 1 ELSE 0 END)
            FROM tag_reading
            WHERE ahu_id=$1 AND tag_name='FanSpeed_rpm'
              AND time >= $2
            """,
            ahuId, t24
        )

        fan_runtime_hours = None
        if fan_on_pct is not None:
            fan_runtime_hours = (float(fan_on_pct) / 100.0) * 24.0

        # 6) Peak cooling demand 24h
        peak_cooling = await conn.fetchval(
            """
            SELECT MAX(value_num)
            FROM tag_reading
            WHERE ahu_id=$1 AND tag_name='CoolingDemand_TR'
              AND time >= $2
            """,
            ahuId, t24
        )

    # Convert Decimal-like values to float for clean JSON
    def f(x):
        return float(x) if x is not None else None

    return {
        "ahuId": ahuId,
        "window": {"from": t24.isoformat(), "to": now.isoformat()},
        "avg_chw_inlet_24h": f(avg_chw_inlet),
        "avg_chw_deltaT_24h": f(avg_deltaT),
        "filter_dp_growth_rate_7d_pa_per_day": f(growth_rate),
        "alarm_pct_24h": f(alarm_pct),
        "fan_runtime_hours_24h": f(fan_runtime_hours),
        "peak_cooling_demand_24h": f(peak_cooling),
    }
# ----------------------------
# OPC polling loop (dev mode)
# ----------------------------
async def poll_opc_forever():
    global LATEST, SERIES_BUFFER

    ahu_id = "AHU-0001"

    while True:
        try:
            async with Client(url=OPC_ENDPOINT, timeout=5) as client:
                objects = client.nodes.objects
                intelli = await objects.get_child(["2:IntelliAHU"])
                ahu = await intelli.get_child([f"2:{ahu_id}"])
                tags_folder = await ahu.get_child(["2:Tags"])
                series_folder = await ahu.get_child(["2:Series"])

                tag_nodes = {t: await tags_folder.get_child([f"2:{t}"]) for t in TAGS}
                series_nodes = {t: await series_folder.get_child([f"2:{t}"]) for t in SERIES_TAGS}

                while True:
                    values: Dict[str, Any] = {}
                    for t, node in tag_nodes.items():
                        values[t] = await node.read_value()

                    # Update latest snapshot
                    ts = asyncio.get_event_loop().time()
                    LATEST = {"ahuId": ahu_id, "values": values, "ts": ts}

                    # Store series buffer for charts (still in-memory)
                    point: Dict[str, Any] = {"ts": ts}
                    for t, node in series_nodes.items():
                        point[t] = await node.read_value()

                    SERIES_BUFFER.append(point)
                    if len(SERIES_BUFFER) > 120:
                        SERIES_BUFFER = SERIES_BUFFER[-120:]

                    # ✅ Insert snapshot into Postgres (historian)
                    await db_insert_snapshot(ahu_id, values)

                    # ✅ Broadcast to WS clients (realtime)
                    payload = {
                        "type": "update",
                        "latest": LATEST,
                        "series": _format_series_for_frontend(SERIES_BUFFER[-30:]),
                    }
                    await ws_manager.broadcast(ahu_id, payload)

                    await asyncio.sleep(1)

        except Exception as e:
            print(" OPC bridge reconnecting due to error:", repr(e))
            await asyncio.sleep(2)


@app.on_event("startup")
async def startup_event():
    await db_init()
    asyncio.create_task(poll_opc_forever())