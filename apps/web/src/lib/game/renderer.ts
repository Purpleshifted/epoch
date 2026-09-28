import type { GameState, Vec2 } from "@/types/game";

type ProjectionMode = "plane" | "lines";

interface RenderParams {
  ctx: CanvasRenderingContext2D;
  state: GameState;
  width: number;
  height: number;
  projection?: ProjectionMode;
  transition?: {
    from: ProjectionMode;
    to: ProjectionMode;
    progress: number;
  } | null;
}

let backgroundPattern: CanvasPattern | null = null;

const getBackgroundPattern = (ctx: CanvasRenderingContext2D) => {
  if (backgroundPattern) return backgroundPattern;
  if (typeof document === "undefined") return null;
  const noiseCanvas = document.createElement("canvas");
  noiseCanvas.width = 128;
  noiseCanvas.height = 128;
  const noiseCtx = noiseCanvas.getContext("2d");
  if (!noiseCtx) return null;
  // 짙은 회색 바탕
  noiseCtx.fillStyle = "#05060b";
  noiseCtx.fillRect(0, 0, noiseCanvas.width, noiseCanvas.height);
  // 고정 질감용 노이즈 점
  const dotCount = 400;
  for (let i = 0; i < dotCount; i += 1) {
    const x = Math.random() * noiseCanvas.width;
    const y = Math.random() * noiseCanvas.height;
    const alpha = 0.05 + Math.random() * 0.08;
    noiseCtx.fillStyle = `rgba(255,255,255,${alpha})`;
    noiseCtx.fillRect(x, y, 1, 1);
  }
  backgroundPattern = ctx.createPattern(noiseCanvas, "repeat");
  return backgroundPattern;
};

const project = (
  state: GameState,
  width: number,
  height: number,
  position: Vec2,
  overrides?: { cameraPosition?: Vec2; zoom?: number }
) => {
  const cameraPos = overrides?.cameraPosition ?? state.camera.position;
  const zoom = overrides?.zoom ?? state.camera.zoom;
  return {
    x: (position.x - cameraPos.x) * zoom + width / 2,
    y: (position.y - cameraPos.y) * zoom + height / 2,
  };
};

