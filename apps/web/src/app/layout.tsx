import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { GameProvider } from "@/context/GameContext";

// files of our own (./fonts): next/font/google failed the build now and then (2026-11-02). The weights are what was asked of Google.
const geistSans = localFont({
  src: "./fonts/geist-latin.woff2",
  variable: "--font-geist-sans",
  weight: "400 600",
  display: "swap",
});

const geistMono = localFont({
  src: "./fonts/geist-mono-latin.woff2",
  variable: "--font-geist-mono",
  weight: "400 500",
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
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
