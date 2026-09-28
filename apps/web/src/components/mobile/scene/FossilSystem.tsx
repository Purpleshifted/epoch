"use client";

import { useRef, useMemo, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

const CELL_SIZE   = 1.5;
const MIN_GAP     = 1.2;
const MAX_FOSSIL  = 50;   // 인력 계산 부하 억제
const STORAGE_KEY = "anthropocene:fossils";

// ── 광구 셰이더 ──────────────────────────────────────
// 가우시안 핵 + 코로나: 핵 사이즈의 protoplanet 같은 발광체
const VS = /* glsl */`
  attribute float aPhase;
  uniform float uTime;
  uniform float uSize;
  varying float vPhase;
  void main() {
    vPhase = aPhase;
    float pulse = 1.0 + 0.12 * sin(uTime * 0.38 + aPhase);
    gl_PointSize = uSize * pulse;
    gl_Position  = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FS = /* glsl */`
  uniform vec3  uColor;
  uniform float uAlpha;
  uniform float uTime;
  varying float vPhase;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    // 밝은 중심핵 + 연한 코로나: protoplanet 발광 느낌
    float core   = exp(-d * d * 28.0);
    float corona = exp(-d * d * 5.5) * 0.5;
    float glow   = core + corona;
    // 완만한 맥동 (빠른 깜박임 없이 고요하게)
    float pulse  = 0.82 + 0.18 * sin(uTime * 0.35 + vPhase * 1.7);
    gl_FragColor = vec4(uColor, glow * pulse * uAlpha);
  }
`;

interface FossilCell {
  count: number; lastTime: number; fossilized: boolean;
  sumX: number; sumY: number; sumZ: number; visits: number;
}
export interface FossilRecord { x: number; y: number; z: number; }

export function FossilSystem({
  playerPosRef, playerYRef,
  color, threshold, fossilSize, fossilAlpha,
  fossilsRef,      // 공유 ref: TraceSystem 인력 계산에 사용
}: {
  playerPosRef: React.MutableRefObject<{ x: number; z: number }>;
  playerYRef:   React.MutableRefObject<number>;
  color: string;
  threshold?:   number;
  fossilSize?:  number;
  fossilAlpha?: number;
  fossilsRef?:  React.MutableRefObject<FossilRecord[]>;
}) {
  const THRESH  = threshold  ?? 4;
  const F_SIZE  = fossilSize ?? 14;   // px — 광구는 trace(3px)보다 훨씬 크게
  const F_ALPHA = fossilAlpha ?? 0.7;

  const gridMap    = useRef<Map<string, FossilCell>>(new Map());
  const fossils    = useRef<FossilRecord[]>([]);
  const checkTimer = useRef(0);

  const posBuf   = useRef(new Float32Array(MAX_FOSSIL * 3));
  const phaseBuf = useRef(new Float32Array(MAX_FOSSIL));
  const geoRef   = useRef<THREE.BufferGeometry>(null);

  const uColor = useMemo(() => ({ value: new THREE.Color(color) }), [color]);
  const uTime  = useMemo(() => ({ value: 0 }), []);
  const uSize  = useMemo(() => ({ value: F_SIZE }), []);
  const uAlpha = useMemo(() => ({ value: F_ALPHA }), []);
  uColor.value.set(color);
  uSize.value  = F_SIZE;
  uAlpha.value = F_ALPHA;

  // 마운트: localStorage 화석 복원
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved: FossilRecord[] = JSON.parse(raw);
        saved.slice(0, MAX_FOSSIL).forEach((f, i) => {
          fossils.current.push(f);
          fossilsRef && fossilsRef.current.push(f);
          posBuf.current[i*3]   = f.x;
          posBuf.current[i*3+1] = f.y;
          posBuf.current[i*3+2] = f.z;
          phaseBuf.current[i]   = Math.random() * Math.PI * 2;
        });
        if (geoRef.current) {
          geoRef.current.setDrawRange(0, fossils.current.length);
          (geoRef.current.attributes.position as THREE.BufferAttribute).needsUpdate = true;
        }
      }
    } catch (_) {}
  }, []);

  // 언마운트/탈출: 화석만 저장 (trace 데이터는 in-memory → 자동 소멸)
  useEffect(() => {
    const save = () => {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(fossils.current)); } catch (_) {}
    };
    window.addEventListener("beforeunload", save);
    window.addEventListener("visibilitychange", save);
    return () => {
      save();
      window.removeEventListener("beforeunload", save);
      window.removeEventListener("visibilitychange", save);
    };
  }, []);

  function spawnFossil(cell: FossilCell) {
    if (fossils.current.length >= MAX_FOSSIL) return;
    const idx = fossils.current.length;
    const f: FossilRecord = {
      x: cell.sumX / cell.visits,
      y: cell.sumY / cell.visits,
      z: cell.sumZ / cell.visits,
    };
    fossils.current.push(f);
    fossilsRef && fossilsRef.current.push(f);

    posBuf.current[idx*3]   = f.x;
    posBuf.current[idx*3+1] = f.y;
    posBuf.current[idx*3+2] = f.z;
    phaseBuf.current[idx]   = Math.random() * Math.PI * 2;
    cell.fossilized = true;

    if (geoRef.current) {
      (geoRef.current.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      (geoRef.current.attributes.aPhase   as THREE.BufferAttribute).needsUpdate = true;
      geoRef.current.setDrawRange(0, fossils.current.length);
    }
  }

  useFrame((_, delta) => {
    uTime.value += delta;

    checkTimer.current += delta;
    if (checkTimer.current < 0.8) return;
    checkTimer.current = 0;

    const px  = playerPosRef.current.x;
    const py  = playerYRef.current;
    const pz  = playerPosRef.current.z;
    const now = Date.now();

    const gx  = Math.floor(px / CELL_SIZE);
    const gz  = Math.floor(pz / CELL_SIZE);
    const key = `${gx},${gz}`;

    let cell = gridMap.current.get(key);
    if (!cell) {
      cell = { count:0, lastTime:0, fossilized:false, sumX:0, sumY:0, sumZ:0, visits:0 };
      gridMap.current.set(key, cell);
    }

    if (cell.fossilized) return;
    if (now - cell.lastTime < MIN_GAP * 1000) return;

    cell.count++;
    cell.lastTime = now;
    cell.sumX += px; cell.sumY += py; cell.sumZ += pz;
    cell.visits++;

    if (cell.count >= THRESH) spawnFossil(cell);
  });

  return (
    <points frustumCulled={false}>
      <bufferGeometry ref={geoRef}>
        <bufferAttribute attach="attributes-position" args={[posBuf.current, 3]} />
        <bufferAttribute attach="attributes-aPhase"   args={[phaseBuf.current, 1]} />
      </bufferGeometry>
      <shaderMaterial
        vertexShader={VS}
        fragmentShader={FS}
        uniforms={{ uColor, uTime, uSize, uAlpha }}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}
