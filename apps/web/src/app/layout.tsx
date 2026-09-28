import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { GameProvider } from "@/context/GameContext";

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
  metadataBase: new URL("https://intersection.local/visual"),
  title: {
    default: "Intersection",
    template: "%s · Intersection",
  },
  description:
    "인터섹션(agar.io 기반 실험)의 Next.js 마이그레이션 베이스. 개인/글로벌 뷰 라우팅만 우선 구성했습니다.",
  applicationName: "Intersection",
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
