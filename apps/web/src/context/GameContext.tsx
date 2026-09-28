"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { Mode } from "@/types/game";

interface GameContextValue {
  mode: Mode;
  displayName: string;
  serverUrl: string;
  setMode: (mode: Mode) => void;
  setDisplayName: (name: string) => void;
  setServerUrl: (url: string) => void;
}

// 서버 환경(SSR)용 기본 WS URL
const envWsUrl = process.env.NEXT_PUBLIC_WS_URL;
const fallbackUrl =
  envWsUrl ??
  (process.env.NODE_ENV === "development"
    ? "http://localhost:3001/socket"
    : "/socket");

const defaultValue: GameContextValue = {
  mode: "personal",
  displayName: "",
  serverUrl: fallbackUrl,
  setMode: () => undefined,
  setDisplayName: () => undefined,
  setServerUrl: () => undefined,
};

const GameContext = createContext<GameContextValue>(defaultValue);

export const GameProvider = ({ children }: { children: React.ReactNode }) => {
  const [mode, setMode] = useState<Mode>("personal");
  const [displayName, setDisplayName] = useState("");
  const [serverUrl, setServerUrl] = useState(fallbackUrl);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!envWsUrl) return;

    try {
      const page = window.location;
      const absoluteUrl = new URL(envWsUrl, page.origin);

      // 개발용 localhost/127.0.0.1이 설정된 경우,
      // 현재 접속한 호스트(IP/도메인)에 맞게 호스트만 교체
      if (
        absoluteUrl.hostname === "localhost" ||
        absoluteUrl.hostname === "127.0.0.1"
      ) {
        const port = absoluteUrl.port || "3001";
        const path = absoluteUrl.pathname || "/socket";
        const protocol = page.protocol;
        const hostPart = port ? `${page.hostname}:${port}` : page.hostname;
        const rewritten = `${protocol}//${hostPart}${path}`;
        setServerUrl(rewritten);
      } else {
        setServerUrl(absoluteUrl.toString());
      }
    } catch {
      setServerUrl(envWsUrl);
    }
  }, []);

  const value = useMemo(
    () => ({
      mode,
      setMode,
      displayName,
      setDisplayName,
      serverUrl,
      setServerUrl,
    }),
    [mode, displayName, serverUrl]
  );

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
};

export const useGameContext = () => useContext(GameContext);
