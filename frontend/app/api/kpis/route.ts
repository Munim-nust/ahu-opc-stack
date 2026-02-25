import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const ahuId = url.searchParams.get("ahuId") ?? "AHU-0001";

  const backendUrl = `http://127.0.0.1:8000/api/kpis?ahuId=${encodeURIComponent(ahuId)}`;

  const res = await fetch(backendUrl, { cache: "no-store" });

  if (!res.ok) {
    const text = await res.text();
    return new NextResponse(text, { status: res.status });
  }

  const data = await res.json();
  return NextResponse.json(data);
}