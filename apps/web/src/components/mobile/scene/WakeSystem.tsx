"use client";

import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

const MAX_P = 5000;

// ─── GLSL ─────────────────────────────────────────────
const VS = /* glsl */`
  attribute float aAge;
  attribute float aSize;
  varying float vAge;
  void main() {
    vAge = aAge;
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (220.0 / -mvPos.z);
    gl_Position = projectionMatrix * mvPos;
  }
`;
const FS = /* glsl */`
  uniform vec3 uColor;
  varying float vAge;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float soft = 1.0 - smoothstep(0.3, 0.5, d);
    gl_FragColor = vec4(uColor, vAge * soft * 0.8);
  }
`;

export interface WakeEvent {
  id: number;
  x: number; z: number; y: number;
  speed: number;
  startTime?: number;
}

export function WakeSystem({ events, color }: { events: WakeEvent[]; color: string }) {
  // ── 파티클 풀 (전부 ref로 — React state 아님) ──
  const pX   = useRef(new Float32Array(MAX_P));
  const pY   = useRef(new Float32Array(MAX_P));
  const pZ   = useRef(new Float32Array(MAX_P));
  const pVX  = useRef(new Float32Array(MAX_P));
  const pVY  = useRef(new Float32Array(MAX_P));
  const pVZ  = useRef(new Float32Array(MAX_P));
  const pAge = useRef(new Float32Array(MAX_P)); // 0=dead, 1=fresh
  const pDur = useRef(new Float32Array(MAX_P));
  const pSz  = useRef(new Float32Array(MAX_P));
  const slot = useRef(0);

  // 이미 처리한 이벤트 ID
  const seen = useRef(new Set<number>());

  // geometry 버퍼 (ref — React 외부에서 직접 갱신)
  const posBuf = useRef(new Float32Array(MAX_P * 3));
  const ageBuf = useRef(new Float32Array(MAX_P));
  const szBuf  = useRef(new Float32Array(MAX_P));
  const geoRef = useRef<THREE.BufferGeometry>(null);

  const uColor = useMemo(() => ({ value: new THREE.Color(color) }), [color]);

  // eventsRef: render마다 동기화, useFrame에서 읽음
  const evRef = useRef<WakeEvent[]>([]);
  evRef.current = events;

  const spawn = (ev: WakeEvent) => {
    const spd = Math.max(ev.speed, 0.5);
    const count = Math.floor(8 + spd * 5);
    const spread = 0.6 + spd * 0.3;
    const px = pX.current, py = pY.current, pz = pZ.current;
    const pvx = pVX.current, pvy = pVY.current, pvz = pVZ.current;
    const pa = pAge.current, pd = pDur.current, ps = pSz.current;

    for (let i = 0; i < count; i++) {
      const s = slot.current;
      slot.current = (slot.current + 1) % MAX_P;

      const angle = Math.random() * Math.PI * 2;
      const r = 0.3 + Math.random() * 0.7;

      px[s] = ev.x + (Math.random() - 0.5) * 0.5;
      py[s] = ev.y;
      pz[s] = ev.z + (Math.random() - 0.5) * 0.5;

      pvx[s] = Math.cos(angle) * spread * r;
      pvy[s] = (0.15 + Math.random() * 0.55) * spread * 0.45;
      pvz[s] = Math.sin(angle) * spread * r;

      pa[s] = 1.0;
      // 느린 파티클: 4초 → trail / 빠른 파티클: 1.2초 → ripple
      pd[s] = spd < 3 ? 2.5 + Math.random() * 2.0 : 0.6 + Math.random() * 1.0;
      ps[s] = 2.0 + Math.random() * 2.5;
    }
  };

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);

    // 1. 새 이벤트 처리 (useFrame 안에서 — side-effect 안전)
    for (const ev of evRef.current) {
      if (!seen.current.has(ev.id)) {
        seen.current.add(ev.id);
        spawn(ev);
      }
    }

    // 2. 파티클 물리 업데이트
    const px  = pX.current,  py  = pY.current,  pz  = pZ.current;
    const pvx = pVX.current, pvy = pVY.current, pvz = pVZ.current;
    const pa  = pAge.current, pd = pDur.current;
    const pos = posBuf.current, ag = ageBuf.current, sz = szBuf.current;

    for (let i = 0; i < MAX_P; i++) {
      if (pa[i] <= 0) { pos[i*3+1] = -9999; ag[i] = 0; continue; }

      pa[i] = Math.max(0, pa[i] - dt / pd[i]);

      pvy[i] -= 4.5 * dt;           // 중력
      pvx[i] *= Math.pow(0.92, dt * 60); // 마찰
      pvz[i] *= Math.pow(0.92, dt * 60);

      px[i] += pvx[i] * dt;
      py[i] += pvy[i] * dt;
      pz[i] += pvz[i] * dt;

      // 수면 충돌: 안착해서 trail이 됨
      if (py[i] < 0.02) {
        py[i] = 0.02;
        pvy[i] = 0;
        pvx[i] *= 0.4;
        pvz[i] *= 0.4;
      }

      pos[i*3]   = px[i];
      pos[i*3+1] = py[i];
      pos[i*3+2] = pz[i];
      ag[i] = pa[i];
      sz[i] = pSz.current[i];
    }

    // 3. 버퍼 갱신
    if (geoRef.current) {
      (geoRef.current.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      (geoRef.current.attributes.aAge     as THREE.BufferAttribute).needsUpdate = true;
    }
  });

  return (
    <points frustumCulled={false}>
      <bufferGeometry ref={geoRef}>
        <bufferAttribute attach="attributes-position" args={[posBuf.current, 3]} />
        <bufferAttribute attach="attributes-aAge"     args={[ageBuf.current, 1]} />
        <bufferAttribute attach="attributes-aSize"    args={[szBuf.current,  1]} />
      </bufferGeometry>
      <shaderMaterial
        vertexShader={VS}
        fragmentShader={FS}
        uniforms={{ uColor }}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}