export const clearScene = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
) => {
  // 캔버스를 투명하게 지워서, 뒤에 깔린 페이지 배경(이미지 등)이 보이도록 함
  ctx.clearRect(0, 0, width, height);
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const computeBlend = (
  projection: ProjectionMode,
  transition?: {
    from: ProjectionMode;
    to: ProjectionMode;
    progress: number;
  } | null
) => {
  if (!transition) {
    return projection === "lines" ? 1 : 0;
  }
  if (transition.to === "lines") {
    return clamp01(transition.progress);
  }
  return clamp01(1 - transition.progress);
};

// 개선된 노이즈 함수 (더 역동적인 움직임)
const simpleNoise = (x: number, y: number, t: number): number => {
  return (
    Math.sin(x * 0.5 + t) * 0.5 +
    Math.cos(y * 0.5 + t * 0.7) * 0.3 +
    Math.sin((x + y) * 0.3 + t * 1.2) * 0.2
  );
};

// 3D 위치를 위한 노이즈 (Z-depth 시뮬레이션)
const noise3D = (x: number, y: number, z: number, t: number): number => {
  return (
    Math.sin(x * 0.4 + t * 0.8) * 0.4 +
    Math.cos(y * 0.4 + t * 0.6) * 0.3 +
    Math.sin(z * 0.3 + t * 1.0) * 0.2 +
    Math.sin((x + y + z) * 0.2 + t * 1.5) * 0.1
  );
};

// 시드 기반 랜덤 함수 (일관된 값 생성)
const seededRandom = (seed: number) => {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
};

// 파도처럼 출렁이는 파티클 클러스터 렌더링 (유기적으로 연결된 느낌)
const renderParticleCluster = (
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  baseSize: number,
  alpha: number,
  time: number,
  seed: number
) => {
  // 파도처럼 보이도록 더 많은 서브 파티클과 더 큰 클러스터 (유기적 연결)
  const subParticleCount = 12 + Math.floor(seededRandom(seed * 3.7) * 16); // 12-28개 (더 많게)
  const clusterRadius = baseSize * (0.6 + seededRandom(seed * 2.1) * 0.8); // 더 큰 클러스터 (겹치게)
  
  for (let j = 0; j < subParticleCount; j++) {
    const subAngle = (j / subParticleCount) * Math.PI * 2;
    const subRadius = clusterRadius * (0.15 + seededRandom(seed * 5.1 + j) * 0.85);
    
    // 파도처럼 출렁이는 움직임 (유기적으로 연결된 느낌)
    const waveX = simpleNoise(centerX * 0.012 + time * 0.9, seed + j, time * 0.7);
    const waveY = simpleNoise(centerY * 0.012 + time * 0.9, seed + j + 100, time * 0.7);
    const moveAmount = baseSize * 0.3; // 더 큰 움직임 (파도처럼)
    
    const subX = centerX + Math.cos(subAngle) * subRadius + waveX * moveAmount;
    const subY = centerY + Math.sin(subAngle) * subRadius + waveY * moveAmount;
    
    // Z-depth 시뮬레이션 (앞뒤에 따라 크기와 밝기 변화)
    const zDepth = noise3D(centerX * 0.02, centerY * 0.02, seed + j, time * 0.3);
    const zFactor = (zDepth + 1) * 0.5; // 0~1로 정규화
    
    // 파도처럼 보이도록 더 큰 크기 (유기적으로 연결)
    const subSize = baseSize * 0.5 * (0.75 + zFactor * 0.25); // 크기 증가 (더 겹치게)
    const subAlpha = alpha * (0.85 + zFactor * 0.15); // 알파 증가
    
    // 서브 파티클 그리기
    ctx.beginPath();
    ctx.arc(subX, subY, subSize, 0, Math.PI * 2);
    // 단색 채우기 (그라데이션 제거)
    ctx.fillStyle = `rgba(255,255,255,${subAlpha})`;
    ctx.fill();
  }
};

// 파티클 기반 공 렌더링 (중력 반영 버전: 비주얼 변화 강조)
const renderParticleBall = (
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  baseRadius: number,
  time: number,
  _velocity?: Vec2, // 속도 정보 (현재는 사용하지 않지만 시그니처 유지)
  gravityDir?: Vec2, // 서버에서 계산된 중력 방향 벡터
  gravityDist?: number, // 서버에서 계산된 가장 가까운 플레이어와의 거리
  particleScale = 1 // 파티클 크기 스케일 (글로벌 뷰용)
) => {
  // 중력 영향력 계산 (거리 기반만 사용 - 다른 플레이어가 있을 때만)
  // 거리 기반 중력 강도 (가까울수록 강함, 최대 거리 900 기준까지 서서히 반영)
  const hasGravity = gravityDist !== undefined && Number.isFinite(gravityDist);
  const maxVisualGravityDist = 900;
  const distGravityFactor =
    hasGravity && gravityDist! < maxVisualGravityDist
      ? Math.max(0, 1 - Math.min(gravityDist! / maxVisualGravityDist, 1))
      : 0;
  // 최종 중력 영향력 (0~1)
  const gravityInfluence = distGravityFactor;

  // 중력 방향 계산 (이미 서버에서 계산된 벡터를 사용)
  let gravityDirX = 0;
  let gravityDirY = 0;
  if (gravityDir) {
    const mag = Math.hypot(gravityDir.x, gravityDir.y);
    if (mag > 0.0001) {
      gravityDirX = gravityDir.x / mag;
      gravityDirY = gravityDir.y / mag;
    }
  }
  // 단일 레이어, 고정된 작은 점들로만 구 형태를 표현
  const adjustedRadius = baseRadius * 1.55;
  const particleCount = 260;
  const hasGravDir = gravityInfluence > 0 && (gravityDirX !== 0 || gravityDirY !== 0);
  const gravAngle = hasGravDir ? Math.atan2(gravityDirY, gravityDirX) : 0;

  for (let i = 0; i < particleCount; i += 1) {
    // 기본 위치는 시드 기반 고정 분포
    const u1 = seededRandom(i * 17.3);
    const u2 = seededRandom(i * 31.7);

    const angle = u1 * Math.PI * 2;
    // 가장자리에 점이 더 많이 모이도록, 기본 분포 자체를 가장자리 편향으로
    const edgeBias = Math.pow(u2, 0.2); // 지수 < 1 → 1 근처에 밀도
    const baseRadiusFactor = 1 * edgeBias; // 안쪽은 비우고, 0.6~1.0 범위에 분포

    // 중력 방향과의 정렬 정도 (1이면 중력 방향, 0이면 반대편)
    const rawAlign =
      hasGravDir && Number.isFinite(gravAngle)
        ? Math.max(0, Math.cos(angle - gravAngle))
        : 0;
    // 중력 방향 근처만 더 강하게, 나머지는 완만하게
    const alignment = Math.pow(rawAlign, 1.6);

    // 반경은 기본적으로 구 형태를 유지하되,
    // 중력 방향 쪽에서만 조금 더 바깥으로 밀어줌
    const radialBoost = 0.35 * gravityInfluence * alignment;
    const radiusFactor = baseRadiusFactor * (0.9 + radialBoost);
    const radius = adjustedRadius * radiusFactor;

    // 중력 방향으로의 오프셋 (쏠리는 느낌) — 기본 형태는 유지
    const driftAmount = 0.22 * gravityInfluence * alignment * adjustedRadius;
    const driftX = hasGravDir ? gravityDirX * driftAmount : 0;
    const driftY = hasGravDir ? gravityDirY * driftAmount : 0;

    // 부드러운 시간 기반 흔들림 (미세한 움직임만)
    const wobbleSeedX = i * 13.7;
    const wobbleSeedY = i * 19.1;
    const wobbleR =
      0.15 *
      adjustedRadius *
      simpleNoise(wobbleSeedX * 0.3, wobbleSeedY * 0.3, time * 0.15);
    const wobbleAngle =
      2 *
      simpleNoise(wobbleSeedX * 0.5, wobbleSeedY * 0.5, time * 0.18);

    const finalRadius = Math.min(radius + wobbleR, radius);
    const finalAngle = angle + wobbleAngle;

    const x = centerX + Math.cos(finalAngle) * finalRadius + driftX;
    const y = centerY + Math.sin(finalAngle) * finalRadius + driftY;

    // 기본 밝기에 시간에 따른 잔잔한 반짝임 + 중력 방향 강조
    const baseAlpha = 0.55;
    const flicker =
      0.6 *
      simpleNoise(i * 0.7, 0.0, time * 0.1 * i); // -0.18 ~ 0.18
    const alphaBoost = 0.7 * gravityInfluence * alignment;
    const alpha = Math.max(
      0.2,
      Math.min(1, baseAlpha + flicker + alphaBoost)
    );

    // 더 작고 선명한 점 (최소 크기와 스케일을 낮춰서 모바일에서도 작게 보이도록)
    const size =
      Math.max(0.2, Math.min(0.5, baseRadius * 0.014)) * particleScale;

    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,255,255,${alpha})`;
    ctx.fill();
  }
};

const renderPlayers = ({
  ctx,
  state,
  width,
  height,
  blend,
  laneGap,
  orderIndex,
  overrides,
}: RenderParams & {
  blend: number;
  laneGap: number;
  orderIndex: Map<string, number>;
  overrides?: { cameraPosition?: Vec2; zoom?: number };
}) => {
  ctx.save();
  const time = performance.now() * 0.001; // 초 단위 시간 (파티클 애니메이션용)
  const isGlobal = state.mode === "global";
  const isPersonal = state.mode === "personal";

  // 개인 뷰: 최근 충돌 + 근접(중력 거리)까지 포함해서 "만남" 판정을 조금 더 관대하게
  const recentCollisionSelf =
    isPersonal &&
    state.selfId &&
    state.collisionMarks.some((mark) => {
      const age = Date.now() - mark.timestamp;
      return age < 800 && mark.players?.includes(state.selfId as string);
    });

  // 글로벌 뷰에서는 plane용 가이드 라인 숨김
  if (blend > 0.01 && !isGlobal) {
    ctx.strokeStyle = `rgba(255,255,255,${0.15 * blend})`;
    for (let i = 0; i < state.playerOrder.length; i += 1) {
      const laneY = laneGap * (i + 1);
      ctx.beginPath();
      ctx.moveTo(0, laneY);
      ctx.lineTo(width, laneY);
      ctx.stroke();
    }
  }

  state.playerOrder.forEach((playerId, index) => {
    const player = state.players[playerId];
    if (!player) return;
    if (isPersonal && !player.isSelf) {
      return;
    }
    const { cell, depth } = player;
    // dead-reckoning(속도 기반 추가 예측) 없이,
    // 현재 스냅샷(또는 보정된 서버 위치)만 기준으로 화면 좌표 계산
    const renderBasePosition = cell.position;
    const planePos = project(state, width, height, renderBasePosition, overrides);
    const idx = orderIndex.get(playerId) ?? index;
    const laneY = laneGap * (idx + 1);
    const lineX = (renderBasePosition.x / state.gameSize.width) * width;

    const screenPos = {
      x: planePos.x * (1 - blend) + lineX * blend,
      y: planePos.y * (1 - blend) + laneY * blend,
    };
    let radius = cell.radius * state.camera.zoom * (1 - blend) + 8 * blend;

    const isSelf = player.isSelf;
    let isMeetingSelf = false;
    if (isPersonal && isSelf) {
      const gravityClose =
        typeof player.gravityDist === "number" &&
        Number.isFinite(player.gravityDist) &&
        player.gravityDist < 100;
      isMeetingSelf = recentCollisionSelf || gravityClose;
      if (isMeetingSelf) {
        // 반경은 살짝만 펄스, 대신 밝기/글로우를 더 강조
        const pulse = 1 + 0.06 * (1 + Math.sin(time * 7));
        radius *= pulse;
      }
    }

    // 개인 뷰에서 자기 공에 파티클 효과 적용
    if (isPersonal && isSelf) {
      // 연결선이 공 내부에서 보이지 않도록, 공 뒤에 넓은 검은 그라데이션 배경을 깔아준다
      const bgRadius = radius * 5;
      const bgGradient = ctx.createRadialGradient(
        screenPos.x,
        screenPos.y,
        0,
        screenPos.x,
        screenPos.y,
        bgRadius
      );
      bgGradient.addColorStop(0, "rgba(0,0,0,0.95)");
      bgGradient.addColorStop(0.55, "rgba(0,0,0,0.7)");
      bgGradient.addColorStop(1, "rgba(0,0,0,0)");
      ctx.beginPath();
      ctx.arc(screenPos.x, screenPos.y, bgRadius, 0, Math.PI * 2);
      ctx.fillStyle = bgGradient;
      ctx.fill();

      renderParticleBall(
        ctx, 
        screenPos.x, 
        screenPos.y, 
        radius, 
        time,
        cell.velocity, // velocity 정보 전달
        player.gravityDir, // 서버에서 계산된 중력 방향
        player.gravityDist, // 서버에서 계산된 거리
        1
      );
    } else if (isGlobal) {
      // 글로벌 뷰에서는 모든 플레이어를 개인 뷰와 동일한 파티클 스타일로 렌더하되,
      // 파티클 크기만 조금 더 크게
      renderParticleBall(
        ctx,
        screenPos.x,
        screenPos.y,
        radius,
        time,
        cell.velocity,
        player.gravityDir,
        player.gravityDist,
        1.5
      );
    } else {
      // 기타 모드에서는 간단한 원으로 유지
      ctx.beginPath();
      ctx.arc(screenPos.x, screenPos.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = cell.color ?? "rgba(255,255,255,0.6)";
      ctx.fill();
    }

    // 깊이감 보조(옵션): z에 비례한 알파나 외곽선
    // 개인 뷰에서는 흰 원형 라인(외곽선)을 없애기 위해 depth 외곽선 스킵
    if (!isPersonal && typeof depth === "number" && blend < 0.8) {
      ctx.strokeStyle = `rgba(255,255,255,${Math.max(
        0.1,
        1 - Math.abs(depth) / 1000
      )})`;
      ctx.stroke();
    }

    // 개인 뷰에서는 자기 공 주변의 흰 링을 제거
    if (!isPersonal && player.isSelf && state.selfHighlightUntil > Date.now()) {
      const glow = (state.selfHighlightUntil - Date.now()) / 1200;
      ctx.beginPath();
      ctx.arc(screenPos.x, screenPos.y, radius + 20 * glow, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,255,255,${0.6 * glow})`;
      ctx.lineWidth = 4;
      ctx.stroke();
    }

    // 이름 라벨 렌더링:
    // - 개인 뷰에서는 이름을 표시하지 않음
    // - 글로벌 뷰에서도 plane/라인 라벨은 숨김
    if (!isPersonal && !isGlobal && blend > 0.3) {
      ctx.fillStyle = "rgba(255,255,255,0.8)";
      ctx.font = "12px Geist, sans-serif";
      ctx.textBaseline = "bottom";
      ctx.fillText(player.name || "-", screenPos.x + 12, screenPos.y - 10);
    }
  });
  ctx.restore();
};
const drawSpringLine = (
  ctx: CanvasRenderingContext2D,
  from: Vec2,
  to: Vec2,
  opts: {
    phase: number;
    amplitude: number;
    segments?: number;
    damping?: number;
    waves?: number;
  }
) => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 1) {
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    return;
  }
  const segments = opts.segments ?? 18;
  const damping = opts.damping ?? 2.4;
  const waves = opts.waves ?? 3.4;
  const nx = -dy / distance;
  const ny = dx / distance;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  for (let i = 1; i < segments; i += 1) {
    const t = i / segments;
    const sine = Math.sin(t * Math.PI * waves + opts.phase);
    const fade = Math.exp(-t * damping);
    const offset = opts.amplitude * sine * fade;
    ctx.lineTo(from.x + dx * t + nx * offset, from.y + dy * t + ny * offset);
  }
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
};
const computeSpringAmplitude = (args: {
  startedAt: number;
  lastEvent?: number;
  now: number;
}) => {
  const lastImpulse = args.lastEvent ?? args.startedAt ?? args.now;
  const sinceLast = Math.max(0, args.now - lastImpulse);
  const decay = Math.exp(-sinceLast / 1600);
  const idlePulse = 4 + 2 * Math.sin(args.now / 1000);
  return idlePulse + 24 * decay;
};
const renderCollisionConnections = ({
  ctx,
  state,
  width,
  height,
  blend,
  laneGap,
  orderIndex,
  overrides,
}: RenderParams & {
  blend: number;
  laneGap: number;
  orderIndex: Map<string, number>;
  overrides?: { cameraPosition?: Vec2; zoom?: number };
}) => {
  const selfId = state.selfId;
  ctx.save();
  const phase =
    typeof performance !== "undefined"
      ? performance.now() * 0.012
      : Date.now() * 0.012;
  const wallNow = Date.now();
  // 기본 선 스타일
  ctx.lineWidth = state.mode === "personal" ? 1.2 : 2.2;
  ctx.strokeStyle =
    state.mode === "personal"
      ? "rgba(255,255,255,0.4)"
      : "rgba(255,255,255,0.5)";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  // 그림자 효과 제거
  ctx.shadowColor = "rgba(0,0,0,0)";
  ctx.shadowBlur = 0;
  state.collisionLines.forEach((pair) => {
    if (state.mode === "personal" && selfId) {
      if (!pair.players.includes(selfId)) {
        return;
      }
    }
    const a = state.players[pair.players[0]];
    const b = state.players[pair.players[1]];
    if (!a || !b) return;
    const idxA = orderIndex.get(a.id) ?? 0;
    const idxB = orderIndex.get(b.id) ?? 0;
    const laneAy = laneGap * (idxA + 1);
    const laneBy = laneGap * (idxB + 1);
    const planeA = project(state, width, height, a.cell.position, overrides);
    const planeB = project(state, width, height, b.cell.position, overrides);
    const lineAx = (a.cell.position.x / state.gameSize.width) * width;
    const lineBx = (b.cell.position.x / state.gameSize.width) * width;
    const posA = {
      x: planeA.x * (1 - blend) + lineAx * blend,
      y: planeA.y * (1 - blend) + laneAy * blend,
    };
    const posB = {
      x: planeB.x * (1 - blend) + lineBx * blend,
      y: planeB.y * (1 - blend) + laneBy * blend,
    };
    if (state.mode === "personal") {
      // 개인 뷰: 스프링 대신 일직선 빛 기둥 느낌으로
      const dx = posB.x - posA.x;
      const dy = posB.y - posA.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;

      // self / 상대 방향 판정
      const isSelfA = selfId && a.id === selfId;
      const selfPos = isSelfA ? posA : posB;
      const otherPos = isSelfA ? posB : posA;

      // 부드러운 외곽 글로우 (단색 흰색 계열, 중앙 코어 라인 없이)
      const steps = 6;
      for (let i = 0; i < steps; i += 1) {
        const t = i / (steps - 1);
        const alpha = 0.18 * (1 - t);
        const width = 10 + 18 * t;
        const glowGrad = ctx.createLinearGradient(
          otherPos.x,
          otherPos.y,
          selfPos.x,
          selfPos.y
        );
        glowGrad.addColorStop(0, `rgba(255,255,255,${alpha})`);
        glowGrad.addColorStop(1, "rgba(255,255,255,0.0)");
        ctx.strokeStyle = glowGrad;
        ctx.lineWidth = width;
        ctx.beginPath();
        // 양 끝에서 약간 안쪽으로 들어와서 끝부분이 더 부드럽게
        const inset = 8 + 16 * t;
        const startX = otherPos.x - ux * inset;
        const startY = otherPos.y - uy * inset;
        const endX = selfPos.x + ux * inset;
        const endY = selfPos.y + uy * inset;
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
        ctx.stroke();
      }
    } else if (state.mode === "global") {
      // 글로벌 뷰: 모바일과 유사한 직선 빛줄기 표현 (양방향 대칭)
      const dx = posB.x - posA.x;
      const dy = posB.y - posA.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;

      const steps = 5;
      for (let i = 0; i < steps; i += 1) {
        const t = i / (steps - 1);
        const alpha = 0.16 * (1 - t);
        const width = 6 + 14 * t;
        ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
        ctx.lineWidth = width;
        ctx.beginPath();
        const inset = 6 + 14 * t;
        const startX = posA.x + ux * inset;
        const startY = posA.y + uy * inset;
        const endX = posB.x - ux * inset;
        const endY = posB.y - uy * inset;
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
        ctx.stroke();
      }
    } else {
      const amplitude = computeSpringAmplitude({
        startedAt: pair.startedAt,
        lastEvent: pair.lastEvent,
        now: wallNow,
      });
      drawSpringLine(ctx, posA, posB, {
        phase,
        amplitude,
        segments: 20,
        damping: 2.1,
        waves: 4,
      });
    }

    // 글로벌/기타 뷰에서만 연결선 끄트머리 작은 점을 그려서 강조
    if (state.mode !== "personal" && state.mode !== "global") {
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      const dotRadius = blend > 0.7 ? 4.5 : 6;
      ctx.beginPath();
      ctx.arc(posA.x, posA.y, dotRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(posB.x, posB.y, dotRadius, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  ctx.restore();
};

const renderCollisionMarks = ({
  ctx,
  state,
  width,
  height,
  blend,
  laneGap,
  orderIndex,
  overrides,
}: RenderParams & {
  blend: number;
  laneGap: number;
  orderIndex: Map<string, number>;
  overrides?: { cameraPosition?: Vec2; zoom?: number };
}) => {
  ctx.save();
  const now = Date.now();
  const DURATION = 100000; // 5분(300초) 동안 빛의 흔적 유지
  state.collisionMarks.forEach((mark) => {
    const age = (now - mark.timestamp) / DURATION;
    if (age >= 1) return;
    const planePos = project(state, width, height, mark.position, overrides);
    let laneY: number;
    if (mark.players && mark.players.length) {
      const indexes = mark.players
        .map((id) => orderIndex.get(id))
        .filter((idx) => idx !== undefined) as number[];
      if (indexes.length > 0) {
        laneY =
          laneGap *
          (indexes.reduce((sum, idx) => sum + (idx + 1), 0) / indexes.length);
      } else {
        laneY = (mark.position.y / state.gameSize.height) * height;
      }
    } else {
      laneY = (mark.position.y / state.gameSize.height) * height;
    }
    const lineX = (mark.position.x / state.gameSize.width) * width;
    const pos = {
      x: planePos.x * (1 - blend) + lineX * blend,
      y: planePos.y * (1 - blend) + laneY * blend,
    };
    const radius =
      mark.radius * (1 - blend) + Math.max(12, mark.radius * 0.2) * blend;
    const alpha = Math.max(0, 1 - age);
    // 단색 원으로 렌더링 (그라데이션 제거)
    ctx.fillStyle = `rgba(255,255,255,${0.5 * alpha})`;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();
};

const renderSelfTrail = ({
  ctx,
  state,
  width,
  height,
  overrides,
}: RenderParams & { overrides?: { cameraPosition?: Vec2; zoom?: number } }) => {
  if (!state.selfId) return;
  const trail = state.cellTrails[state.selfId];
  if (!trail || trail.points.length < 2) return;
  const selfPlayer = state.players[state.selfId];
  if (!selfPlayer) return;

  // 움직임 크기에 따라 트레일 강도 조절 (느리면 거의/완전히 사라지게)
  const speed = Math.hypot(
    selfPlayer.cell.velocity.x,
    selfPlayer.cell.velocity.y
  );
  const MIN_SPEED = 40; // 이보다 느리면 트레일 없음
  const FULL_SPEED = 200; // 이 이상이면 최대 강도
  const speedFactor = clamp01((speed - MIN_SPEED) / (FULL_SPEED - MIN_SPEED));
  if (speedFactor <= 0) {
    return;
  }

  const now = Date.now();
  const MAX_AGE = 7000; // ms (조금 더 오래 남도록)
  ctx.save();
  // 최근 포인트를 모아 메인 곡선을 만든 뒤,
  // 그 곡선을 기준으로 여러 가닥을 좌우로 퍼뜨려서 "갈라지는 트레일" 표현
  const recent: { x: number; y: number; life: number }[] = [];
  trail.points.forEach((point) => {
    const age = now - point.t;
    if (age > MAX_AGE) return;
    const life = 1 - age / MAX_AGE;
    if (life <= 0) return;
    const pos = project(
      state,
      width,
      height,
      { x: point.x, y: point.y },
      overrides
    );
    recent.push({ x: pos.x, y: pos.y, life });
  });

  if (recent.length >= 2) {
    // 각 포인트에서의 법선(normal) 계산
    const normals: { x: number; y: number }[] = [];
    for (let i = 0; i < recent.length; i += 1) {
      const a = recent[Math.max(0, i - 1)];
      const b = recent[Math.min(recent.length - 1, i + 1)];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      normals.push({ x: nx, y: ny });
    }

    // 여러 줄로 퍼지는 곡선: 중앙선 포함 좌우 라인 (3가닥만 사용)
    const strandOffsets = [-0.6, 0, 0.6];
    const baseSpread = Math.min(4, 30 * speedFactor);
    // 각 가닥마다 유효한 길이(최근 위치에서 얼마나 멀리까지 이어질지)를 다르게 설정
    const strandCutoffs = strandOffsets.map((offset, idx) => {
      // 중앙선은 가장 길게, 양 옆은 조금 더 짧게
      const t = Math.abs(offset) / Math.max(0.0001, Math.max(...strandOffsets.map(Math.abs)));
      return 0.02 + 0.18 * t; // 0.02 ~ 0.2
    });

    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    strandOffsets.forEach((offsetScale, idx) => {
      ctx.beginPath();
      for (let i = 0; i < recent.length; i += 1) {
        const p = recent[i];
        const n = normals[i];
        const t = i / (recent.length - 1);
        const cutoff = strandCutoffs[idx];
        // 꼬리 쪽(오래된 포인트)은 더 많이 벌어지고, 현재 위치 쪽은 모이게
        const diverge = (1 - p.life) * baseSpread * offsetScale;
        // 약간의 울렁거리는 느낌을 위해, 시간/라인/인덱스 기반 노이즈로 진동량을 섞어준다
        const noise = simpleNoise(
          i * 0.35 + idx * 1.1,
          idx * 0.6,
          now * 0.001
        );
        const wobble =
          (4 + 10 * noise) * (1 - t) * speedFactor; // 라인마다/구간마다 다른 크기의 흔들림
        const x = p.x + n.x * (diverge + wobble);
        const y = p.y + n.y * (diverge + wobble);
        // 이 가닥의 "보이는 구간" 내에서 0~1로 다시 정규화된 life
        const normLife = clamp01(
          (p.life - cutoff) / Math.max(0.0001, 1 - cutoff)
        );
        // 꼬리로 갈수록 normLife가 점점 0에 수렴하면서 알파도 자연스럽게 0까지 페이드아웃
        const alpha = 0.1 * t * normLife * speedFactor;
        const widthScale = 0.7 * normLife;
        ctx.lineWidth = (0.4 + 1.0 * t) * (0.4 + 0.6 * speedFactor) * widthScale;
        ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    });
  }
  ctx.restore();
};

export const renderHud = ({ ctx, state, width }: RenderParams) => {
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  ctx.font = "16px Geist, sans-serif";
  ctx.textBaseline = "top";
  ctx.fillText(`모드: ${state.mode}`, 16, 16);
  ctx.fillText(`인원: ${state.ui.population}`, 16, 40);
  ctx.textAlign = "right";
  ctx.fillText(state.ui.displayName || "-", width - 16, 16);
  ctx.restore();
};

export const renderScene = (params: RenderParams) => {
  const projection = params.projection ?? "plane";
  const blend = computeBlend(projection, params.transition);
  const laneGap =
    params.state.playerOrder.length > 0
      ? params.height / Math.max(1, params.state.playerOrder.length + 1)
      : params.height;
  const overlayWidth = params.state.mode === "global" ? 240 : 0;
  const orderIndex = new Map<string, number>();
  params.state.playerOrder.forEach((id, idx) => orderIndex.set(id, idx));

  clearScene(params.ctx, params.width, params.height);
  if (params.state.playing) {
    if (params.state.mode === "personal") {
      // 개인 뷰: 자기 궤적 + 자기 공 + 자기와 관련된 연결선만 표시
      // (충돌 마크의 큰 흰 원은 숨기고, 연결선 끄트머리 점도 숨김)
      renderCollisionConnections({
        ...params,
        blend,
        laneGap,
        orderIndex,
      });
      renderSelfTrail(params);
      renderPlayers({
        ...params,
        blend,
        laneGap,
        orderIndex,
      });
    } else if (params.state.mode === "global") {
      const zoom = Math.min(
        (params.width - overlayWidth) / params.state.gameSize.width,
        params.height / params.state.gameSize.height
      );
      const overrides = {
        cameraPosition: {
          x: params.state.gameSize.width / 2,
          y: params.state.gameSize.height / 2,
        },
        zoom,
      };
      renderCollisionMarks({
        ...params,
        blend,
        laneGap,
        orderIndex,
        overrides,
      });
      renderCollisionConnections({
        ...params,
        blend,
        laneGap,
        orderIndex,
        overrides,
      });
      renderPlayers({
        ...params,
        blend,
        laneGap,
        orderIndex,
        overrides,
      });
    } else {
      renderCollisionMarks({ ...params, blend, laneGap, orderIndex });
      renderCollisionConnections({ ...params, blend, laneGap, orderIndex });
      renderPlayers({ ...params, blend, laneGap, orderIndex });
    }
  }
  // renderHud(params);
};
