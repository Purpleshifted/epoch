"use client";

/**
 * side/SideView.tsx — 시공간 단층 기둥
 *
 * - 공통 훅 useSpacetimeStars, useSessionAngle 사용
 * - creatorAngle에 따라 각 별의 stratum 기울기 다름
 *   → 특수상대성이론: 서로 다른 관측자의 동시성 평면이 겹쳐 보임
 * - now = 화면 아래, 과거 = 위
 * - Y축 기준으로 천천히 회전 (기둥)
 * - 별은 매 프레임 위로 이동 (uTimeDelta)
 */

import { useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect } from "react";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import * as THREE from "three";
import { useRouter } from "next/navigation";
import { useSpacetimeStarsWithRef } from "@/components/spacetime/useSpacetimeStars";
import type { StarBody } from "@/components/spacetime/types";

// ──────────────────────────────────────────────────────────────
const AGE_SCALE   = 0.045;
const STRATA_STEP = 45;
const ROT_SPEED   = 0.004;
const COL_HALF    = 14;
// 동시성 평면 기울기 스케일 (0 → 기울기 없음, 클수록 뚜렷)
const TILT_SCALE  = 0.06;

// ──────────────────────────────────────────────────────────────
// 셰이더: uTimeDelta로 실시간 위로 이동 + creatorAngle 기울기
// ──────────────────────────────────────────────────────────────
const STAR_VS = /* glsl */`
  attribute float aPhase;
  attribute float aMass;
  attribute float aOffset;
  attribute float aAge;
  attribute float aCreatorTilt; // sin(creatorAngle) × TILT_SCALE → X기반 Y오프셋
  uniform   float uTime;
  uniform   float uTimeDelta;
  varying   vec3  vColor;
  varying   float vAlpha;

  vec3 kelvinToRGB(float K) {
    float t = clamp(K,1000.0,40000.0)/100.0;
    vec3 c;
    c.r = t<=66.0?1.0:clamp(329.6987*pow(t-60.0,-0.1332)/255.0,0.0,1.0);
    c.g = t<=66.0?clamp((99.4708*log(t)-161.1195)/255.0,0.0,1.0)
                 :clamp(288.1221*pow(t-60.0,-0.0755)/255.0,0.0,1.0);
    c.b = t>=66.0?1.0:t<=19.0?0.0:clamp((138.5177*log(t-10.0)-305.0447)/255.0,0.0,1.0);
    return c;
  }

  void main() {
    vec3 col;
    if (aPhase < 0.5) {
      float ms=max(aMass/180.0,0.01);
      float L=pow(ms,3.5),R=pow(ms,0.7),T=5778.0*pow(L/(R*R),0.25);
      col=kelvinToRGB(clamp(T,4000.0,40000.0));
      col=clamp(mix(vec3(dot(col,vec3(0.299,0.587,0.114))),col,2.2),0.0,1.0);
    } else if(aPhase<1.5){col=vec3(1.0,0.42,0.1);}
    else if(aPhase<2.5){col=vec3(0.75,0.88,1.0);}
    else{col=vec3(1.0,0.85,0.35);}
    vColor=col;

    float currentAge = aAge + uTimeDelta;
    // creatorAngle 기울기: 같은 관측자의 별들은 X에 비례해 Y도 달라짐
    float yTilt = position.x * aCreatorTilt;
    float yPos  = currentAge * ${AGE_SCALE.toFixed(4)} + yTilt;

    vec4 mv = modelViewMatrix * vec4(position.x, yPos, position.z, 1.0);
    vAlpha  = clamp((mv.z + ${200 + COL_HALF + 2}.0) / ${(COL_HALF * 2 + 4).toFixed(1)}, 0.05, 1.0);

    float pulse  = 0.84 + 0.16*sin(uTime*2.2+aOffset);
    gl_PointSize = clamp((4.0+pow(max(aMass,1.0),0.38)*5.0)*pulse, 2.0, 40.0);
    gl_Position  = projectionMatrix * mv;
  }
`;

