<!-- ca5f8edd-0020-4b87-b1df-186b6e8fb8f7 d7eb693c-2581-41a6-8ffe-1f9a97cc4289 -->
# Audio Cluster Prototype Plan

## Overview

Create a minimal prototype where the realtime server assigns players to proximity-based clusters, emits per-player and per-cluster audio parameters, and both personal/global views feed these parameters into basic NoiseCraft audio components. Produce the plan in English and add a Korean translation in a separate file for the other teammate.

## Steps

1. **Cluster detection & state** (`realtime/src/index.ts`)

- Add a lightweight proximity clustering pass (e.g., union-find or BFS per frame) that groups players within a distance threshold, stores `clusterId` per player, and snapshots per-cluster masses/counts.
- Generate basic chord params (C-E-G frequencies + gain scaled by member count) and emit a new `audioCluster` payload per cluster.

2. **Server→client audio events** (`realtime/src/index.ts`, `src/types/server.ts`)

- Extend Socket.IO emissions so each player receives `audioSelf` (personal noise level, ambient mix) plus the relevant cluster’s chord parameters, while spectators receive the largest cluster’s chord payload.
- Update shared server/client types for these payloads.

3. **Client handling & NoiseCraft hook** (`src/lib/socket/events.ts`, `src/lib/game/state.ts`, `src/components/mobile/*`, `src/components/global/GlobalView.tsx`, NoiseCraft iframe bridge)

- Store incoming audio payloads in GameState (e.g., `audio.self`, `audio.cluster`, `audio.global`).
- Add a simple NoiseCraft example patch (from `/noisecraft/examples`) that exposes parameters we can map (gain, filter freq, etc.) and drive it in both personal/global views.

4. **Documentation**

- Document the plan + API expectations in English (main plan file) and create a Korean translation file alongside it for teammates.

## Todos

- `cluster-detect`: Implement proximity clustering and per-cluster chord state.
- `audio-events`: Emit/stash `audioSelf`/`audioCluster`/`audioGlobal` payloads with updated types.
- `client-audio`: Consume audio payloads and hook up minimal NoiseCraft patches in personal/global views.
- `docs-en-kr`: Write the English plan summary and add a Korean translation file.