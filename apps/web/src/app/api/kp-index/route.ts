import { NextResponse } from "next/server";

const KP_URL =
  "https://services.swpc.noaa.gov/json/planetary_k_index_1m.json";

export async function GET() {
  try {
    const res = await fetch(KP_URL, {
      next: { revalidate: 115 }, // ~2분 캐시
    });
    if (!res.ok) throw new Error(`NOAA status ${res.status}`);
    const data: unknown[] = await res.json();
    const latest = data[data.length - 1] as Record<string, unknown>;

    return NextResponse.json({
      kpIndex: latest.kp_index ?? null,
      estimatedKp: latest.estimated_kp ?? null,
      timeTag: latest.time_tag ?? null,
    });
  } catch (err) {
    console.error("[api/kp-index]", err);
    return NextResponse.json(
      { error: "fetch failed", kpIndex: 2 },
      { status: 200 }
    );
  }
}
