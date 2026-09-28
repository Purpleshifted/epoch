import { NextResponse } from "next/server";

// Edge runtime: 빠른 응답 + 캐시 이슈 회피
export const runtime = "edge";
export const revalidate = 0;

const WIND_URL =
  "https://services.swpc.noaa.gov/json/rtsw/rtsw_wind_1m.json";

export async function GET() {
  try {
    const res = await fetch(WIND_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`NOAA status ${res.status}`);
    const data: unknown[] = await res.json();

    // 가장 최근 유효 데이터 (null이 아닌 proton_speed 있는 것 역탐색)
    let latest: Record<string, unknown> | null = null;
    for (let i = data.length - 1; i >= 0; i--) {
      const row = data[i] as Record<string, unknown>;
      if (row.proton_speed !== null) {
        latest = row;
        break;
      }
    }
    if (!latest) latest = data[data.length - 1] as Record<string, unknown>;

    return NextResponse.json({
      protonSpeed: latest.proton_speed ?? 450,
      protonDensity: latest.proton_density ?? 5,
      timeTag: latest.time_tag ?? null,
      source: latest.source ?? "unknown",
    });
  } catch (err) {
    console.error("[api/solar-wind]", err);
    return NextResponse.json(
      { error: "fetch failed", protonSpeed: 450, protonDensity: 5 },
      { status: 200 }
    );
  }
}

