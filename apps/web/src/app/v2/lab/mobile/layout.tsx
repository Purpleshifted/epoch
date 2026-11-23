import type { Viewport } from "next";

/** The mobile view lab runs the personal view: the same phone viewport as /v2/mobile (no pinch or double-tap zoom). */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#000000",
};

export default function MobileLabLayout({ children }: { children: React.ReactNode }) {
  return children;
}
