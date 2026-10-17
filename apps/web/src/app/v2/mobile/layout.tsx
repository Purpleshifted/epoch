import type { Metadata, Viewport } from "next";

/**
 * The player view on a phone: no pinch or double-tap zoom, the page fills the screen (under the notch too), and it can
 * be added to the home screen to run without the browser's chrome (no address bar, no edge-swipe back on iOS).
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#000000",
};

export const metadata: Metadata = {
  appleWebApp: { capable: true, title: "발견된 인류", statusBarStyle: "black-translucent" },
  other: { "mobile-web-app-capable": "yes" },
};

export default function PlayerLayout({ children }: { children: React.ReactNode }) {
  return children;
}
