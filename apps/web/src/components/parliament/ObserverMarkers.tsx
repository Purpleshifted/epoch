"use client";
/**
 * ObserverMarkers — WHERE THE INVISIBLE OBSERVERS ARE, ON THEIR OWN LAB PAGE ONLY (the artist, 2026-11-28, the
 * body-shaped windows retired: "몸 모양 창은 이제 안 쓸 거잖아, 잔류를 왜 따로 계산하고 있지? 어떻게 연결하면 돼 그럼?").
 * The future's archaeologists are never drawn for a visitor: the scan residue (FutureResidue.tsx) is how their
 * crossing shows. On bot (future)'s lab page, so she can watch them cross:
 * - a small ring on the ground marks each one now, with a dot at its middle and a tick the way it walks — the same
 *   observers the residue reads (lib/parliament/excavators: a pure function of the world's epoch and clock, this
 *   group's count, roam and pace); fainter while it stands;
 * - one faint ring round me at the residue's reach (`gateR`): an observer inside it is what makes the residue appear.
 * Drawn on the pictograms' layer (over the finished frame, crisp), black on the white paper, white on the scan's
 * black. Never on the experiment address or the action preview (mounted by RoleField on this page alone).
 */

import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { nearestImage } from "@/lib/parliament";
import { excavatorsAt } from "@/lib/parliament/excavators";
import type { FuturePresenceVisual } from "./FuturePresence";
import { residueLook } from "./FutureResidue";
import { lidarBlack } from "./LidarScan";
import { PICTO_LAYER } from "./framePeople";

const MAX = 40;
const Y = 0.04;
const FLAT = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const pos = new THREE.Vector3();
const scl = new THREE.Vector3();
const col = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

function basic(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide, fog: false });
}

export function ObserverMarkers({
  getWorldSec,
  getEpochMs,
  playerPosRef,
  cfg,
}: {
  getWorldSec: () => number;
  getEpochMs: () => number;
  playerPosRef: React.MutableRefObject<{ x: number; z: number }>;
  cfg: FuturePresenceVisual;
}) {
  const parts = useMemo(() => {
    const ringMat = basic(), dotMat = basic(), tickMat = basic(), reachMat = basic();
    const ring = new THREE.InstancedMesh(new THREE.RingGeometry(0.42, 0.5, 48), ringMat, MAX);
    const dot = new THREE.InstancedMesh(new THREE.CircleGeometry(0.09, 20), dotMat, MAX);
    // (the tick: from the ring's edge out, the way it walks)
    const tickGeom = new THREE.PlaneGeometry(0.06, 0.32);
    tickGeom.translate(0, 0.66, 0);
    const tick = new THREE.InstancedMesh(tickGeom, tickMat, MAX);
    const reach = new THREE.Mesh(new THREE.RingGeometry(0.995, 1, 160), reachMat);
    reach.quaternion.copy(FLAT);
    const group = new THREE.Group();
    for (const m of [ring, dot, tick]) {
      m.count = 0;
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.setColorAt(0, col.setRGB(1, 1, 1));
    }
    reach.frustumCulled = false;
    for (const m of [ring, dot, tick, reach]) {
      m.renderOrder = 11;
      m.layers.set(PICTO_LAYER);
      group.add(m);
    }
    return { group, ring, dot, tick, reach, mats: [ringMat, dotMat, tickMat, reachMat] };
  }, []);
  useEffect(
    () => () => {
      for (const m of [parts.ring, parts.dot, parts.tick, parts.reach]) m.geometry.dispose();
      for (const m of parts.mats) m.dispose();
    },
    [parts],
  );

  useFrame((state) => {
    const { ring, dot, tick, reach, mats } = parts;
    // (their own layer: InkPaper lays it over the finished frame; the plain render needs the layer on)
    state.camera.layers.enable(PICTO_LAYER);
    const black = lidarBlack();
    const ink = black ? 0.95 : 0.08;
    mats[0].opacity = 0.9;
    mats[1].opacity = 0.9;
    mats[2].opacity = 0.9;
    mats[3].opacity = 0.35;
    const p = playerPosRef.current;
    const epoch = getEpochMs();
    const obs = epoch > 0 ? excavatorsAt(epoch, getWorldSec(), { count: cfg.excCount, roam: cfg.excRoam, legSec: cfg.excLegSec, stand: 0.35 }) : [];
    const n = Math.min(MAX, obs.length);
    for (let i = 0; i < n; i++) {
      const o = obs[i];
      // (the nearest image of it round me: the world wraps)
      const x = nearestImage(o.x, p.x), z = nearestImage(o.z, p.z);
      pos.set(x, Y, z);
      scl.set(1, 1, 1);
      m4.compose(pos, FLAT, scl);
      ring.setMatrixAt(i, m4);
      dot.setMatrixAt(i, m4);
      // (the tick turned about the vertical to the way it walks, then laid flat: its +y points along (dx, dz))
      q.setFromAxisAngle(UP, Math.atan2(-o.dx, -o.dz)).multiply(FLAT);
      m4.compose(pos, q, scl);
      tick.setMatrixAt(i, m4);
      // (standing: fainter — toward the ground's own colour)
      const k = o.standing ? 0.45 : 1;
      const c = black ? ink * k : 1 - (1 - ink) * k;
      col.setRGB(c, c, c);
      ring.setColorAt(i, col);
      dot.setColorAt(i, col);
      tick.setColorAt(i, col);
    }
    for (const m of [ring, dot, tick]) {
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    // the residue's reach round me
    const R = Math.max(0.5, residueLook.gateR);
    reach.position.set(p.x, Y, p.z);
    reach.scale.set(R, R, 1);
    mats[3].color.setRGB(ink, ink, ink);
    reach.visible = true;
  });

  return <primitive object={parts.group} />;
}
