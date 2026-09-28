"use client";
/**
 * StarFieldSystem — 자체 GPGPU ping-pong (GPUComputationRenderer 우회)
 */

import { useRef, useMemo, useEffect } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

// 공통 시공간 타입 → spacetime 모듈에서 import
import { SS_PLANE_KEY } from "@/components/spacetime/types";
export type { StarPhase, StarBody } from "@/components/spacetime/types";
import type { StarPhase, StarBody } from "@/components/spacetime/types";

// ──────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────
const WIDTH = 128;          // 128×128 = 16,384 particles (4x 확장)
const TOTAL = WIDTH * WIDTH;
const MAX_SPAWN = 150;          // 초당 최대 150개 spawn 가능
const MAX_STARS = 20;
const LIFETIME_BASE = 90;
const CELL_SIZE = 1.2;
const AGE_GATE = 5 / LIFETIME_BASE;
const MASS_PROTO = 40;
const MASS_MAIN = 180;
const AGE_MAIN = 60;
const MIN_GAP = 3.5;
// 별끼리 인력 상수
// G_STAR=0.02: Nebula(mass=5, 거리5) → ~30초 안에 합체 (눈에 보이는 속도)
const G_STAR          = 0.02;
const MERGE_SOFTENING = 0.5;
// 별 생애주기 임계값
const MASS_GIANT          = 500;   // MainSeq → RedGiant 전환 질량
const AGE_MAIN_AS_GIANT   = 180;   // MainSeq → RedGiant: MainSeq 나이 180초 이상 필요
const AGE_GIANT_PHASE     = 60;    // RedGiant 유지 60초 후 Supernova (질량 무관)
const SN_DURATION         = 15;    // Supernova 지속 시간(초) → 이후 remnant 전환
const REMNANT_DURATION    = 90;    // Remnant 페이드아웃 시간(초)

// ──────────────────────────────────────────────────────────────────────
// GPGPU Shaders (직접 ping-pong)
// RT_pos:  rgba = (x, y, z, lifetime)
// RT_vel:  rgba = (vx, vy, vz, mass)   mass<0 → absorbed
// ──────────────────────────────────────────────────────────────────────

// 공통 vertex (fullscreen quad)
const QUAD_VS = /* glsl */`
  void main() {
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const VEL_FS = /* glsl */`
  precision highp float;

  uniform sampler2D uPos;
  uniform sampler2D uVel;
  uniform vec2  uResolution;
  uniform float uDt;
  uniform float uG;

  // Spawn
  uniform sampler2D uSpawnVel;
  uniform float uSpawnStart;
  uniform float uSpawnCount;
  uniform float uLifetimeGate; // pos.w > this → 5초 미만 신생 파티클 → 중력 스킵

  // Star bodies
  uniform int   uNumBodies;
  uniform vec4  uBodyPos[20];   // xyz pos, w radius
  uniform float uBodyMass[20];

  const float EPS2   = 0.15;
  const float STRIDE = 4.0;

  void main() {
    vec2 uv = gl_FragCoord.xy / uResolution;

    // spawn override
    float myIdx  = floor(gl_FragCoord.y) * uResolution.x + floor(gl_FragCoord.x);
    float d      = myIdx - uSpawnStart;
    float total  = uResolution.x * uResolution.y;
    if (d < 0.0) d += total;
    if (uSpawnCount > 0.5 && d < uSpawnCount) {
      // 텍스처 너비(32) 기준 UV — uSpawnCount로 나누면 다른 픽셀을 읽음
      float t = (d + 0.5) / 32.0;
      gl_FragColor = texture2D(uSpawnVel, vec2(t, 0.5));
      return;
    }

    vec4 pos  = texture2D(uPos, uv);
    vec4 vel  = texture2D(uVel, uv);
    float mass = vel.w;

    // dead / absorbed
    if (pos.w <= 0.0 || mass <= 0.0) {
      gl_FragColor = vel;
      return;
    }

    // 5초 미만 신생 파티클: 중력 없이 관성만 (trail 형성)
    if (pos.w > uLifetimeGate) {
      vel.xyz *= 0.998; // 극미한 감속만
      gl_FragColor = vec4(vel.xyz, mass);
      return;
    }

    vec3 acc = vec3(0.0);

    // ── N-body (stride=4, 5초 이상 파티클끼리만) ──────────────
    for (float py = 0.5; py < 64.0; py += STRIDE) {
      for (float px = 0.5; px < 64.0; px += STRIDE) {
        vec2  uv2  = vec2(px, py) / uResolution;
        vec4  pos2 = texture2D(uPos, uv2);
        float m2   = texture2D(uVel, uv2).w;
        // 상대방도 5초 이상이어야 인력 적용
        if (pos2.w <= 0.0 || pos2.w > uLifetimeGate || m2 <= 0.0) continue;

        vec3  diff = pos2.xyz - pos.xyz;
        float d2   = dot(diff, diff) + EPS2;
        float inv  = inversesqrt(d2);
        acc += uG * m2 * inv * inv * inv * diff;
      }
    }

    // ── Star body gravity + absorption ────────────────────────
    for (int b = 0; b < 20; b++) {
      if (b >= uNumBodies) break;
      vec3  diff = uBodyPos[b].xyz - pos.xyz;
      float d2   = dot(diff, diff);
      float aR   = uBodyPos[b].w;
      if (d2 < aR * aR) {
        gl_FragColor = vec4(vel.xyz, -1.0); // absorbed
        return;
      }
      float d2s  = d2 + EPS2;
      float inv  = inversesqrt(d2s);
      acc += uG * uBodyMass[b] * 0.010 * inv * inv * inv * diff;
      // CCW 소용돌이
      vec3  tang = cross(vec3(0.0,1.0,0.0), diff * inv);
      acc += uG * uBodyMass[b] * 0.003 * inv * inv * tang;
    }

    vel.xyz = vel.xyz * 0.995 + acc * uDt;
    gl_FragColor = vec4(vel.xyz, mass);
  }
`;

const POS_FS = /* glsl */`
  precision highp float;

  uniform sampler2D uPos;
  uniform sampler2D uVel;
  uniform vec2  uResolution;
  uniform float uDt;

  uniform sampler2D uSpawnPos;
  uniform float uSpawnStart;
  uniform float uSpawnCount;

  void main() {
    vec2 uv = gl_FragCoord.xy / uResolution;

    // spawn override
    float myIdx = floor(gl_FragCoord.y) * uResolution.x + floor(gl_FragCoord.x);
    float d     = myIdx - uSpawnStart;
    float total = uResolution.x * uResolution.y;
    if (d < 0.0) d += total;
    if (uSpawnCount > 0.5 && d < uSpawnCount) {
      float t = (d + 0.5) / 32.0;  // 텍스처 너비 기준
      gl_FragColor = texture2D(uSpawnPos, vec2(t, 0.5));
      return;
    }

    vec4 pos = texture2D(uPos, uv);
    vec4 vel = texture2D(uVel, uv);

    if (pos.w <= 0.0 || vel.w < 0.0) {
      gl_FragColor = vec4(pos.xyz, 0.0);
      return;
    }

    pos.xyz += vel.xyz * uDt;
    pos.w    = max(0.0, pos.w - uDt);
    gl_FragColor = pos;
  }
