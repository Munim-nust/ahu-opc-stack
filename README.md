# AHU OPC UA Dashboard

Real-time AHU dashboard built with:
- OPC UA (Python asyncua server)
- FastAPI backend (OPC client + WebSocket streaming + Postgres historian)
- Next.js frontend (live dashboard + historical KPI analytics)

## How to run
### Backend
1. Start OPC UA server
2. Start FastAPI bridge

### Frontend
Run Next.js dev server

## Pages
- `/` Realtime dashboard (WebSocket)
- `/analytics` Historical KPIs (Postgres)