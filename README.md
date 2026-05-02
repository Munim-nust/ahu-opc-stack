# AHU OPC UA Dashboard

A full-stack Air Handling Unit (AHU) monitoring and analytics system. Live sensor data is read from **Kepware OPC UA**, written to **PostgreSQL**, and streamed to a **Next.js** dashboard via WebSockets. All data shown on the dashboard originates exclusively from the database — Kepware is the single source of truth.

---

## Architecture

```
Kepware OPC UA (port 49320)
        │  poll every 1 s
        ▼
  FastAPI Backend
        │  write all tags + computed series
        ▼
  PostgreSQL (tag_reading table)
        │  read back latest + series
        ▼
  WebSocket broadcast → Realtime Dashboard (Next.js)
  REST API           → Analytics Page   (Next.js)
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16, React 19, TypeScript, Recharts, Tailwind CSS 4 |
| Backend | Python FastAPI, asyncua (OPC UA client), asyncpg |
| Database | PostgreSQL 16 |
| Protocol | OPC UA via Kepware (live tags) |

---

## Features

- **Realtime Dashboard** — 16 live AHU tag cards + 2 animated line charts (CHW Energy, Cooling Demand/Delivered) streamed via WebSocket
- **Historical Analytics** — tag trend explorer with 1h / 6h / 12h / 24h / 3d / 7d range selector, min/avg/max statistics
- **Tier 1 Energy KPIs** — computed every poll cycle from raw Kepware values:
  - Cooling energy consumption (kWh/24h)
  - Filter remaining life % with progress bar
  - Estimated electricity cost ($/24h at $0.12/kWh)
  - Coefficient of Performance (COP = Q_cooling / W_fan)
- **PDF Report** — professional print layout with branded header, all KPI cards, trend chart, and last-30-readings data table
- **Alarm tracking** — % time in ALARM state with radial gauge

---

## Prerequisites

- Python 3.11+
- Node.js 18+
- PostgreSQL 16
- Kepware KEPServerEX (or compatible OPC UA server) running on `opc.tcp://localhost:49320`

---

## Setup

### 1. Clone

```bash
git clone https://github.com/Munim-nust/ahu-opc-stack.git
cd ahu-opc-stack
```

### 2. Backend

```bash
cd backend
python -m venv venv
venv\Scripts\activate          # Windows
pip install -r requirements.txt
```

### 3. Database

```bash
"C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres
```

```sql
CREATE DATABASE ahu_db;
\q
```

The backend creates the `tag_reading` table and index automatically on first startup.

### 4. Database config

```bash
copy db_config.example.py db_config.py
```

Edit `db_config.py` and set your PostgreSQL password.

### 5. Frontend

```bash
cd frontend
npm install
```

---

## Running

Two terminals required (Kepware must already be running):

**Terminal 1 — FastAPI backend**
```bash
cd backend
venv\Scripts\activate
set PYTHONIOENCODING=utf-8
python -m uvicorn api_bridge:app --port 8001
```

**Terminal 2 — Next.js frontend**
```bash
cd frontend
npm run dev
```

| URL | Description |
|---|---|
| http://localhost:3000 | Realtime dashboard |
| http://localhost:3000/analytics | Historical KPIs & analytics |
| http://localhost:8001/docs | FastAPI Swagger UI |

---

## Kepware Tag Mapping

The backend reads the following tags from Kepware under `AHU_Channel.AHU_Device.AHU_001`:

| Logical Name | Kepware Tag | Unit |
|---|---|---|
| ChilledWaterInletTemp_C | CHW_Inlet_Temp | °C |
| ChilledWaterOutletTemp_C | CHW_Outlet_Temp | °C |
| ChilledWaterFlowRate_kgps | CHW_Flow_Rate | kg/s |
| MixedAirTemp_C | Mixed_Air_Temp | °C |
| MixedAirPressure_Pa | Mixed_Air_Pressure | Pa |
| InletFilterDP_Pa | Filter_DP | Pa |
| DischargeAirTemp_C | Discharge_Air_Temp | °C |
| DischargeAirMassFlow_kgps | Discharge_Air_Mass_Flow | kg/s |
| CoolingDemand_TR | Cooling_Demand | TR |
| FanSpeed_rpm | Fan_Speed | RPM |
| CoilFoulingFactor | Coil_Fouling_Factor | — |
| OverallHeatTransferCoeff | Overall_Heat_Transfer_Coeff | — |
| RunningUsefulHoursOfBelt_hr | Running_Useful_Hours_Belt | hr |
| ExpectedLifeOfFilter_hr | Expected_Life_Filter | hr |
| RunningHours_hr | Running_Hours | hr |
| AHUStatus | AHU_Status | ON/ALARM |

Four chart series tags (`CHW_Energy_Expected`, `CHW_Energy_Current`, `CoolingDemand_Btu`, `CoolingDelivered_Btu`) are computed from the Kepware values and stored alongside them.

---

## KPI Calculations

| KPI | Formula |
|---|---|
| Cooling Energy (kWh) | `∑ (m_dot × 4.186 × │T_out − T_in│) / 3600` integrated over 24h |
| Filter Remaining Life % | `(250 − avg_DP_Pa) / (250 − 50) × 100` (50 Pa = clean, 250 Pa = replace) |
| Est. Electricity Cost | `(cooling_kWh + fan_kWh + 15% pump) × $0.12/kWh` |
| COP | `avg_cooling_kW / avg_fan_power_kW` |
| CHW Energy (chart) | `m_dot × Cp × │ΔT│` (kW) |
| Cooling Btu (chart) | `CoolingDemand_TR × 12000` |

---

## Database Schema

```sql
CREATE TABLE tag_reading (
    id         SERIAL PRIMARY KEY,
    time       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ahu_id     TEXT NOT NULL,
    tag_name   TEXT NOT NULL,
    value_num  DOUBLE PRECISION,
    value_text TEXT
);

CREATE INDEX idx_tag_reading_lookup
ON tag_reading (ahu_id, tag_name, time DESC);
```

Query latest values:
```sql
SELECT DISTINCT ON (tag_name) tag_name, value_num, value_text, time
FROM tag_reading
ORDER BY tag_name, time DESC;
```

---

## Project Structure

```
ahu-opc-stack/
├── backend/
│   ├── api_bridge.py        # FastAPI app — OPC poller, DB writer, WebSocket, REST API
│   ├── opc_server.py        # Python OPC UA server (dev/simulation fallback)
│   ├── opc_write_cli.py     # CLI tool to manually write OPC tags
│   ├── db_config.py         # PostgreSQL connection config (gitignored)
│   ├── db_config.example.py # Config template
│   └── requirements.txt
└── frontend/
    └── app/
        ├── page.tsx              # Realtime dashboard
        ├── analytics/page.tsx    # Historical KPIs + PDF report
        └── api/
            ├── kpis/route.ts     # Proxy → /api/kpis
            └── history/route.ts  # Proxy → /api/history
```