`;

// ──────────────────────────────────────────────────────────────────────
// 파티클 렌더 셰이더 (pos texture 샘플링)
// ──────────────────────────────────────────────────────────────────────
const PART_VS = /* glsl */`
  attribute vec2 aTexUV;

  uniform sampler2D uPos;
  uniform sampler2D uVel;
  uniform float uCamConst;
  uniform float uOpacity;
  uniform float uPointSize; // Leva "점 크기 배율"

  varying vec4 vColor;

  void main() {
    vec4 posD = texture2D(uPos, aTexUV);
    vec4 velD = texture2D(uVel, aTexUV);

    float lifetime = posD.w;
    float mass     = velD.w;

    if (lifetime <= 0.0 || mass <= 0.0) {
      gl_PointSize = 0.0;
      gl_Position  = vec4(2.0, 2.0, 2.0, 1.0);
      vColor = vec4(0.0);
      return;
    }

    // fade-in 5s, fade-out 15s (부드러운 소멸)
    float age     = float(${LIFETIME_BASE}) - lifetime;
    float fadeIn  = smoothstep(0.0, 5.0,  age);
    float fadeOut = smoothstep(0.0, 15.0, lifetime);
    float alpha   = fadeIn * fadeOut * uOpacity;

    // 나이 기반 색상: 신생(흰/금) → 나이 들수록(파랑/보라) 식어감
    // TraceSystem의 따뜻한 amber 계열 질감 유지
    float lifeRatio = clamp(lifetime / float(${LIFETIME_BASE}), 0.0, 1.0);
    // lifeRatio 높음 = 수명 많이 남음 = 젊음 = 따뜻한 흰/금
    vec3 warmCol = vec3(1.00, 0.93, 0.75); // 따뜻한 흰금 (PlayerOrb 계열)
    vec3 coolCol = vec3(0.35, 0.45, 0.90); // 차가운 파랑 (오래된 파티클)
    vec3 col = mix(coolCol, warmCol, lifeRatio);

    vColor = vec4(col, alpha);

    vec4  mvPos = modelViewMatrix * vec4(posD.xyz, 1.0);
    // 크기: 신생 파티클이 약간 더 크고, 오래될수록 작아짐 (소멸감)
    float ageFactor = 0.7 + 0.3 * lifeRatio;
    float r     = max(0.04, 0.05) * uPointSize * ageFactor;
    gl_PointSize = clamp(r * uCamConst / (-mvPos.z), 0.5, 60.0);
    gl_Position  = projectionMatrix * mvPos;

  }
`;


const PART_FS = /* glsl */`
  varying vec4 vColor;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float s = smoothstep(0.5, 0.12, d);
    gl_FragColor = vec4(vColor.rgb, vColor.a * s);
  }
`;

// ──────────────────────────────────────────────────────────────────────
// Star Body 셰이더
// ──────────────────────────────────────────────────────────────────────
const STAR_VS = /* glsl */`
  attribute float aPhase;
  attribute float aMass;
  attribute float aPhaseAge;   // 현재 위상 경과 시간(초) — CPU에서 매 프레임 갱신
  uniform float uTime;
  uniform float uStarScale;
  varying float vPhase;
  varying float vMass;
  varying float vTime;
  varying float vTemp;
  varying float vPhaseAge;     // fragment shader로 전달

  void main() {
    vPhase    = aPhase;
    vMass     = aMass;
    vTime     = uTime;
    vPhaseAge = aPhaseAge;

    // ── 물리 기반 온도 계산 (L-M, R-M 관계 사용) ─────────────────
    float massSun   = max(aMass / 180.0, 0.01);
    float luminosity = pow(massSun, 3.5);
    float radius     = pow(massSun, 0.7);
    float physTemp   = 5778.0 * pow(luminosity / (radius * radius), 0.25);

    float temp;
    if (aPhase < 0.5) {
      temp = 2500.0;
    } else if (aPhase < 1.5) {
      temp = clamp(physTemp * 0.4, 2500.0, 6000.0);
    } else if (aPhase < 2.5) {
      temp = clamp(physTemp, 4000.0, 40000.0);
    } else if (aPhase < 3.5) {
      temp = clamp(physTemp * 0.35, 2800.0, 4500.0);
    } else if (aPhase < 4.5) {
      temp = 60000.0; // Supernova
    } else {
      temp = aMass >= 800.0 ? 100000.0 : 25000.0; // NS(청백) or WD(백색)
    }
    vTemp = temp;

    float sz;
    if (aPhase < 0.5) {
      // Nebula: 더 크고 선명하게
      sz = (12.0 + aMass * 0.12) * uStarScale;
    } else if (aPhase < 1.5) {
      float pulse = 0.88 + 0.12 * sin(uTime * 5.5 + aMass * 0.09);
      sz = (10.0 + aMass * 0.04) * pulse * uStarScale;
    } else if (aPhase < 2.5) {
      sz = (14.0 + pow(aMass, 0.45) * 0.5) * uStarScale;
    } else if (aPhase < 3.5) {
      float pulse = 0.92 + 0.08 * sin(uTime * 1.2 + aMass * 0.02);
      sz = (30.0 + pow(aMass, 0.4) * 0.8) * pulse * uStarScale;
    } else if (aPhase < 4.5) {
      // Supernova: phaseAge 기반 팽창-수축 (전역 time mod 제거)
      float t = clamp(aPhaseAge / 15.0, 0.0, 1.0);
      float burst = t < 0.35
        ? smoothstep(0.0, 0.35, t) * 110.0
        : mix(110.0, 12.0, smoothstep(0.35, 1.0, t));
      sz = burst * uStarScale;
    } else {
      // Remnant: 팽창하는 행성상 성운 (phaseAge와 함께 커짐)
      float age_t = clamp(aPhaseAge / 90.0, 0.0, 1.0);
      sz = (20.0 + age_t * 40.0) * uStarScale; // 20→60px 팽창
    }
    gl_PointSize = clamp(sz, 2.0, 200.0);

    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPos;
  }
