import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { GameProvider } from "@/context/GameContext";
import { preload } from "react-dom";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Stratum of the Anthropocene",
    template: "%s · Stratum of the Anthropocene",
  },
  description: "인류세의 지층 — 관객의 삶이 남긴 흔적이 미래의 지층으로 쌓이는 웹 작품.",
  applicationName: "Stratum of the Anthropocene",
  icons: {
    icon: "/globe.svg",
  },
};

/** The card's face, which the player view's screens are set in too (globals.css .hud-face): fetched with the page, so the
 * first screen does not show another face first. */
const CARD_FACE = "/fonts/GalmuriMono11.woff2";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  preload(CARD_FACE, { as: "font", type: "font/woff2", crossOrigin: "anonymous" });
  return (
    <html lang="ko">
      <body
        className={`${geistSans.variable} ${geistMono.variable} bg-black text-white antialiased`}
      >
        <GameProvider>{children}</GameProvider>
      </body>
    </html>
  );
}
