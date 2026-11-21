import type { Metadata, Viewport } from "next";
import RecPlayer from "./RecPlayer";

/**
 * /rec/<id> — one life's sound, as it was heard (the specimen card's QR). The audio and its markers come from the
 * recordings Worker (relay/recordings); before anything is uploaded, this device's own copy (IndexedDB). Plain on
 * purpose: how the card looks is decided elsewhere. docs/recording.md.
 */
export const metadata: Metadata = { title: "기록된 소리", robots: { index: false, follow: false } };
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#000000" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RecPlayer id={decodeURIComponent(id)} />;
}