const STAR_FS = /* glsl */`
  precision highp float;
  varying vec3 vColor; varying float vAlpha;
  void main(){
    vec2 uv=gl_PointCoord-0.5; float d=length(uv);
    if(d>0.5)discard;
    gl_FragColor=vec4(vColor,(exp(-d*d*10.0)+exp(-d*d*2.5)*0.4)*vAlpha);
  }
`;

// ──────────────────────────────────────────────────────────────
// Stratum 수평선 (회전 밖)
// ──────────────────────────────────────────────────────────────
function StratumLines({ halfW, maxAge }: { halfW: number; maxAge: number }) {
  const geo = (() => {
    const g = new THREE.BufferGeometry();
    const pts: number[] = [];
    for (let i = 0; i <= Math.ceil(maxAge / STRATA_STEP) + 2; i++) {
      const y = i * STRATA_STEP * AGE_SCALE;
      pts.push(-halfW * 1.6, y, 0,  halfW * 1.6, y, 0);
    }
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return g;
  })();
  return (
    <lineSegments geometry={geo}>
      <lineBasicMaterial color="#0c1840" transparent opacity={0.5} />
    </lineSegments>
  );
}

// ──────────────────────────────────────────────────────────────
// 수직 기둥선 (회전 안)
// ──────────────────────────────────────────────────────────────
function StarPillars({ stars }: { stars: StarBody[] }) {
  const pts: number[] = [], col: number[] = [];
  stars.forEach((s) => {
    const tilt  = Math.sin(s.creatorAngle ?? 0) * TILT_SCALE;
    const yTop  = s.age * AGE_SCALE + s.x * tilt;
    let r=1,g=0.8,b=0.4;
    if(s.phase==="redGiant")  {r=1;g=0.4;b=0.1;}
    if(s.phase==="remnant")   {r=0.7;g=0.85;b=1.0;}
    pts.push(s.x,0,s.z, s.x,yTop,s.z);
    col.push(r*0.5,g*0.5,b*0.5, r*0.08,g*0.08,b*0.08);
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  geo.setAttribute("color",    new THREE.Float32BufferAttribute(col, 3));
  return (
    <lineSegments geometry={geo}>
      <lineBasicMaterial vertexColors transparent opacity={0.38} depthWrite={false} />
    </lineSegments>
  );
}

// ──────────────────────────────────────────────────────────────
// 별 포인트
// ──────────────────────────────────────────────────────────────
function StarPoints({ stars, pollTimeRef }: { stars: StarBody[]; pollTimeRef: React.RefObject<number> }) {
  const matRef = useRef<THREE.ShaderMaterial>(null);
  const n = stars.length;
  const pos   = new Float32Array(n * 3);
  const ph    = new Float32Array(n);
  const ma    = new Float32Array(n);
  const ag    = new Float32Array(n);
  const off   = new Float32Array(n);
  const tilts = new Float32Array(n);

  stars.forEach((s, i) => {
    pos[i*3]=s.x; pos[i*3+1]=0; pos[i*3+2]=s.z;
    ph[i]     = s.phase==="mainSequence"?0:s.phase==="redGiant"?1:s.phase==="remnant"?2:3;
    ma[i]     = s.mass;
    ag[i]     = s.age;
    off[i]    = ((s.x*13.7+s.z*7.3)%(Math.PI*2)+Math.PI*2)%(Math.PI*2);
    tilts[i]  = Math.sin(s.creatorAngle ?? 0) * TILT_SCALE;
  });

  useFrame((_,dt) => {
    if(!matRef.current) return;
    matRef.current.uniforms.uTime.value      += dt;
    matRef.current.uniforms.uTimeDelta.value  = (Date.now()-pollTimeRef.current)/1000;
  });

  if(!n) return null;
  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position"     array={pos}   itemSize={3} count={n}/>
        <bufferAttribute attach="attributes-aPhase"       array={ph}    itemSize={1} count={n}/>
        <bufferAttribute attach="attributes-aMass"        array={ma}    itemSize={1} count={n}/>
        <bufferAttribute attach="attributes-aAge"         array={ag}    itemSize={1} count={n}/>
        <bufferAttribute attach="attributes-aOffset"      array={off}   itemSize={1} count={n}/>
        <bufferAttribute attach="attributes-aCreatorTilt" array={tilts} itemSize={1} count={n}/>
      </bufferGeometry>
      <shaderMaterial
        ref={matRef}
        vertexShader={STAR_VS}
        fragmentShader={STAR_FS}
        uniforms={{ uTime:{value:0}, uTimeDelta:{value:0} }}
        transparent depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

// ──────────────────────────────────────────────────────────────
// Camera
// ──────────────────────────────────────────────────────────────
function FillCamera({ stars }: { stars: StarBody[] }) {
  const { camera, size } = useThree();
  useEffect(() => {
    const cam = camera as THREE.OrthographicCamera;
    if (!cam.isOrthographicCamera) return;
    const aspect  = size.width / size.height;
    const radii   = stars.map(s=>Math.sqrt(s.x*s.x+s.z*s.z));
    const colHalf = Math.max(COL_HALF, ...radii) * 1.05;
    const maxAge  = Math.max(60, ...stars.map(s=>s.age));
    const colH    = maxAge * AGE_SCALE;
    const halfW   = Math.max(colHalf, colH*0.5*aspect) * 1.02;
    const halfH   = halfW / aspect;
    const midY    = colH * 0.5;
    cam.left=-halfW; cam.right=halfW;
    cam.bottom=midY-halfH; cam.top=midY+halfH;
    cam.near=0.1; cam.far=1000;
    cam.position.set(0,midY,200);
    cam.lookAt(0,midY,0);
    cam.updateProjectionMatrix();
  }, [camera, size, stars]);
  return null;
}

// ──────────────────────────────────────────────────────────────
// Scene
// ──────────────────────────────────────────────────────────────
function Scene({ stars, pollTimeRef }: { stars: StarBody[]; pollTimeRef: React.RefObject<number> }) {
  const colRef = useRef<THREE.Group>(null);
  const maxAge = Math.max(60, ...stars.map(s=>s.age));
  const radii  = stars.map(s=>Math.sqrt(s.x*s.x+s.z*s.z));
  const halfW  = Math.max(COL_HALF, ...radii) * 1.1;

  useFrame((_,dt)=>{ if(colRef.current) colRef.current.rotation.y += ROT_SPEED*dt; });

  return (
    <>
      <FillCamera stars={stars} />
      <StratumLines halfW={halfW} maxAge={maxAge+STRATA_STEP*2} />
      <group ref={colRef}>
        <StarPillars stars={stars} />
        <StarPoints  stars={stars} pollTimeRef={pollTimeRef} />
      </group>
      <EffectComposer>
        <Bloom intensity={2.2} luminanceThreshold={0.03} luminanceSmoothing={0.85} radius={1.0} />
      </EffectComposer>
    </>
  );
}

// ──────────────────────────────────────────────────────────────
export default function SideView() {
  const router = useRouter();
  const { stars, pollTimeRef } = useSpacetimeStarsWithRef();

  return (
    <div className="relative h-screen w-full bg-black overflow-hidden">
      <Canvas orthographic
        gl={{ antialias:true, alpha:false }}
        style={{ width:"100%", height:"100%", display:"block", background:"#000" }}
      >
        <Scene stars={stars} pollTimeRef={pollTimeRef} />
      </Canvas>
      {stars.length===0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-white/20 text-sm font-light tracking-wider">
            탐험을 시작하면 시공간 기둥이 형성됩니다
          </div>
        </div>
      )}
      <button
        className="absolute bottom-5 left-5 text-white/25 text-xs border border-white/10 px-3 py-1.5 rounded hover:text-white/50 transition-colors"
        onClick={()=>router.push("/")}
      >←</button>
    </div>
  );
}
