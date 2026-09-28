import type { NoiseCraftParam } from "@/lib/audio/noiseCraftCore";
export type {
  NoiseCraftParam,
  PersonalAudioMetrics,
} from "@/lib/audio/noiseCraftCore";
export { buildNoiseCraftParams } from "@/lib/audio/noiseCraftCore";

export const postNoiseCraftParams = (
  iframe: HTMLIFrameElement | null,
  origin: string | null,
  params: NoiseCraftParam[]
) => {
  if (!iframe || !params.length) return;
  if (process.env.NODE_ENV === "development") {
    // 디버그용: iframe으로 전송되는 파라미터 확인
    // eslint-disable-next-line no-console
    // console.log("[NoiseCraft] postParams", { origin, params });
  }
  // 개발 중에는 로컬/다른 포트(IP)로 접속하는 경우가 많아서
  // origin 불일치로 인한 경고를 피하기 위해 targetOrigin을 완화
  const targetOrigin =
    process.env.NODE_ENV === "development" ? "*" : origin || "*";
  iframe.contentWindow?.postMessage(
    { type: "noiseCraft:setParams", params },
    targetOrigin
  );
};

export const resolveNoiseCraftEmbed = () => {
  if (typeof window === "undefined") {
    return { src: "about:blank", origin: null };
  }
  const isDev = process.env.NODE_ENV === "development";
  const pageOrigin = window.location.origin;
  const pageUrl = new URL(pageOrigin);
  const replaceLocalhostHost = (raw: string, defaultPort: string) => {
    try {
      const url = new URL(raw, pageOrigin);
      if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
        const protocol = pageUrl.protocol;
        const port = url.port || defaultPort;
        const path = url.pathname || "/";
        const hostPart = port
          ? `${pageUrl.hostname}:${port}`
          : pageUrl.hostname;
        return `${protocol}//${hostPart}${path}`;
      }
      return url.toString();
    } catch {
      return raw;
    }
  };

  const rawNcEnv =
    process.env.NEXT_PUBLIC_NOISECRAFT_WS_URL ||
    (isDev ? "http://localhost:4000" : "/audiocraft");
  const rawRtEnv =
    process.env.NEXT_PUBLIC_WS_URL ||
    (isDev ? "http://localhost:3001/socket" : "/socket");

  // 개발 환경에서 localhost/127.0.0.1이 설정된 경우,
  // 현재 접속 호스트(IP/도메인) 기준으로 다시 작성
  const ncEnv = replaceLocalhostHost(rawNcEnv, "4000");
  const rtEnv = replaceLocalhostHost(rawRtEnv, "3001");

  const ncBase = ncEnv.startsWith("/") ? `${pageOrigin}${ncEnv}` : ncEnv;
  const rtUrl = rtEnv.startsWith("/") ? `${pageOrigin}${rtEnv}` : rtEnv;
  const normalizedNcBase = ncBase.replace(/\/$/, "");
  const normalizePatchSrc = (raw: string) => {
    if (/^https?:\/\//i.test(raw)) return raw;
    if (raw.startsWith("/")) {
      return `${normalizedNcBase}${raw}`;
    }
    return `${normalizedNcBase}/${raw}`;
  };
  const patchSrcEnv =
    process.env.NEXT_PUBLIC_NOISECRAFT_PATCH_SRC?.trim() || "";
  const patchProjectId =
    process.env.NEXT_PUBLIC_NOISECRAFT_PATCH_PROJECT_ID?.trim() || "";
  const embedSearch = new URLSearchParams();
  embedSearch.set("io", rtUrl);
  if (patchSrcEnv) {
    embedSearch.set("src", normalizePatchSrc(patchSrcEnv));
  } else if (patchProjectId) {
    embedSearch.set("project", patchProjectId);
  } else {
    embedSearch.set("src", `${normalizedNcBase}/current-project`);
  }
  // /mobile 과 /mobile/debug 에서 iframe 모드를 구분하기 위한 view 쿼리
  const path = window.location.pathname || "";
  if (path.startsWith("/mobile/debug")) {
    embedSearch.set("view", "mobile-debug");
    // /mobile/debug에서는 NoiseCraft 전체 패널을 보이도록 강제
    embedSearch.set("editor", "full");
  } else if (path.startsWith("/mobile")) {
    embedSearch.set("view", "mobile");
  }
  const src = `${normalizedNcBase}/public/embedded.html?${embedSearch.toString()}`;
  const embedOrigin = new URL(src, pageOrigin).origin;
  return { src, origin: embedOrigin };
};
