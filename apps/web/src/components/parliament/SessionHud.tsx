"use client";
/**
 * SessionHud — the player view's machine text (V2), at the bottom of the screen:
 *   - the ROLE SLOT: empty until the first touch, then it spins like a slot reel and stops on the role drawn
 *   - above it, while live, the dry record (lib/parliament/witness.ts): what the visitor is doing, who is near,
 *     and a short log of what changed — facts only, never what they amount to (that is for the global view)
 *   - when the lifespan is over, a dry end screen over everything
 * All of it in a retro terminal face (VT323), greys only. Mount it with key = sessionNo: a new visitor, a new record.
 */

import { VT323 } from "next/font/google";
import { useEffect, useRef, useState } from "react";
import { ROLE_TAG, WitnessLog, fmtClock, reelAt, type Observation } from "@/lib/parliament";
import type { LifeSession } from "./useLifeSession";

const mono = VT323({ weight: "400", subsets: ["latin"], display: "swap" });

const POLL_MS = 250;

/** How dark the screen is in each phase (0 = the world, 1 = black). */
const DARK = { idle: 0.94, draw: 0.94, live: 0, ended: 1 } as const;

interface WitnessView {
  lines: string[];
  status: string;
  near: string[];
  /** Totals so far (the end screen shows the last ones). */
  t: number;
  stillSec: number;
  nearSec: number;
  met: number;
}

const EMPTY: WitnessView = { lines: [], status: "", near: [], t: 0, stillSec: 0, nearSec: 0, met: 0 };

export function SessionHud({
  session,
  witnessRef,
  locked,
  lifeSec,
}: {
  session: LifeSession;
  witnessRef: React.MutableRefObject<Observation | null>;
  /** Pointer lock (desktop): shows the "click to look" hint while live and unlocked. */
  locked: boolean;
  /** The lifespan (s): what the end screen says the visitor was present for. */
  lifeSec: number;
}) {
  const { phase, role, reel, drawAt } = session;
  const [log] = useState(() => new WitnessLog());
  const lastObs = useRef<Observation | null>(null);
  const [rec, setRec] = useState<WitnessView>(EMPTY);
  const [now, setNow] = useState(0);

  // the reel runs on the frame clock while drawing
  useEffect(() => {
    if (phase !== "draw") return;
    let raf = 0;
    const loop = () => {
      setNow(Date.now());
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [phase]);

  // the record, read from RoleField's latest reading
  useEffect(() => {
    if (phase !== "live") return;
    const id = setInterval(() => {
      const obs = witnessRef.current;
      if (!obs || obs === lastObs.current) return;
      lastObs.current = obs;
      log.push(obs);
      setRec({ lines: [...log.lines], status: log.status(), near: log.nearNow(), t: obs.t, ...log.summary() });
    }, POLL_MS);
    return () => clearInterval(id);
  }, [phase, witnessRef, log]);

  const slot = (() => {
    if (phase === "idle" || !role) return { text: "", lit: true, fixed: false };
    if (phase === "draw" && reel) {
      const r = reelAt(reel, Math.max(0, (now - drawAt) / 1000));
      return { text: r.label, lit: r.lit, fixed: r.settled };
    }
    return { text: ROLE_TAG[role], lit: true, fixed: true };
  })();

  return (
    <div className={`${mono.className} pointer-events-none absolute inset-0 select-none text-white`}>
      {/* the dark: almost black before and while the role is drawn (only the hint and the slot show), black after the end.
          Hard cuts (digital) — the only fade is the dying one, into the end. */}
      <div
        className="absolute inset-0 bg-black transition-opacity"
        style={{ opacity: DARK[phase], transitionDuration: phase === "ended" ? "2000ms" : "0ms" }}
      />
      {/* hints blink on / off (steps, no fade) */}
      <style>{`@keyframes hud-blink { 50% { opacity: 0; } } .hud-blink { animation: hud-blink 1.1s steps(1, end) infinite; }`}</style>
      {/* centre hints */}
      {phase === "idle" && (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="hud-blink text-[18px] tracking-[0.3em] text-white/45">TOUCH TO BEGIN</p>
        </div>
      )}
      {phase === "live" && !locked && (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="text-[14px] tracking-[0.35em] text-white/20">CLICK TO LOOK</p>
        </div>
      )}

      {/* the record + the role slot */}
      <div className="absolute inset-x-0 bottom-0 flex justify-center px-4 pb-6" style={{ display: phase === "ended" ? "none" : undefined }}>
        <div className="w-full max-w-[30rem]">
          {phase === "live" && (
            <div className="mb-3 text-[15px] leading-[1.15] tracking-[0.04em]">
              {rec.lines.map((l, i) => (
                <div key={`${i}:${l}`} className="truncate" style={{ opacity: 0.18 + (0.4 * (i + 1)) / Math.max(1, rec.lines.length) }}>
                  {l}
                </div>
              ))}
              {rec.near.length > 0 && (
                <div className="mt-2 text-white/55">
                  {rec.near.slice(0, 4).map((n) => (
                    <div key={n} className="truncate">
                      · {n}
                    </div>
                  ))}
                </div>
              )}
              {rec.status && <div className="mt-2 truncate text-white/80">{rec.status}</div>}
            </div>
          )}
          <div className="text-center text-[12px] tracking-[0.4em] text-white/30">ROLE</div>
          <div className="mt-1 flex h-[52px] items-center justify-center border border-white/25 bg-black/40">
            <span
              className="text-[40px] leading-none tracking-[0.12em]"
              style={{ opacity: slot.text ? (slot.lit ? (slot.fixed ? 0.92 : 0.7) : 0.08) : 0 }}
            >
              {slot.text || " "}
            </span>
          </div>
        </div>
      </div>

      {/* the end */}
      <div className="absolute inset-0 flex items-center justify-center px-6">
        {phase === "ended" && role && (
          <div className="w-full max-w-[30rem] space-y-1 text-[18px] leading-tight tracking-[0.06em] text-white/75">
            <div className="text-[26px] text-white/90">LIFESPAN EXPIRED</div>
            <div>{ROLE_TAG[role]} — REMOVED FROM THE GROUND</div>
            <div className="whitespace-pre pt-4 text-white/55">
              <div>PRESENT      {fmtClock(lifeSec)}</div>
              <div>STATIONARY   {fmtClock(rec.stillSec)}</div>
              <div>NEAR OTHERS  {fmtClock(rec.nearSec)} · {rec.met} MET</div>
            </div>
            <div className="pt-4 text-white/35">THE RECORD IS KEPT.</div>
            {session.restartReady && <div className="hud-blink pt-8 text-[16px] tracking-[0.3em] text-white/45">PRESS SPACE — NEXT SESSION</div>}
          </div>
        )}
      </div>
    </div>
  );
}
