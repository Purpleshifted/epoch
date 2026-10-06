/**
 * GET /api/sprites/search?term=plastic%20bottle&limit=8
 *
 * Design A of docs/sprite-sources-and-pipeline.md: the newest images that Wikimedia Commons
 * holds for a search term, restricted to licences that allow a derivative (pixelised) copy:
 * CC0, public domain, CC BY. CC BY-SA / NC / ND and non-free files are dropped here, on the
 * server, so no client ever sees them. Nothing is stored; provenance travels with each hit.
 */

import { NextResponse } from "next/server";
import { licenceAllowed, type SpriteCandidate } from "@/lib/sprites/licence";

export const dynamic = "force-dynamic";

const UA = "anthropocene-sprite-lab/0.1 (art installation; https://github.com/Purpleshifted/epoch)";

interface ExtValue { value?: string }
interface CommonsPage {
  title: string;
  index?: number;
  imageinfo?: {
    timestamp: string;
    width: number;
    height: number;
    size: number;
    mime: string;
    thumburl?: string;
    url: string;
    descriptionurl: string;
    extmetadata?: Record<string, ExtValue>;
  }[];
}

function stripHtml(html: string | undefined): string {
  return (html ?? "").replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const term = (searchParams.get("term") ?? "").trim().slice(0, 80);
  const limit = Math.min(20, Math.max(1, Number(searchParams.get("limit") ?? 8)));
  if (!term) return NextResponse.json({ error: "term required" }, { status: 400 });

  const url = new URL("https://commons.wikimedia.org/w/api.php");
  const q: Record<string, string> = {
    action: "query",
    format: "json",
    generator: "search",
    gsrnamespace: "6",
    gsrsearch: `"${term.replace(/"/g, "")}" filetype:bitmap`,
    gsrsort: "create_timestamp_desc",
    gsrlimit: "50", // over-fetch: many hits are filtered out by licence
    prop: "imageinfo",
    iiprop: "url|size|mime|timestamp|extmetadata",
    iiurlwidth: "320",
    iiextmetadatafilter: "LicenseShortName|Artist|LicenseUrl|NonFree|Restrictions|ImageDescription|Categories",
  };
  for (const [k, v] of Object.entries(q)) url.searchParams.set(k, v);

  let json: { query?: { pages?: Record<string, CommonsPage> } };
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, cache: "no-store" });
    if (!res.ok) return NextResponse.json({ error: `commons ${res.status}` }, { status: 502 });
    json = await res.json();
  } catch (e) {
    return NextResponse.json({ error: `fetch failed: ${(e as Error).message}` }, { status: 502 });
  }

  const pages = Object.values(json.query?.pages ?? {}).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const out: SpriteCandidate[] = [];
  let seen = 0;
  const words = term.toLowerCase().split(/\s+/).filter(Boolean).map((w) => (w.length > 3 ? w.replace(/s$/, "") : w));
  for (const p of pages) {
    seen++;
    const info = p.imageinfo?.[0];
    if (!info || !info.thumburl) continue;
    if (info.mime !== "image/jpeg" && info.mime !== "image/png") continue;
    if (info.width < 300 || info.height < 300) continue;
    const m = info.extmetadata ?? {};
    const license = stripHtml(m.LicenseShortName?.value);
    if (!licenceAllowed(license)) continue;
    if ((m.NonFree?.value ?? "").toLowerCase() === "true") continue;
    if (m.Restrictions?.value) continue; // personality / trademark / etc. restrictions
    const hay = `${p.title} ${stripHtml(m.ImageDescription?.value)} ${stripHtml(m.Categories?.value)}`.toLowerCase();
    if (!words.every((w) => hay.includes(w))) continue; // Commons full-text search is loose
    out.push({
      title: p.title.replace(/^File:/, ""),
      pageUrl: info.descriptionurl,
      thumbUrl: info.thumburl,
      author: stripHtml(m.Artist?.value) || "unknown",
      license,
      licenseUrl: stripHtml(m.LicenseUrl?.value),
      timestamp: info.timestamp,
      width: info.width,
      height: info.height,
    });
    if (out.length >= limit) break;
  }
  return NextResponse.json({ term, scanned: seen, results: out });
}
