import type { Metadata, Viewport } from "next";
import NoteView from "./NoteView";

/** /rec/<id>/note — one life's 발굴노트 (its record card's rows), linked from its recording page. */
export const metadata: Metadata = { title: "발굴노트", robots: { index: false, follow: false } };
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#ffffff" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <NoteView id={decodeURIComponent(id)} />;
}
