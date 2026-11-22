import type { Metadata, Viewport } from "next";
import LivesGallery from "@/components/parliament/LivesGallery";

/**
 * /exhibition/gallery — the posted lives (components/parliament/LivesGallery): where 게시하기 leads (갤러리 보기 on the
 * end card), each card opening its recording (/rec/<id>). A visitor address: no Leva. ?lang=en for English.
 */
export const metadata: Metadata = { title: "갤러리 · 발견된 인류", robots: { index: false, follow: false } };
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#000000" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { lang } = await searchParams;
  return <LivesGallery lang={lang === "en" ? "en" : "ko"} />;
}
