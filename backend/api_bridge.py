import asyncio
import json
from datetime import datetime, timedelta, timezone
from typing import Dict, Any, List, Set, Optional

import asyncpg
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from asyncua import Client

from db_config import DB_CONFIG

# ----------------------------
# OPC Endpoints
# ----------------------------

# Kepware OPC UA endpoint (live AHU tags)
KEPWARE_OPC_URL = "opc.tcp://localhost:49320"

# Python simulated OPC UA server (graph series)
PYTHON_OPC_URL = "opc.tcp://localhost:4840/ahu-opcua/"

# ----------------------------
# Kepware live tag mapping
# Adjust paths if your Kepware hierarchy changes
# Current assumed structure:
# AHU_Channel.AHU_Device.AHU_001.<Tag>
# ----------------------------

KEPWARE_TAG_MAP = {
    "ChilledWaterInletTemp_C": "AHU_Channel.AHU_Device.AHU_001.CHW_Inlet_Temp",
    "ChilledWaterOutletTemp_C": "AHU_Channel.AHU_Device.AHU_001.CHW_Outlet_Temp",
    "ChilledWaterFlowRate_kgps": "AHU_Channel.AHU_Device.AHU_001.CHW_Flow_Rate",
    "MixedAirTemp_C": "AHU_Channel.AHU_Device.AHU_001.Mixed_Air_Temp",
    "MixedAirPressure_Pa": "AHU_Channel.AHU_Device.AHU_001.Mixed_Air_Pressure",
    "InletFilterDP_Pa": "AHU_Channel.AHU_Device.AHU_001.Filter_DP",
    "DischargeAirTemp_C": "AHU_Channel.AHU_Device.AHU_001.Discharge_Air_Temp",
    "DischargeAirMassFlow_kgps": "AHU_Channel.AHU_Device.AHU_001.Discharge_Air_Mass_Flow",
    "CoolingDemand_TR": "AHU_Channel.AHU_Device.AHU_001.Cooling_Demand",
    "FanSpeed_rpm": "AHU_Channel.AHU_Device.AHU_001.Fan_Speed",
    "CoilFoulingFactor": "AHU_Channel.AHU_Device.AHU_001.Coil_Fouling_Factor",
    "OverallHeatTransferCoeff": "AHU_Channel.AHU_Device.AHU_001.Overall_Heat_Transfer_Coeff",
    "RunningUsefulHoursOfBelt_hr": "AHU_Channel.AHU_Device.AHU_001.Running_Useful_Hours_Belt",
    "ExpectedLifeOfFilter_hr": "AHU_Channel.AHU_Device.AHU_001.Expected_Life_Filter",
    "RunningHours_hr": "AHU_Channel.AHU_Device.AHU_001.Running_Hours",
    "AHUStatus": "AHU_Channel.AHU_Device.AHU_001.AHU_Status",
}
   


# ----------------------------
# Python OPC graph tags
# Current structure:
# Objects -> IntelliAHU -> AHU-0001 -> Series
# ----------------------------

PYTHON_SERIES_TAGS = [
    "CHW_Energy_Expected",
    "CHW_Energy_Current",
    "CoolingDemand_Btu",
    "CoolingDelivered_Btu",
]

app = FastAPI(title="AHU OPC Bridge API (Kepware + Python OPC + Postgres)")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
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


