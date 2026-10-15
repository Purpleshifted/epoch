import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // 프로덕션 단일 컨테이너 배포를 위한 standalone 출력
  output: "standalone",
  // nginx가 basePath 처리하므로 제거
  basePath: "",
  // trailing slash 비활성화
  trailingSlash: false,

  env: {
    NEXT_PUBLIC_ENABLE_PROFILER_IN_DEV: "false",
    // sound: the NoiseCraft patch files of THIS app (the /noisecraft/* routes), whatever the server's cwd is
    NOISECRAFT_EXAMPLES_DIR: path.join(import.meta.dirname, "noisecraft", "examples"),
  },
};

export default nextConfig;