`;


const STAR_FS = /* glsl */`
  precision highp float;

  uniform float uTime;
  varying float vPhase;
  varying float vMass;
  varying float vTime;
  varying float vTemp;
  varying float vPhaseAge;   // 현재 위상 경과 시간 (CPU → VS → FS)

  // ── Tanner Helland / Mitchell Charity 블랙바디 근사 ──────────────
  vec3 kelvinToRGB(float tempK) {
    float t = clamp(tempK, 1000.0, 40000.0) / 100.0;
    vec3 c;
    c.r = t <= 66.0 ? 1.0 : clamp(329.6987 * pow(t - 60.0, -0.1332) / 255.0, 0.0, 1.0);
    c.g = t <= 66.0
      ? clamp((99.4708 * log(t) - 161.1195) / 255.0, 0.0, 1.0)
      : clamp(288.1221 * pow(t - 60.0, -0.0755) / 255.0, 0.0, 1.0);
    c.b = t >= 66.0 ? 1.0
        : t <= 19.0 ? 0.0
        : clamp((138.5177 * log(t - 10.0) - 305.0447) / 255.0, 0.0, 1.0);
    return c;
  }

  vec3 artisticBoost(vec3 c) {
    vec3 gray = vec3(dot(c, vec3(0.299, 0.587, 0.114)));
    return clamp(mix(gray, c, 2.2), 0.0, 1.0);
  }

  void main() {
    vec2  uv = gl_PointCoord - 0.5;
    float d  = length(uv);
    if (d > 0.5) discard;

    vec3 baseColor = artisticBoost(kelvinToRGB(vTemp));

    vec4 col;
    if (vPhase < 0.5) {
      // ── Nebula: 더 넓고 밝은 성운 구름 ─────────────────────────
      float g      = exp(-d*d * 3.5);          // 더 넓은 부드러운 코어
      float halo   = exp(-d*d * 0.7) * 0.7;   // 넓은 헤일로
      float bright = exp(-d*d * 30.0) * 0.5;  // 밝은 중심점
      vec3  nebulaColor = mix(baseColor, vec3(0.35, 0.15, 0.9), 0.55);
      col = vec4(nebulaColor + vec3(0.3, 0.2, 0.5) * bright,
                 clamp((g + halo) * 0.85 + bright, 0.0, 1.0));

    } else if (vPhase < 1.5) {
      // ── Protostar: 맥동 T-Tauri ──────────────────────────────
      float pulse  = 0.85 + 0.15 * sin(vTime * 6.0 + vMass * 0.12);
      float core   = exp(-d*d * 40.0) * pulse;
      float corona = exp(-d*d *  6.0) * 0.72;
      float disk   = exp(-d*d *  1.5) * 0.3;
      vec3 diskColor = mix(baseColor, vec3(0.5, 0.05, 0.01), 0.4);
      col = vec4(baseColor*core + baseColor*0.6*corona + diskColor*disk,
                 clamp(core*1.3 + corona*0.9 + disk*0.45, 0.0, 1.0));

    } else if (vPhase < 2.5) {
      // ── Main Sequence: 주연 감광 + 코로나 ────────────────────
      float NdotV = clamp(1.0 - d * 2.0, 0.0, 1.0);
      float limb  = 0.4 + 0.6 * pow(NdotV, 0.55);
      float core  = exp(-d*d * 60.0);
      float cor   = exp(-d*d *  5.0) * 0.8;
      float halo  = exp(-d*d *  0.9) * 0.2;
      vec3 coronaColor = mix(baseColor, vec3(0.85, 0.95, 1.0), clamp((vTemp - 5000.0) / 25000.0, 0.0, 1.0));
      col = vec4(baseColor * (core * limb + cor) + coronaColor * halo,
                 clamp(core * 1.4 + cor + halo * 0.5, 0.0, 1.0));

    } else if (vPhase < 3.5) {
      // ── Red Giant: 크고 식은 별 ──────────────────────────────
      float NdotV = clamp(1.0 - d * 1.8, 0.0, 1.0);
      float limb  = 0.3 + 0.7 * pow(NdotV, 0.35);
      float core  = exp(-d*d * 18.0);
      float atmo  = exp(-d*d *  2.5) * 0.65;
      float halo  = exp(-d*d *  0.4) * 0.35;
      vec3 edgeColor = mix(baseColor, vec3(0.5, 0.03, 0.01), 0.5);
      vec3 rgb    = mix(baseColor, edgeColor, d * 1.5) * limb;
      col = vec4(rgb * (core + atmo) + edgeColor * halo,
                 clamp(core * 1.2 + atmo + halo * 0.6, 0.0, 1.0));

    } else if (vPhase < 4.5) {
      // ── Supernova: phaseAge 기반 팽창 + Gaussian 블러 ──────────
      float t      = clamp(vPhaseAge / 15.0, 0.0, 1.0);
      float bright = t < 0.35
        ? smoothstep(0.0, 0.35, t)
        : mix(1.0, 0.05, smoothstep(0.35, 1.0, t));

      // 충격파 링: 바깥쪽으로 팽창하며 점점 넓어짐 (팽창=확산)
      float ringR   = 0.08 + t * 0.40;          // 0.08 → 0.48 팽창
      float ringW   = 0.04 + t * 0.18;          // 링 폭도 점점 넓어짐 (확산)
      float ring1   = exp(-pow(d - ringR, 2.0) / (2.0 * ringW * ringW)) * bright;
      // 내부 잔광 링 (더 넓고 흐릿)
      float ring2   = exp(-pow(d - ringR * 0.55, 2.0) / (2.0 * (ringW * 1.8) * (ringW * 1.8))) * bright * 0.5;
      // 가우시안 코어
      float core    = exp(-d*d * 60.0);
      // 전체 구름 헤일로 (광범위하게 퍼짐)
      float nebula  = exp(-d*d * 1.2) * bright * 0.55;

      // 충격파 색: 외부=주황(냉각가스), 내부=청백(고온), 헤일로=자주
      vec3 outerShock = mix(vec3(1.0, 0.5, 0.05), baseColor, 0.2);
      vec3 innerShock = mix(baseColor, vec3(0.8, 0.9, 1.0), 0.3);
      vec3 nebulaHue  = mix(vec3(0.6, 0.2, 0.8), baseColor, 0.4);

      col = vec4(baseColor * core
               + outerShock * ring1
               + innerShock * ring2 * 0.7
               + nebulaHue  * nebula,
               clamp(core + ring1 * 2.0 + ring2 + nebula * 0.9, 0.0, 1.0));

    } else {
      // ── Remnant: 행성상 성운 (planetary nebula) ───────────────
      float age_t  = clamp(vPhaseAge / 90.0, 0.0, 1.0);
      float fade   = clamp(1.0 - age_t, 0.0, 1.0);

      // 팽창하는 외부 껍질 — 행성상 성운 특유의 링
      float shellR = 0.12 + age_t * 0.32;   // 점점 바깥으로 팽창
      float shellW = 0.04 + age_t * 0.12;   // 점점 넓어지며 흐릿해짐
      float shell  = exp(-pow(d - shellR, 2.0) / (2.0 * shellW * shellW));

      // 내부 확산 글로우
      float inner  = exp(-d*d * (6.0 - age_t * 4.0)) * 0.6; // 점점 넓어짐

      // 중심 잔해 (WD or NS)
      float core   = exp(-d*d * 250.0);

      // 펄서 빔 (NS: mass >= 800)
      float beam = 0.0;
      if (vMass >= 800.0) {
        float angle = atan(uv.y, uv.x);
        beam = max(0.0, cos(angle * 2.0 + vTime * 25.0))
             * exp(-d*d * 60.0) * 0.7;
      }

      // 색상: OIII 청록(외부) + Hα 붉은 주황(내부) + 잔해 색(중심)
      vec3 oiiiColor = vec3(0.1, 0.85, 1.0);           // 청록 [O III]
      vec3 haColor   = mix(vec3(1.0, 0.35, 0.1),        // H-alpha 붉은
                           vec3(0.6, 0.2, 0.9), age_t); // 노화되면 보라 띰
      vec3 coreColor = baseColor;                        // WD/NS 고유 색

      col = vec4(oiiiColor * shell + haColor * inner + coreColor * (core + beam),
                 clamp((shell * 1.6 + inner * 0.8 + core * 3.0 + beam) * fade, 0.0, 1.0));
    }
    gl_FragColor = col;
  }
