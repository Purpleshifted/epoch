import type { Metadata, Viewport } from "next";
import LivesGallery from "@/components/parliament/LivesGallery";

/**
 * /exhibition/gallery — the posted lives (components/parliament/LivesGallery): where 게시하기 leads (갤러리 보기 on the
 * end card), each card opening its recording (/rec/<id>). A visitor address: no Leva. ?lang=en for English;
 * ?venue=gallery: the gallery machine (goes back to the experience when left untouched); ?back=<path>: that experience.
 */
export const metadata: Metadata = { title: "갤러리 · 발견된 인류", robots: { index: false, follow: false } };
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#000000" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { lang, venue, back } = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  return <LivesGallery lang={one(lang) === "en" ? "en" : "ko"} venue={one(venue)} back={one(back)} />;
}
