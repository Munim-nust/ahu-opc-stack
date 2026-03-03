🚀 AHU OPC UA Dashboard

A full-stack AHU monitoring and analytics system built using industrial communication protocols and modern web technologies.

🛠 Tech Stack

OPC UA – Simulated AHU server using Python (asyncua)

FastAPI – Backend (OPC client, WebSocket streaming, KPI APIs)

PostgreSQL – Time-series data storage

Next.js – Realtime and Historical dashboards

🏗 Architecture
OPC UA Server
      ↓
FastAPI Backend (WebSocket + KPI API + DB logging)
      ↓
PostgreSQL (Historical storage)
      ↓
Next.js Frontend (Realtime + Analytics)

The system simulates an AHU, streams live data via WebSockets, logs values into PostgreSQL, and computes historical KPIs.

📦 Prerequisites

Python 3.11+

Node.js 18+

PostgreSQL 16

Git

1️⃣ Clone the Repository
git clone https://github.com/Munim-nust/ahu-opc-stack.git
cd ahu-opc-stack
2️⃣ Backend Setup (Python Virtual Environment)

Navigate to backend:

cd backend

Create virtual environment:

python -m venv venv

Activate it (Windows):

venv\Scripts\activate

Install dependencies:

pip install -r requirements.txt
3️⃣ Configure Database Connection

Copy the example configuration file:

copy db_config.example.py db_config.py

Open db_config.py and update your PostgreSQL password.

4️⃣ PostgreSQL Setup

Open PostgreSQL:

"C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres

Inside psql, run:

CREATE DATABASE ahu_db;
\c ahu_db

CREATE TABLE IF NOT EXISTS tag_reading (
    id SERIAL PRIMARY KEY,
    time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ahu_id TEXT NOT NULL,
    tag_name TEXT NOT NULL,
    value_num DOUBLE PRECISION,
    value_text TEXT
);

CREATE INDEX IF NOT EXISTS idx_tag_reading_lookup
ON tag_reading (ahu_id, tag_name, time DESC);

\q
▶️ Running the System

You need three terminals running simultaneously.

🔹 Terminal 1 – Start OPC UA Server
cd backend
venv\Scripts\activate
python opc_server.py

Expected output:

OPC UA Server running
Endpoint: opc.tcp://0.0.0.0:4840/ahu-opcua/
🔹 Terminal 2 – Start FastAPI Backend
cd backend
venv\Scripts\activate
python -m uvicorn api_bridge:app --reload --port 8000

Expected output:

Uvicorn running on http://127.0.0.1:8000
🔹 Terminal 3 – Start Frontend
cd frontend
npm install
npm run dev

Open in browser:

Realtime Dashboard
http://localhost:3000

Historical KPIs
http://localhost:3000/analytics

🧪 Manual Testing (Write Values to OPC)

Open a new terminal:

cd backend
venv\Scripts\activate

Examples:

Set alarm state:

python opc_write_cli.py --tag AHUStatus --value ALARM

Change cooling demand:

python opc_write_cli.py --tag CoolingDemand_TR --value 900

Change inlet temperature:

python opc_write_cli.py --tag ChilledWaterInletTemp_C --value 12

Realtime dashboard updates instantly.

Analytics page updates after values are logged into PostgreSQL.

🛑 Stopping the System

Press:

CTRL + C

in each running terminal.

🔁 Restarting Later

Activate the virtual environment and start services again.

Backend
cd backend
venv\Scripts\activate
python opc_server.py
python -m uvicorn api_bridge:app --reload --port 8000
Frontend
cd frontend
npm run dev
📌 Notes

Data is currently simulated via OPC UA.

Architecture mirrors real industrial deployments.

Easily extendable to MQTT, BACnet, Modbus.

Designed to scale with additional KPIs and analytics features.