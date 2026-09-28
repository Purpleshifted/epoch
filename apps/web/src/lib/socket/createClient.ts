"use client";

import { io } from "socket.io-client";
import type { Mode } from "@/types/game";

export interface GameSocket {
  id: string | null | undefined;
  emit: (event: string, ...args: unknown[]) => GameSocket;
  on: (event: string, handler: (...args: unknown[]) => void) => GameSocket;
  off: (event: string, handler?: (...args: unknown[]) => void) => GameSocket;
  disconnect: () => void;
}

const createStubSocket = (): GameSocket => {
  const stub: GameSocket = {
    id: null,
    emit: () => stub,
    on: () => stub,
    off: () => stub,
    disconnect: () => undefined,
  };
  return stub;
};

const DEFAULT_SOCKET_PATH = "/socket";
const getDefaultServerUrl = () =>
  process.env.NODE_ENV === "development"
    ? "http://localhost:3001/socket"
    : DEFAULT_SOCKET_PATH;

const resolveSocketEndpoint = (rawUrl: string, origin: string) => {
  try {
    const url = new URL(rawUrl, origin);
    const normalizedPath = url.pathname.replace(/\/+$/, "") || "/";
    const path = normalizedPath === "/" ? DEFAULT_SOCKET_PATH : normalizedPath;
    return {
      origin: `${url.protocol}//${url.host}`,
      path,
    };
  } catch {
    return {
      origin,
      path: DEFAULT_SOCKET_PATH,
    };
  }
};

export const createSocketClient = async ({
  serverUrl,
  mode,
}: {
  serverUrl: string;
  mode: Mode;
}): Promise<GameSocket> => {
  if (typeof window === "undefined") {
    return createStubSocket();
  }

  const resolved = resolveSocketEndpoint(
    serverUrl || getDefaultServerUrl(),
    window.location.origin
  );

  return io(resolved.origin, {
    path: resolved.path,
    query: {
      type: mode === "personal" ? "player" : "spectator",
    },
    transports: ["websocket"],
    withCredentials: true,
  }) as GameSocket;
};