`;




// ──────────────────────────────────────────────────────────────────────
// Raw WebGL ping-pong helper
// ──────────────────────────────────────────────────────────────────────
function makeRT(gl: THREE.WebGLRenderer) {
  return new THREE.WebGLRenderTarget(WIDTH, WIDTH, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    type: THREE.FloatType,
    format: THREE.RGBAFormat,
    depthBuffer: false,
    stencilBuffer: false,
  });
}

// ── Three.js 0.186.1 build/three.module.js 누락 메서드 폴리필 ──────────
// 1. intersectsFrustum (line 17929): frustumCulled=false로 차단하되 안전망
if (!(THREE.Mesh.prototype as any).intersectsFrustum) {
  (THREE.Mesh.prototype as any).intersectsFrustum = function (f: THREE.Frustum) {
    if (!this.geometry.boundingSphere) this.geometry.computeBoundingSphere();
    return f.intersectsSphere(
      this.geometry.boundingSphere!.clone().applyMatrix4(this.matrixWorld)
    );
  };
}
// 2. determinantAffine (line 17237): frustumCulled과 무관하게 항상 호출됨
//    column-major 4×4에서 상위 3×3 행렬식 (미러 변환 감지용)
if (!(THREE.Matrix4.prototype as any).determinantAffine) {
  (THREE.Matrix4.prototype as any).determinantAffine = function () {
    const e = this.elements;
    return e[0] * (e[5] * e[10] - e[9] * e[6])
      - e[4] * (e[1] * e[10] - e[9] * e[2])
      + e[8] * (e[1] * e[6] - e[5] * e[2]);
  };
}

// 공유 fullscreen quad (frustumCulled=false)
const _quadPlane = new THREE.PlaneGeometry(2, 2);
const _quadMesh = new THREE.Mesh(_quadPlane);
_quadMesh.frustumCulled = false;
const _quadScene = new THREE.Scene();
_quadScene.add(_quadMesh);
const _quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);


function runCompute(
  renderer: THREE.WebGLRenderer,
  mat: THREE.ShaderMaterial,
  target: THREE.WebGLRenderTarget
) {
  _quadMesh.material = mat;
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  renderer.render(_quadScene, _quadCamera);
  renderer.setRenderTarget(prev);
}


// ──────────────────────────────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────────────────────────────
export function StarFieldSystem({
  playerPosRef,
  playerYRef,
  onStarsUpdate,
  particleOpacity = 0.90,
  spawnRate = 100,
  lifetime = 0.85,
  spread = 2.45,
  pointSize = 0.3,
  attractG = 0.80,
  clusterThreshold = 20,
  starScale = 1.2,
  spawnJitter = 1.0,   // 초기 파티클 속도 지터 배율 (0=정지, 1=기본, 2+=고에너지)
  botPositions,        // 봇들의 위치 목록 (선택)
}: {
  playerPosRef: React.MutableRefObject<{ x: number; z: number }>;
  playerYRef: React.MutableRefObject<number>;
  onStarsUpdate?: (stars: StarBody[]) => void;
  particleOpacity?: number;
  spawnRate?: number;
  lifetime?: number;
  spread?: number;
  pointSize?: number;
  attractG?: number;
  clusterThreshold?: number;
  starScale?: number;
  spawnJitter?: number;
  botPositions?: Array<{ x: number; z: number }>; // 봇 위치 목록
}) {
  const { gl } = useThree();
  const LT = lifetime * LIFETIME_BASE;


  // ── ping-pong render targets ─────────────────────────────────────
  const posRT = useRef<[THREE.WebGLRenderTarget, THREE.WebGLRenderTarget] | null>(null);
  const velRT = useRef<[THREE.WebGLRenderTarget, THREE.WebGLRenderTarget] | null>(null);
  const velMat = useRef<THREE.ShaderMaterial | null>(null);
  const posMat = useRef<THREE.ShaderMaterial | null>(null);
  const pingIdx = useRef(0); // 0 or 1

  // spawn data textures
  const spawnPosTex = useRef<THREE.DataTexture | null>(null);
  const spawnVelTex = useRef<THREE.DataTexture | null>(null);
  const spawnPD = useRef(new Float32Array(MAX_SPAWN * 4));
  const spawnVD = useRef(new Float32Array(MAX_SPAWN * 4));

  // body arrays (flat)
  const bodyPosArr = useRef(new Float32Array(MAX_STARS * 4));
  const bodyMassArr = useRef(new Float32Array(MAX_STARS));

  // render material
  const partMatRef = useRef<THREE.ShaderMaterial | null>(null);
  const partGeoRef = useRef<THREE.BufferGeometry | null>(null);
  const ptsGroupRef = useRef<THREE.Group>(null); // Points container (JSX group)
  const ptsRef = useRef<THREE.Points | null>(null); // Points object

  // CPU state
  const nextSpawnSlot = useRef(0);
  const timeSinceSpawn = useRef(0);
  const prevPos = useRef({ x: 0, z: 0 });
  const starBodies = useRef<StarBody[]>([]);
  const spawnCounts = useRef(new Map<string, number>());
  const frameCount = useRef(0);
  // GPU readback: 2초마다 position texture를 CPU로 읽어 실제 파티클 밀도 계산
  const readbackTimer = useRef(0);
  const readbackBuf = useRef(new Float32Array(TOTAL * 4));
  const READBACK_INTERVAL = 2.0; // seconds

  // star body buffers
  const sPosBuf = useMemo(() => {
    const a = new Float32Array(MAX_STARS * 3);
    for (let i = 0; i < MAX_STARS; i++) a[i * 3 + 1] = -9999;
    return a;
  }, []);
  const sPhsBuf = useMemo(() => new Float32Array(MAX_STARS), []);
  const sMasBuf     = useMemo(() => new Float32Array(MAX_STARS), []);
  const sPhaseAgeBuf = useMemo(() => new Float32Array(MAX_STARS), []); // phaseAge per star
  const sGeoRef = useRef<THREE.BufferGeometry>(null);
  const sTimeUni = useMemo(() => ({ value: 0 }), []);
  const sStarScaleUni = useMemo(() => ({ value: starScale }), []);
  // starScale 변경 시 uniform 값 직접 갱신 (useMemo 재실행 없이)
  sStarScaleUni.value = starScale;

  // ── 초기화 ───────────────────────────────────────────────────────
  useEffect(() => {
    const bodyPosInit = new Float32Array(MAX_STARS * 4);
    for (let i = 0; i < MAX_STARS; i++) bodyPosInit[i * 4 + 1] = -9999;
    bodyPosArr.current = bodyPosInit;

    // spawn textures (MAX_SPAWN×1)
    spawnPosTex.current = new THREE.DataTexture(
      spawnPD.current, MAX_SPAWN, 1, THREE.RGBAFormat, THREE.FloatType
    );
    spawnVelTex.current = new THREE.DataTexture(
      spawnVD.current, MAX_SPAWN, 1, THREE.RGBAFormat, THREE.FloatType
    );

    // ping-pong RT × 2 각각
    posRT.current = [makeRT(gl), makeRT(gl)];
    velRT.current = [makeRT(gl), makeRT(gl)];

    // 모든 RT를 (0,0,0,0)으로 초기화: lifetime=0, mass=0 → 전부 dead
    // THREE.WebGLRenderer.clearColor()는 기본 clearAlpha=1 (불투명 검정)로 클리어되므로
    // raw WebGL context를 통해 직접 clearColor(0,0,0,0) 설정
    const rawGL = gl.getContext() as WebGL2RenderingContext;
    rawGL.clearColor(0, 0, 0, 0);
    [posRT.current[0], posRT.current[1], velRT.current[0], velRT.current[1]].forEach(rt => {
      gl.setRenderTarget(rt);
      rawGL.clear(rawGL.COLOR_BUFFER_BIT);
    });
    gl.setRenderTarget(null);
    // Three.js clearColor 복원 (R3F 기본값)
    gl.setClearColor(0x000000, 1);


    // velocity compute material
    const vm = new THREE.ShaderMaterial({
      vertexShader: QUAD_VS,
      fragmentShader: VEL_FS,
      uniforms: {
        uPos: { value: null },
        uVel: { value: null },
        uResolution: { value: new THREE.Vector2(WIDTH, WIDTH) },
        uDt: { value: 1 / 60 },
        uG: { value: attractG },
        uSpawnVel: { value: spawnVelTex.current },
        uSpawnStart: { value: 0 },
        uSpawnCount: { value: 0 },
        uLifetimeGate: { value: LT - 5.0 }, // pos.w > this → < 5초 → 중력 스킵
        uNumBodies: { value: 0 },
        uBodyPos: { value: bodyPosArr.current },
        uBodyMass: { value: bodyMassArr.current },
      },
    });

    // position compute material
    const pm = new THREE.ShaderMaterial({
      vertexShader: QUAD_VS,
      fragmentShader: POS_FS,
      uniforms: {
        uPos: { value: null },
        uVel: { value: null },
        uResolution: { value: new THREE.Vector2(WIDTH, WIDTH) },
        uDt: { value: 1 / 60 },
        uSpawnPos: { value: spawnPosTex.current },
        uSpawnStart: { value: 0 },
        uSpawnCount: { value: 0 },
      },
    });

    // render geometry (UV = texel centers)
    const geo = new THREE.BufferGeometry();
    const uvArr = new Float32Array(TOTAL * 2);
    for (let i = 0; i < TOTAL; i++) {
      uvArr[i * 2] = ((i % WIDTH) + 0.5) / WIDTH;
      uvArr[i * 2 + 1] = (Math.floor(i / WIDTH) + 0.5) / WIDTH;
    }
    // 더미 position (vertex shader에서 texture 샘플)
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(TOTAL * 3), 3));
    geo.setAttribute("aTexUV", new THREE.BufferAttribute(uvArr, 2));

    const partMat = new THREE.ShaderMaterial({
      vertexShader: PART_VS,
      fragmentShader: PART_FS,
      uniforms: {
        uPos: { value: null },
        uVel: { value: null },
        uCamConst: { value: 200 },
        uOpacity: { value: particleOpacity },
        uPointSize: { value: pointSize },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });


    velMat.current = vm;
    posMat.current = pm;
    partMatRef.current = partMat;
    partGeoRef.current = geo;

    // Points 생성 — group에 즉시 추가 (ref가 이미 채워진 경우) or 다음 프레임 대기
    const pts = new THREE.Points(geo, partMat);
    pts.frustumCulled = false;
    ptsRef.current = pts;
    if (ptsGroupRef.current) {
      ptsGroupRef.current.add(pts);
    }


    // localStorage 복원
    try {
      const saved = localStorage.getItem("anthropocene:stars:v1");
      if (saved) {
        const records = JSON.parse(saved) as StarBody[];
        // 구버전 데이터에 vx,vz 없을 수 있으므로 기본값 보완
        starBodies.current = records.filter(s => s.isPermanent)
          .map(s => ({ ...s, vx: s.vx ?? 0, vz: s.vz ?? 0, phaseAge: s.phaseAge ?? 0 }));
        onStarsUpdate?.(starBodies.current);
      }

    } catch { }

    return () => {
      posRT.current?.[0].dispose();
      posRT.current?.[1].dispose();
      velRT.current?.[0].dispose();
      velRT.current?.[1].dispose();
      vm.dispose();
      pm.dispose();
      partMat.dispose();
      geo.dispose();
      spawnPosTex.current?.dispose();
      spawnVelTex.current?.dispose();
      ptsGroupRef.current?.remove(pts);
    };
  }, [gl]);

  // ── Frame Loop ───────────────────────────────────────────────────
  useFrame((state, delta) => {
    // group ref가 나중에 채워질 경우 대비한 지연 추가
    if (ptsRef.current && ptsGroupRef.current && !ptsRef.current.parent) {
      ptsGroupRef.current.add(ptsRef.current);
    }

    const vm = velMat.current;
    const pm = posMat.current;
    const pm2 = partMatRef.current;
    const pRT = posRT.current;
    const vRT = velRT.current;
    if (!vm || !pm || !pm2 || !pRT || !vRT) return;

    const dt = Math.min(delta, 0.05);
    sTimeUni.value += dt;
    frameCount.current++;

    const px = playerPosRef.current.x;
    const py = playerYRef.current;
    const pz = playerPosRef.current.z;
    const ddx = px - prevPos.current.x;
    const ddz = pz - prevPos.current.z;
    const spd = Math.sqrt(ddx * ddx + ddz * ddz) / dt;
    prevPos.current = { x: px, z: pz };

    const cur = pingIdx.current;
    const next = 1 - cur;

    // ── 1. Spawn ─────────────────────────────────────────────────
    let spawnCount = 0;
    {
      // 이동 중: 100% 속도 / 정지 중: 15% 속도 (대기 중에도 소량 생성)
      const effectiveRate = spd > 0.08 ? spawnRate : spawnRate * 0.15;
      timeSinceSpawn.current += dt;
      const interval = 1.0 / effectiveRate;
      const pd = spawnPD.current;
      const vd = spawnVD.current;
      while (timeSinceSpawn.current >= interval && spawnCount < MAX_SPAWN) {
        timeSinceSpawn.current -= interval;
        // 플레이어 근처에 작은 반경으로 생성 (TraceSystem 느낌)
        const r = (0.05 + Math.random() * 0.25) * spread;
        const a = Math.random() * Math.PI * 2;
        const lf = (0.8 + Math.random() * 0.4) * LT;
        const si = spawnCount;

        pd[si * 4] = px + Math.cos(a) * r;
        pd[si * 4 + 1] = py + (Math.random() - 0.5) * 0.08;
        pd[si * 4 + 2] = pz + Math.sin(a) * r;
        pd[si * 4 + 3] = lf;

        // 초기 속도 지터: spawnJitter 슬라이더로 조절 (0=정지, 1=기본, 2=높은 에너지)
        // spawnJitter 클수록 파티클이 퍼지고 잘 뭉치지 않음 → "흡수 안 되는" 조건에 근접
        const dv = (Math.random() * 0.5 - 0.25) * spread * 0.04 * spawnJitter;
        const da = Math.random() * Math.PI * 2;
        vd[si * 4] = Math.cos(da) * dv;
        vd[si * 4 + 1] = (Math.random() - 0.5) * 0.005 * spawnJitter;
        vd[si * 4 + 2] = Math.sin(da) * dv;
        vd[si * 4 + 3] = 1.0;
        spawnCount++;


        // spawn 누적 카운트만 기록 (실제 수렴 감지는 readback에서)
        if (frameCount.current % 3 === 0) {
          const cx = Math.floor(px / CELL_SIZE);
          const cz = Math.floor(pz / CELL_SIZE);
          const key = `${cx},${cz}`;
          spawnCounts.current.set(key, (spawnCounts.current.get(key) ?? 0) + 1);
        }
      }
      // 타이머 폭발 방지 (속도 전환 시 burst 차단)
      if (timeSinceSpawn.current > interval * 3) timeSinceSpawn.current = interval * 3;
    }

    // ── 1-b. Bot spawn (botPositions 있을 때만) ──────────────────
    if (botPositions && botPositions.length > 0 && spawnCount < MAX_SPAWN) {
      const bot = botPositions[Math.floor(frameCount.current / 3) % botPositions.length];
      const r = (0.05 + Math.random() * 0.25) * spread;
      const a = Math.random() * Math.PI * 2;
      const pd = spawnPD.current;
      const vd = spawnVD.current;
      const si = spawnCount;
      pd[si*4]   = bot.x + Math.cos(a)*r;
      pd[si*4+1] = py + (Math.random()-0.5)*0.08;
      pd[si*4+2] = bot.z + Math.sin(a)*r;
      pd[si*4+3] = (0.8 + Math.random()*0.4) * LT;
      const dv = (Math.random()*0.5-0.25)*spread*0.04*spawnJitter;
      const da = Math.random()*Math.PI*2;
      vd[si*4]   = Math.cos(da)*dv;
      vd[si*4+1] = 0;
      vd[si*4+2] = Math.sin(da)*dv;
      vd[si*4+3] = 1.0;
      spawnCount++;
    }

    if (spawnCount > 0) {
      spawnPosTex.current!.needsUpdate = true;
      spawnVelTex.current!.needsUpdate = true;
    }

    // ── 1-b. GPU Readback (2초마다): 실제 파티클 수렴 감지 ────────
    readbackTimer.current += dt;
    if (readbackTimer.current >= READBACK_INTERVAL && pRT) {
      readbackTimer.current = 0;
      const buf = readbackBuf.current;
      try {
        // position texture 읽기: rgba = (x, y, z, lifetime)
        gl.readRenderTargetPixels(pRT[cur], 0, 0, WIDTH, WIDTH, buf);

        // 1) 기존 StarBody 질량 업데이트 (실제 수렴 파티클 카운트)
        const stars = starBodies.current;
        for (const star of stars) {
          const capR = Math.max(star.radius * 4, 2.0); // 탐지 반경
          let count = 0;
          for (let i = 0; i < TOTAL; i++) {
            if (buf[i * 4 + 3] <= 0) continue; // dead
            const dx = buf[i * 4] - star.x;
            const dz = buf[i * 4 + 2] - star.z;
            if (dx * dx + dz * dz < capR * capR) count++;
          }
          // 부드러운 질량 갱신 (급격한 변화 방지)
          star.mass = star.mass * 0.6 + count * 0.4;
        }

        // 2) 새 StarBody 후보: 공간 해시 셀 중 threshold 이상 & GPU 파티클도 실제로 있음
        if (stars.length < MAX_STARS) {
          const checked = new Set<string>();
          for (const [key, cnt] of spawnCounts.current.entries()) {
            if (cnt < clusterThreshold || checked.has(key)) continue;
            checked.add(key);
            const [cxS, czS] = key.split(",").map(Number);
            const bx = (cxS + 0.5) * CELL_SIZE;
            const bz = (czS + 0.5) * CELL_SIZE;

            // 이미 가까운 StarBody가 있으면 스킵
            const tooClose = stars.some(s => {
              const dx = s.x - bx, dz = s.z - bz;
              return dx * dx + dz * dz < MIN_GAP * MIN_GAP;
            });
            if (tooClose) continue;

            // GPU 파티클이 실제로 이 위치 근처에 있는지 확인
            const DETECT_R = CELL_SIZE * 1.2;
            let gpuCount = 0, cx2 = 0, cy2 = 0, cz2 = 0;
            for (let i = 0; i < TOTAL; i++) {
              if (buf[i * 4 + 3] <= 0) continue;
              const dx = buf[i * 4] - bx;
              const dz = buf[i * 4 + 2] - bz;
              if (dx * dx + dz * dz < DETECT_R * DETECT_R) {
                gpuCount++;
                cx2 += buf[i * 4];
                cy2 += buf[i * 4 + 1];
                cz2 += buf[i * 4 + 2];
              }
            }

            // gpuCount >= 3: 이 셀에 살아있는 파티클이 3개 이상이면 Nebula 형성
            if (gpuCount >= 3) {
              const comX = cx2 / gpuCount;
              const comY = cy2 / gpuCount;
              const comZ = cz2 / gpuCount;

              // 인근 기존 별이 있으면 공전 방향으로 초기 속도 부여 (나선 궤도 유도)
              let initVx = 0, initVz = 0;
              const nearStar = stars.reduce<StarBody | null>((best, s) => {
                const dx2 = s.x - comX, dz2 = s.z - comZ;
                const d2 = dx2*dx2 + dz2*dz2;
                if (d2 > 100) return best; // 10 유닛 초과는 무시
                if (!best) return s;
                const bd = (best.x-comX)**2 + (best.z-comZ)**2;
                return d2 < bd ? s : best;
              }, null);
              if (nearStar) {
                const dx2 = nearStar.x - comX, dz2 = nearStar.z - comZ;
                const dist = Math.sqrt(dx2*dx2 + dz2*dz2) + 0.01;
                // 수직 방향 (공전 방향)
                const perpX = -dz2 / dist, perpZ = dx2 / dist;
                // 공전 속도 v = sqrt(G*M/r) × 감쇠계수
                const vOrb = Math.sqrt(G_STAR * nearStar.mass / dist) * 0.5;
                initVx = perpX * vOrb;
                initVz = perpZ * vOrb;
              }

              stars.push({
                id: `star_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                x: comX, y: comY, z: comZ,
                vx: initVx, vz: initVz, phaseAge: 0,
                mass: gpuCount,
                phase: "nebula", age: 0, radius: 0.3, isPermanent: false, creatorAngle: (typeof sessionStorage !== "undefined" ? (() => { try { const d = sessionStorage.getItem(SS_PLANE_KEY); return d ? JSON.parse(d).angle : 0; } catch { return 0; } })() : 0),
              });

              spawnCounts.current.set(key, 0);
              console.log(`%c[Nebula] (${comX.toFixed(1)}, ${comZ.toFixed(1)}) gpu=${gpuCount}개 orbit=${initVx.toFixed(3)}`, "color:#a78bfa;font-weight:bold");
            } else if (gpuCount > 0) {
              console.log(`[readback] 셀(${key}): spawn=${cnt} gpu=${gpuCount} → 아직 부족`);

            }

          }
        }
      } catch (e) {
        // readback 실패 시 (일부 WebGL 구현) 무시
      }
    }

    // ── 2. Star body uniforms ─────────────────────────────────────
    const stars = starBodies.current;
    const bpa = bodyPosArr.current;
    const bma = bodyMassArr.current;
    for (let b = 0; b < MAX_STARS; b++) {
      if (b < stars.length) {
        const s = stars[b];
        bpa[b * 4] = s.x; bpa[b * 4 + 1] = s.y; bpa[b * 4 + 2] = s.z; bpa[b * 4 + 3] = s.radius;
        bma[b] = s.mass;
      } else {
        bpa[b * 4 + 1] = -9999; bma[b] = 0;
      }
    }
    vm.uniforms.uNumBodies.value = stars.length;
    // flat array는 Three.js가 자동으로 업데이트하지 않으므로 needsUpdate 없음
    // 직접 reference 유지됨

    // ── 3. Velocity compute ───────────────────────────────────────
    vm.uniforms.uPos.value = pRT[cur].texture;
    vm.uniforms.uVel.value = vRT[cur].texture;
    vm.uniforms.uDt.value = dt;
    vm.uniforms.uG.value = attractG;
    vm.uniforms.uLifetimeGate.value = LT - 5.0; // Leva 변경 즉시 반영
    vm.uniforms.uSpawnStart.value = nextSpawnSlot.current;
    vm.uniforms.uSpawnCount.value = spawnCount;
    runCompute(gl, vm, vRT[next]);


    // ── 4. Position compute ───────────────────────────────────────
    pm.uniforms.uPos.value = pRT[cur].texture;
    pm.uniforms.uVel.value = vRT[next].texture; // 방금 계산한 vel
    pm.uniforms.uDt.value = dt;
    pm.uniforms.uSpawnStart.value = nextSpawnSlot.current;
    pm.uniforms.uSpawnCount.value = spawnCount;
    runCompute(gl, pm, pRT[next]);

    // ring buffer 전진
    nextSpawnSlot.current = (nextSpawnSlot.current + spawnCount) % TOTAL;
    pingIdx.current = next;

    // ── 5. 파티클 렌더 material에 결과 바인딩 ─────────────────────
    pm2.uniforms.uPos.value = pRT[next].texture;
    pm2.uniforms.uVel.value = vRT[next].texture;
    pm2.uniforms.uOpacity.value = particleOpacity;
    pm2.uniforms.uPointSize.value = pointSize;  // Leva 즉시 반영
    pm2.uniforms.uCamConst.value = window.innerHeight / (2 * Math.tan(
      (state.camera as THREE.PerspectiveCamera).fov * Math.PI / 360
    ));


    // ── 6. StarBody 진화 ─────────────────────────────────────────
    let changed = false;
    for (let si = stars.length - 1; si >= 0; si--) {
      const s = stars[si];
      s.age += dt;
      s.phaseAge += dt;  // 현재 위상 경과 시간

      // Nebula → Protostar
      if (s.phase === "nebula" && s.mass >= MASS_PROTO) {
        s.phase = "protostar"; s.radius = 0.5; s.phaseAge = 0; changed = true;
      }
      // Protostar 크기 + → MainSequence
      if (s.phase === "protostar") {
        s.radius = 0.4 + Math.pow(s.mass, 0.33) * 0.045;
        if (s.mass >= MASS_MAIN && s.age >= AGE_MAIN) {
          s.phase = "mainSequence"; s.radius = 0.75; s.isPermanent = true; s.phaseAge = 0; changed = true;
          console.log(`%c[★ MainSeq] mass=${s.mass.toFixed(0)}`, "color:#fde68a;font-weight:bold");
        }
      }
      // MainSequence → Red Giant: 질량 크고 MainSeq로 충분히 오래됨
      if (s.phase === "mainSequence" && s.mass >= MASS_GIANT && s.phaseAge >= AGE_MAIN_AS_GIANT) {
        s.phase = "redGiant"; s.radius = 1.5; s.phaseAge = 0; changed = true;
        console.log(`%c[🔴 RedGiant] mass=${s.mass.toFixed(0)}`, "color:#f87171;font-weight:bold");
      }
      // Red Giant → Supernova: RedGiant로 AGE_GIANT_PHASE(60s) 지나면 폭발 (질량 무관)
      if (s.phase === "redGiant" && s.phaseAge >= AGE_GIANT_PHASE) {
        s.phase = "supernova"; s.radius = 3.0; s.phaseAge = 0; changed = true;
        console.log(`%c[💥 SUPERNOVA] mass=${s.mass.toFixed(0)}`, "color:#ff4444;font-size:14px;font-weight:bold");
      }
      // Supernova 종료 → remnant 전환 (소멸 대신 잔해 남김)
      if (s.phase === "supernova" && s.phaseAge >= SN_DURATION) {
        s.phase = "remnant"; s.phaseAge = 0;
        s.radius = s.mass >= 800 ? 0.15 : 0.2; // NS=작음, WD=약간 큼
        changed = true;
        const type = s.mass >= 800 ? "중성자성" : "백색왜성";
        console.log(`%c[잔해] ${type} 형성 mass=${s.mass.toFixed(0)}`, "color:#88aaff;font-weight:bold");
      }
      // Remnant: 90초 페이드 후 소멸
      if (s.phase === "remnant" && s.phaseAge >= REMNANT_DURATION) {
        stars.splice(si, 1); changed = true;
        console.log("%c[소멸] 잔해 사라짐", "color:#444");
        continue;
      }

      // 반경은 질량에 비례 (readback으로 갱신된 실제 질량 기반)
      if (s.phase === "nebula") {
        s.radius = 0.3 + Math.pow(Math.max(s.mass, 0), 0.3) * 0.08;
      }
      // 오랫동안 파티클이 없는 Nebula TTL (질량이 2 미만이고 120초 이상)
      if (s.phase === "nebula" && s.age > 120 && s.mass < 2) {
        stars.splice(si, 1); changed = true;
        continue;
      }

      // 별 이동 (인력으로 가속된 속도 적용)
      s.x += s.vx * dt;
      s.z += s.vz * dt;
      // 감속 (마찰: 공간 점성)
      s.vx *= 0.9996;  // 초당 ~2.4% 감쇠 → 공전 가능
      s.vz *= 0.9996;
    }

    // ── 6-b. 별-별 N-body 인력 ─────────────────────────────────────
    for (let i = 0; i < stars.length; i++) {
      for (let j = i + 1; j < stars.length; j++) {
        const si = stars[i], sj = stars[j];
        const dx = sj.x - si.x;
        const dz = sj.z - si.z;
        const dist2 = dx * dx + dz * dz + MERGE_SOFTENING * MERGE_SOFTENING;
        const dist = Math.sqrt(dist2);
        // F = G * m1 * m2 / r²  (단, 질량을 가속도로 나누면 a = G*m / r²)
        const fi = G_STAR * sj.mass / dist2; // si가 받는 가속도
        const fj = G_STAR * si.mass / dist2; // sj가 받는 가속도
        si.vx += fi * (dx / dist) * dt;
        si.vz += fi * (dz / dist) * dt;
        sj.vx -= fj * (dx / dist) * dt;
        sj.vz -= fj * (dz / dist) * dt;
      }
    }

    // ── 6-c. 별 합체 ──────────────────────────────────────────────
    // 두 별이 충분히 가까우면 합체: 질량·운동량 보존, 위상은 질량 큰 쪽 우선
    for (let i = stars.length - 1; i >= 1; i--) {
      for (let j = i - 1; j >= 0; j--) {
        const si = stars[i], sj = stars[j];
        const dx = si.x - sj.x;
        const dz = si.z - sj.z;
        const dist2 = dx * dx + dz * dz;
        const dist  = Math.sqrt(dist2) + 0.001;
        // Stage 1 시작 반경: 두 별의 반지름 합 + 여유 2.0 유닛
        const mergeR    = si.radius + sj.radius + 2.0;
        // 실제 합체 반경: 반지름 비례 (시각적 겹침 보장)
        const MERGE_CLOSE = Math.max(0.12, (si.radius + sj.radius) * 0.3);
        if (dist2 > mergeR * mergeR) continue;

        // ── Hill sphere / 각운동량 체크 ──────────────────────────────
        const relVx = si.vx - sj.vx, relVz = si.vz - sj.vz;
        const angMom = Math.abs((dx * relVz - dz * relVx) / dist);
        const vCirc  = Math.sqrt(G_STAR * (si.mass + sj.mass) / dist);
        if (angMom > vCirc * 0.4) continue;

        // ── Stage 1: 부드러운 인력 증폭 (급작스럽지 않게) ──────────
        // 근접도에 따라 1x → 30x 스무스 증폭 (경계에서 점프 없음)
        if (dist > MERGE_CLOSE) {
          const t      = 1.0 - Math.max(0, (dist - MERGE_CLOSE) / (mergeR - MERGE_CLOSE));
          const boostG = G_STAR * (1.0 + t * t * 29.0); // 1x~30x 부드러운 램프
          const acc    = boostG / (dist2 + 0.01);
          const nx = dx / dist, nz = dz / dist;
          si.vx -= acc * sj.mass * nx * dt;
          si.vz -= acc * sj.mass * nz * dt;
          sj.vx += acc * si.mass * nx * dt;
          sj.vz += acc * si.mass * nz * dt;
          continue;
        }

        // ── Stage 2: 시각적 겹침 후 합체 (dist ≤ MERGE_CLOSE) ───────
        // 합체! 질량 합산 + 운동량 보존
        const totalMass = si.mass + sj.mass;

        sj.x = (si.x * si.mass + sj.x * sj.mass) / totalMass;
        sj.z = (si.z * si.mass + sj.z * sj.mass) / totalMass;
        sj.vx = (si.vx * si.mass + sj.vx * sj.mass) / totalMass;
        sj.vz = (si.vz * si.mass + sj.vz * sj.mass) / totalMass;
        sj.mass = totalMass;

        // 위상: 둘 중 더 진화한 쪽 + 새 질량으로 재판단
        const phaseRank = (p: StarPhase) =>
          p === "supernova" ? 4 : p === "redGiant" ? 3 : p === "mainSequence" ? 2 : p === "protostar" ? 1 : 0;
        const domPhase = phaseRank(si.phase) > phaseRank(sj.phase) ? si : sj;
        if (phaseRank(si.phase) > phaseRank(sj.phase)) { sj.phase = si.phase; sj.phaseAge = si.phaseAge; }
        // 합체 후 즉시 위상 재판단

        if (sj.phase === "nebula" && sj.mass >= MASS_PROTO) { sj.phase = "protostar"; sj.radius = 0.5; }
        if (sj.phase === "protostar" && sj.mass >= MASS_MAIN) { sj.phase = "mainSequence"; sj.radius = 0.75; sj.isPermanent = true; }
        if (sj.phase === "mainSequence" && sj.mass >= MASS_GIANT) { sj.phase = "redGiant"; sj.radius = 1.5; }


        stars.splice(i, 1);
        changed = true;
        console.log(`%c[합체!] ${si.phase}+${sj.phase} → ${sj.phase} (mass ${totalMass.toFixed(0)})`, "color:#fbbf24;font-weight:bold");
        break;
      }
    }

    if (changed) {
      try {
        const perm = stars.filter(s => s.isPermanent);
        localStorage.setItem("anthropocene:stars:v1", JSON.stringify(perm));
      } catch { }
      onStarsUpdate?.(stars);
    }

    // ── 7. StarBody 버퍼 업데이트 ────────────────────────────────
    const nS = Math.min(stars.length, MAX_STARS);
    for (let si = 0; si < nS; si++) {
      const s = stars[si];
      sPosBuf[si * 3] = s.x; sPosBuf[si * 3 + 1] = s.y; sPosBuf[si * 3 + 2] = s.z;
      sPhaseAgeBuf[si] = s.phaseAge;
      sPhsBuf[si] = s.phase === "nebula" ? 0
        : s.phase === "protostar" ? 1
          : s.phase === "mainSequence" ? 2
              : s.phase === "redGiant" ? 3
              : s.phase === "supernova" ? 4
              : /* remnant */             5;

      sMasBuf[si] = s.mass;
    }
    for (let si = nS; si < MAX_STARS; si++) sPosBuf[si * 3 + 1] = -9999;

    if (sGeoRef.current) {
      (sGeoRef.current.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
      (sGeoRef.current.getAttribute("aPhase") as THREE.BufferAttribute).needsUpdate = true;
      (sGeoRef.current.getAttribute("aMass") as THREE.BufferAttribute).needsUpdate = true;
      (sGeoRef.current.getAttribute("aPhaseAge") as THREE.BufferAttribute).needsUpdate = true;
    }
  });



  return (
    <>
      {/* GPGPU 파티클 container */}
      <group ref={ptsGroupRef} />

      {/* CPU StarBody */}
      <points frustumCulled={false}>
        <bufferGeometry ref={sGeoRef}>
          <bufferAttribute attach="attributes-position" array={sPosBuf} itemSize={3} count={MAX_STARS} />
          <bufferAttribute attach="attributes-aPhase" array={sPhsBuf} itemSize={1} count={MAX_STARS} />
          <bufferAttribute attach="attributes-aMass" array={sMasBuf} itemSize={1} count={MAX_STARS} />
          <bufferAttribute attach="attributes-aPhaseAge" array={sPhaseAgeBuf} itemSize={1} count={MAX_STARS} />
        </bufferGeometry>
        <shaderMaterial
          vertexShader={STAR_VS}
          fragmentShader={STAR_FS}
          uniforms={{ uTime: sTimeUni, uStarScale: sStarScaleUni }}
          transparent depthWrite={false} blending={THREE.AdditiveBlending}
        />
      </points>
    </>
  );
}
