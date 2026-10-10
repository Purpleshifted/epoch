"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * Which build of the parliament the views show. V1 is the version as it was on 2026-10-10 (kept for showing); V2 is
 * the one in progress. Everything added after V1 is gated on this, so V1 stays as it was.
 * The routes /v1/… provide "v1"; /v2/… and the old top-level routes (/mobile, /global/…) are V2.
 */
export type ParliamentVersion = "v1" | "v2";

const VersionContext = createContext<ParliamentVersion>("v2");

export function VersionProvider({ version, children }: { version: ParliamentVersion; children: ReactNode }) {
  return <VersionContext.Provider value={version}>{children}</VersionContext.Provider>;
}

export function useParliamentVersion(): ParliamentVersion {
  return useContext(VersionContext);
}