# ----------------------------
# Utility
# ----------------------------
def _format_series_for_frontend(points: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out = []
    for i, p in enumerate(points):
        out.append({
            "time": f"{i + 1}",
            "chwExpected": p.get("CHW_Energy_Expected"),
            "chwCurrent": p.get("CHW_Energy_Current"),
            "demand": p.get("CoolingDemand_Btu"),
            "delivered": p.get("CoolingDelivered_Btu"),
        })
    return out


def _to_float_if_possible(val):
    try:
        if isinstance(val, bool):
            return val
        if isinstance(val, (int, float)):
            return float(val)
        return val
    except Exception:
        return val


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
# DB init and insert
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
# Historical KPI API
# ----------------------------
@app.get("/api/kpis")
async def get_kpis(ahuId: str = "AHU-0001"):
    if DB_POOL is None:
        return {"error": "DB not initialized"}

    now = datetime.now(timezone.utc)
    t24 = now - timedelta(hours=24)
    t7d = now - timedelta(days=7)

    async with DB_POOL.acquire() as conn:
        avg_chw_inlet = await conn.fetchval(
            """
            SELECT AVG(value_num)
            FROM tag_reading
            WHERE ahu_id=$1 AND tag_name='ChilledWaterInletTemp_C'
              AND time >= $2
            """,
            ahuId, t24
        )

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

        alarm_pct = await conn.fetchval(
            """
            SELECT 100.0 * AVG(CASE WHEN value_text='ALARM' THEN 1 ELSE 0 END)
            FROM tag_reading
            WHERE ahu_id=$1 AND tag_name='AHUStatus'
              AND time >= $2
            """,
            ahuId, t24
        )

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

        peak_cooling = await conn.fetchval(
            """
            SELECT MAX(value_num)
            FROM tag_reading
            WHERE ahu_id=$1 AND tag_name='CoolingDemand_TR'
              AND time >= $2
            """,
            ahuId, t24
        )

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
    
@app.get("/api/history")
async def get_history(
    ahuId: str = "AHU-0001",
    tag: str = "ChilledWaterInletTemp_C",
    hours: int = 24,
):
    if DB_POOL is None:
        return {"error": "DB not initialized"}

    now = datetime.now(timezone.utc)
    start_time = now - timedelta(hours=hours)

    async with DB_POOL.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT time, value_num, value_text
            FROM tag_reading
            WHERE ahu_id = $1
              AND tag_name = $2
              AND time >= $3
            ORDER BY time ASC
            """,
            ahuId,
            tag,
            start_time,
        )

    points = []
    for row in rows:
        points.append(
            {
                "time": row["time"].isoformat(),
                "value": float(row["value_num"]) if row["value_num"] is not None else None,
                "text": row["value_text"],
            }
        )

    return {
        "ahuId": ahuId,
        "tag": tag,
        "hours": hours,
        "points": points,
    }


# ----------------------------
# Main loop:
# Kepware for latest values
# Python OPC server for graph series
# ----------------------------
async def poll_dual_opc_forever():
    global LATEST, SERIES_BUFFER

    ahu_id = "AHU-0001"

    while True:
        kepware_client = None
        python_client = None

        try:
            kepware_client = Client(url=KEPWARE_OPC_URL, timeout=5)
            python_client = Client(url=PYTHON_OPC_URL, timeout=5)

            await kepware_client.connect()
            await python_client.connect()

            print("✅ Connected to Kepware OPC UA")
            print("✅ Connected to Python OPC UA (graphs)")

            # Prepare Kepware nodes
            kepware_nodes = {}
            for logical_name, kepware_path in KEPWARE_TAG_MAP.items():
                node_id = f"ns=2;s={kepware_path}"
                kepware_nodes[logical_name] = kepware_client.get_node(node_id)

            # Prepare Python graph nodes using browse path
            py_objects = python_client.nodes.objects
            py_root = await py_objects.get_child(["2:IntelliAHU"])
            py_ahu = await py_root.get_child(["2:AHU-0001"])
            py_series_folder = await py_ahu.get_child(["2:Series"])

            python_series_nodes = {
                t: await py_series_folder.get_child([f"2:{t}"])
                for t in PYTHON_SERIES_TAGS
            }

            while True:
                # ----------------------------
                # 1. Read latest values from Kepware
                # ----------------------------
                values: Dict[str, Any] = {}

                for logical_name, node in kepware_nodes.items():
                    try:
                        raw_val = await node.read_value()
                        values[logical_name] = _to_float_if_possible(raw_val)
                    except Exception:
                        values[logical_name] = None

                ts = asyncio.get_event_loop().time()
                LATEST = {
                    "ahuId": ahu_id,
                    "values": values,
                    "ts": ts,
                }

                # ----------------------------
                # 2. Read graph series from Python OPC server
                # ----------------------------
                point: Dict[str, Any] = {"ts": ts}
                for tag_name, node in python_series_nodes.items():
                    try:
                        point[tag_name] = _to_float_if_possible(await node.read_value())
                    except Exception:
                        point[tag_name] = None

                SERIES_BUFFER.append(point)
                if len(SERIES_BUFFER) > 120:
                    SERIES_BUFFER = SERIES_BUFFER[-120:]

                # ----------------------------
                # 3. Store latest values into Postgres
                # ----------------------------
                await db_insert_snapshot(ahu_id, values)

                # ----------------------------
                # 4. Broadcast to frontend
                # ----------------------------
                payload = {
                    "type": "update",
                    "latest": LATEST,
                    "series": _format_series_for_frontend(SERIES_BUFFER[-30:]),
                }
                await ws_manager.broadcast(ahu_id, payload)

                await asyncio.sleep(1)

        except Exception as e:
            print("⚠️ OPC reconnecting due to error:", repr(e))
            await asyncio.sleep(3)

        finally:
            try:
                if kepware_client:
                    await kepware_client.disconnect()
            except Exception:
                pass

            try:
                if python_client:
                    await python_client.disconnect()
            except Exception:
                pass


@app.on_event("startup")
async def startup_event():
    await db_init()
    asyncio.create_task(poll_dual_opc_forever())