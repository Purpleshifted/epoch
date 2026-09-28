# Audio Cluster Prototype Notes

## Overview

This prototype adds proximity-based clusters, server-driven audio payloads, and a thin NoiseCraft bridge so that each personal view hears its own noise + cluster chord, while the global view follows the dominant cluster.

## Server

### Clustering
- Runs every ~200 ms (and on player join/leave).
- Breadth-first grouping with a 420 px radius.
- Each cluster stores `clusterId`, centroid, member count, gain, and a fixed C–E–G triad where frequency/gain are scaled by cluster size.

### Audio payloads
- `audioSelf`: `{ noiseLevel (0-1), ambientLevel (0-1), clusterId }`
- `audioCluster`: `{ clusterId, chord: [{ freq, gain }], memberCount, centroid, gain }`
- `audioGlobal`: `{ cluster: audioCluster | null }`
- Players get `audioSelf` + `audioCluster`, spectators get `audioGlobal`.

## Client

### State shape
```ts
audio: {
  self: { noiseLevel, ambientLevel, clusterId, updatedAt } | null;
  cluster: { clusterId, chord, memberCount, centroid, gain, updatedAt, source: "cluster" } | null;
  global:  { ... source: "global" } | null;
}
```

### Socket handlers
- `audioSelf` → `SET_AUDIO` (self)
- `audioCluster` → `SET_AUDIO` (cluster)
- `audioGlobal` → `SET_AUDIO` (global)

### NoiseCraft bridge
- Shared helper builds `SetParam` commands:
  - Self mode: node `0` (freq) & `1` (gain).
  - Cluster/global: nodes `4/6/8` for triad freqs, node `12` for gain.
- Personal view renders a compact NoiseCraft iframe (hidden on small screens) and posts messages with the calculated params.
- Global view reuses its existing iframe and now receives chord data via `postMessage`.

### Embedded patch
- `noisecraft/public/embedded.html` now loads a tiny patch (self sine + three chord sines mixed into audio out) and listens for:
  - `noiseCraft:setParams` → updates `SetParam` on the requested nodes.
  - `noiseCraft:play` / `noiseCraft:stop` → optional remote transport.
- The embed accepts `?src=<absolute-url>` as well as `?project=<NoiseCraft project id>`. On the frontend you can set
  `NEXT_PUBLIC_NOISECRAFT_PATCH_SRC` (static `.ncft` snapshot) or `NEXT_PUBLIC_NOISECRAFT_PATCH_PROJECT_ID` (uploaded project)
  so every iframe instance bootstraps with the uploaded patch. When neither is provided we default to `/audiocraft/current-project`.
  The NoiseCraft UI (`http://localhost:4000/`) POSTs every opened project to that endpoint so the spectator embeds immediately
  pick up whatever you are auditioning locally, without having to share/upload.
- A lightweight “Noise Slot” bridge (4 channels) lives on the realtime Socket.IO server (`/socket`). The Noisecraft editor can map
  arbitrary nodes to Slot 0~3, and the Next.js client will drive those nodes with the existing streams: Self Frequency, Self Gain,
  Cluster Chord (up to 3 nodes), and Cluster Gain. Leaving a slot empty falls back to the default embedded patch nodes
  (`0/1/4/6/8/12`), preserving backwards compatibility.

## Next Steps
- Replace the placeholder triad/gain logic with production-ready audio design.
- Add real DSP/visual feedback for clusters (e.g., filters per cluster).
- Harden autoplay UX on mobile (surface a dedicated “Start Audio” banner).

