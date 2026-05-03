"""
chat.py — Natural language → SQL → chart data
Uses claude-haiku-3-5 (cheapest, fast) with a compact system prompt.
Schema is embedded once in the system prompt (not re-sent per query).
"""

import os
import re
from datetime import datetime, timezone
from typing import Any

import anthropic
from dotenv import load_dotenv
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

load_dotenv()

router = APIRouter()
_client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

# ---------------------------------------------------------------------------
# System prompt — sent once per call, kept as short as possible
# Schema + tags + formulas + strict output format
# ---------------------------------------------------------------------------
SYSTEM_PROMPT = """You are an HVAC data analyst. Convert questions into SQL + chart configs for PostgreSQL.

TABLE: tag_reading(time TIMESTAMPTZ, ahu_id TEXT, tag_name TEXT, value_num FLOAT8, value_text TEXT)
CRITICAL: This is a narrow (EAV) table. Each row is ONE tag reading. There are NO separate columns per tag.
To get multiple tags as columns you MUST use conditional aggregation (pivot).

AVAILABLE tag_name VALUES (filter: ahu_id='AHU-0001'):
ChilledWaterInletTemp_C, ChilledWaterOutletTemp_C, ChilledWaterFlowRate_kgps,
MixedAirTemp_C, MixedAirPressure_Pa, InletFilterDP_Pa, DischargeAirTemp_C,
DischargeAirMassFlow_kgps, CoolingDemand_TR, FanSpeed_rpm, CoilFoulingFactor,
OverallHeatTransferCoeff, RunningUsefulHoursOfBelt_hr, ExpectedLifeOfFilter_hr,
RunningHours_hr, CHW_Energy_Expected, CHW_Energy_Current, CoolingDemand_Btu, CoolingDelivered_Btu
TEXT ONLY: AHUStatus — stored in value_text (not value_num). Query like:
  SELECT value_text FROM tag_reading WHERE ahu_id='AHU-0001' AND tag_name='AHUStatus' ORDER BY time DESC LIMIT 1

PIVOT PATTERN — use this every time you need multiple tags as columns:
SELECT
  date_trunc('minute', time) AS time,
  AVG(value_num) FILTER (WHERE tag_name='Tag1') AS col1,
  AVG(value_num) FILTER (WHERE tag_name='Tag2') AS col2
FROM tag_reading
WHERE ahu_id='AHU-0001' AND time > NOW()-INTERVAL '1 hour'
  AND tag_name IN ('Tag1','Tag2')
GROUP BY 1 ORDER BY 1 LIMIT 500;

SINGLE TAG PATTERN:
SELECT date_trunc('minute', time) AS time, AVG(value_num) AS col1
FROM tag_reading WHERE ahu_id='AHU-0001' AND tag_name='Tag1' AND time > NOW()-INTERVAL '1 hour'
GROUP BY 1 ORDER BY 1 LIMIT 500;

ENERGY / COOLING (compute from inlet+outlet+flow in the same pivot):
cooling_kw = AVG(flow)*4.186*ABS(AVG(inlet)-AVG(outlet))
Use FILTER(WHERE tag_name=...) for each value then compute in outer SELECT or CTE.

AGGREGATION: date_trunc('minute') for <=6h, date_trunc('hour') for >6h.

CHART SQL SHAPES:
- line/multi_line/area/stacked_area: pivot → (time, col1, col2...)
- bar/stacked_bar: GROUP BY hour bucket → (time, col1, col2...)
- scatter: two numeric cols, no time: SELECT val1 AS xkey, val2 AS ykey FROM pivot
- histogram: SELECT width_bucket(val,min,max,N) AS bucket, COUNT(*) AS count GROUP BY 1 ORDER BY 1
- pie: SELECT category AS name, COUNT(*) AS value ... GROUP BY 1
- radar: SELECT metric AS metric, value AS col FROM (VALUES ...) — use recent AVG for each tag
- composed: pivot with per-series "type":"bar"|"line"|"area"

CRITICAL: SQL aliases MUST EXACTLY match series "key" values. Time column always aliased AS "time".

Respond ONLY with JSON (no markdown, no explanation):
{
  "title": "short title",
  "sql": "SELECT ...",
  "chart_type": "line"|"multi_line"|"bar"|"stacked_bar"|"area"|"stacked_area"|"scatter"|"histogram"|"pie"|"radar"|"composed",
  "x_key": "time",
  "series": [{"key":"col1","label":"Display Name","color":"#hex","type":"line"}],
  "y_unit": "degC",
  "kpi": null
}
For KPI-only: chart_type=null, sql=null.
kpi can be a single object OR an array of objects if multiple values needed:
  kpi={"label":"Max Inlet","value_sql":"SELECT MAX(value_num) FROM tag_reading WHERE ahu_id='AHU-0001' AND tag_name='ChilledWaterInletTemp_C'","unit":"degC"}
  kpi=[{"label":"Max Inlet","value_sql":"...","unit":"degC"},{"label":"Max Outlet","value_sql":"...","unit":"degC"}]
Only SELECT statements allowed."""

# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------
class ChatRequest(BaseModel):
    prompt: str
    ahu_id: str = "AHU-0001"

class SeriesConfig(BaseModel):
    key: str
    label: str
    color: str

class KPIResult(BaseModel):
    label: str
    value: Any
    unit: str

class ChatResponse(BaseModel):
    title: str
    chart_type: str | None
    x_key: str | None
    series: list[SeriesConfig]
    y_unit: str = ""             # default empty — Claude sometimes sends null
    data: list[dict[str, Any]]
    kpi_label: str | None
    kpi_value: Any
    kpis: list[KPIResult]
    sql: str | None

