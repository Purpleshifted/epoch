"use client";

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useGameContext } from "@/context/GameContext";
import type { GameAction, GameState, Mode } from "@/types/game";
import { createInitialState, gameReducer } from "./state";
import { createSocketClient, type GameSocket } from "../socket/createClient";
import { registerSocketEvents } from "@/lib/socket/events";

type PlayerEntry = GameState["players"][string];

export interface GameClient {
  state: GameState;
  dispatch: React.Dispatch<GameAction>;
  players: PlayerEntry[];
  socket: GameSocket | null;
}

export const useGameClient = (modeOverride?: Mode): GameClient => {
  const { mode: contextMode, displayName, serverUrl } = useGameContext();
  const mode = modeOverride ?? contextMode;
  const [state, dispatch] = useReducer(gameReducer, mode, createInitialState);
  const socketRef = useRef<GameSocket | null>(null);
  const [socket, setSocket] = useState<GameSocket | null>(null);
  const stateRef = useRef(state);
  const eventCleanupRef = useRef<(() => void) | null>(null);
  const targetRef = useRef(state.target);
  const controlVelRef = useRef(state.input.controlVelocity ?? { x: 0, y: 0 });

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    targetRef.current = state.target;
  }, [state.target]);

  useEffect(() => {
    controlVelRef.current = state.input.controlVelocity ?? { x: 0, y: 0 };
  }, [state.input.controlVelocity]);

  useEffect(() => {
    dispatch({ type: "SET_MODE", mode });
  }, [mode]);

  useEffect(() => {
    dispatch({
      type: "SET_UI",
      ui: { displayName },
    });
  }, [displayName]);

  useEffect(() => {
    let active = true;

    const connect = async () => {
      const socket = await createSocketClient({
        mode,
        serverUrl,
      });

      if (!active) {
        socket.disconnect();
        return;
      }

      socketRef.current = socket;
      setSocket(socket);
      eventCleanupRef.current = registerSocketEvents({
        socket,
        mode,
        dispatch,
        displayName,
        getState: () => stateRef.current,
      });
    };

    connect();

    return () => {
      active = false;
      eventCleanupRef.current?.();
      eventCleanupRef.current = null;
      socketRef.current?.disconnect();
      setSocket(null);
      socketRef.current = null;
      dispatch({ type: "RESET" });
    };
  }, [mode, displayName, serverUrl]);

  useEffect(() => {
    if (!socket || mode !== "personal") return;
    if (typeof window === "undefined") return;
    // 모바일 컨트롤러: 원하는 속도를 더 자주 전송 (30Hz)
    const interval = window.setInterval(() => {
      const v = controlVelRef.current || { x: 0, y: 0 };
      socket.emit("0", { vx: v.x, vy: v.y });
    }, 33);
    return () => window.clearInterval(interval);
  }, [socket, mode]);

  const players = useMemo(() => {
    return state.playerOrder
      .map((id) => state.players[id])
      .filter(Boolean) as PlayerEntry[];
  }, [state.playerOrder, state.players]);

  return {
    state,
    dispatch,
    players,
    socket,
  };
};