# ---------------------------------------------------------------------------
# Safety check — only allow SELECT
# ---------------------------------------------------------------------------
def _is_safe_sql(sql: str) -> bool:
    clean = sql.strip().upper()
    # Allow SELECT or CTE (WITH ... SELECT)
    if not (clean.startswith("SELECT") or clean.startswith("WITH")):
        return False
    for kw in ("DROP", "DELETE", "UPDATE", "INSERT", "ALTER", "TRUNCATE", "GRANT", "EXEC", "EXECUTE"):
        if re.search(rf"\b{kw}\b", clean):
            return False
    return True

# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------
@router.post("/api/chat", response_model=ChatResponse)
async def chat(req: ChatRequest, db_pool=None):
    # Import here to avoid circular import with api_bridge
    from api_bridge import DB_POOL

    if DB_POOL is None:
        raise HTTPException(status_code=503, detail="DB not ready")

    # --- Call Claude ---
    try:
        response = _client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=900,   # raised: complex multi-KPI responses were truncating at 512
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": req.prompt}],
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Claude API error: {e}")

    usage = response.usage
    in_tok  = usage.input_tokens
    out_tok = usage.output_tokens
    # Haiku pricing: $0.80/M input, $4.00/M output (as of 2025)
    cost_usd = (in_tok * 0.80 + out_tok * 4.00) / 1_000_000
    print(
        f"[CHAT] prompt={repr(req.prompt[:60]):<64} | "
        f"in={in_tok:>4} out={out_tok:>3} tokens | "
        f"cost=${cost_usd:.5f}"
    )

    raw = response.content[0].text.strip()

    # Strip markdown code fences if Claude added them
    raw = re.sub(r"^```(?:json)?\s*", "", raw)
    raw = re.sub(r"\s*```$", "", raw)

    import json
    try:
        config = json.loads(raw)
    except json.JSONDecodeError:
        raise HTTPException(status_code=422, detail=f"Claude returned invalid JSON: {raw[:200]}")

    chart_sql: str | None = config.get("sql")
    raw_kpi = config.get("kpi")
    # Normalise: Claude sometimes returns a list, sometimes a single dict
    if isinstance(raw_kpi, dict):
        kpi_cfgs: list[dict] = [raw_kpi]
    elif isinstance(raw_kpi, list):
        kpi_cfgs = [k for k in raw_kpi if isinstance(k, dict)]
    else:
        kpi_cfgs = []
    data: list[dict] = []
    kpi_results: list[KPIResult] = []

    # --- Run chart SQL ---
    if chart_sql:
        if not _is_safe_sql(chart_sql):
            raise HTTPException(status_code=422, detail="Unsafe SQL rejected")
        try:
            async with DB_POOL.acquire() as conn:
                rows = await conn.fetch(chart_sql)

            series_keys = [s["key"] for s in config.get("series", [])]

            for row in rows:
                raw_point: dict = {}
                for k, v in row.items():
                    if isinstance(v, datetime):
                        raw_point[k] = v.isoformat()
                    elif v is None:
                        raw_point[k] = None
                    else:
                        try:
                            raw_point[k] = float(v)
                        except (TypeError, ValueError):
                            raw_point[k] = str(v)

                # Remap SQL columns to series keys by position when names don't match
                col_names = list(raw_point.keys())
                non_time_cols = [c for c in col_names if c not in ("time", "ts", "bucket", "name")]
                non_time_keys = [k for k in series_keys if k not in ("time", "ts", "bucket", "name")]

                point = {}
                # Always carry time column through unchanged
                for tc in ("time", "ts", "bucket", "name"):
                    if tc in raw_point:
                        point[tc] = raw_point[tc]

                # Map series keys to columns by position
                for i, sk in enumerate(non_time_keys):
                    if sk in raw_point:
                        point[sk] = raw_point[sk]
                    elif i < len(non_time_cols):
                        point[sk] = raw_point[non_time_cols[i]]

                data.append(point)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"SQL error: {e}")

    # --- Run all KPI SQLs ---
    y_unit = config.get("y_unit") or ""
    for kpi_cfg in kpi_cfgs:
        kpi_sql = kpi_cfg.get("value_sql", "")
        if not kpi_sql or not _is_safe_sql(kpi_sql):
            continue
        try:
            async with DB_POOL.acquire() as conn:
                row = await conn.fetchrow(kpi_sql)
            if row is None:
                kpi_val: Any = None
                kpi_display = None
            else:
                # Take first column regardless of type (handles value_text too)
                raw_val = row[0]
                if raw_val is None:
                    kpi_val = None
                    kpi_display = None
                elif isinstance(raw_val, str):
                    # Text value (e.g. AHU status "ON") — pass through as string
                    kpi_val = raw_val
                    kpi_display = raw_val
                else:
                    kpi_val = round(float(raw_val), 3)
                    kpi_display = kpi_val
        except Exception:
            kpi_val = None
            kpi_display = None
        kpi_results.append(KPIResult(
            label=kpi_cfg.get("label", "Value"),
            value=kpi_val,
            unit=kpi_cfg.get("unit", y_unit),
        ))

    first_kpi = kpi_results[0] if kpi_results else None

    return ChatResponse(
        title=config.get("title", "Chart"),
        chart_type=config.get("chart_type"),
        x_key=config.get("x_key", "time"),
        series=[SeriesConfig(**s) for s in config.get("series", [])],
        y_unit=y_unit,
        data=data,
        kpi_label=first_kpi.label if first_kpi else None,
        kpi_value=first_kpi.value if first_kpi else None,
        kpis=kpi_results,
        sql=chart_sql,
    )
