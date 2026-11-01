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
    // sound: the NoiseCraft patch files of THIS app (the /noisecraft/* routes), whatever the server's cwd is — never
    // another worktree's folder. Real files under public/ (served at /noisecraft/examples/*): a symlink there broke the
    // Vercel build (ENOENT mkdir /vercel/output/static/noisecraft, 2026-10-20)
    NOISECRAFT_EXAMPLES_DIR: path.join(import.meta.dirname, "public", "noisecraft", "examples"),
  },
  // ONE three.js: drei re-exports StatsGl, whose stats-gl package carries its own three@0.170 — two copies in the
  // bundle. We never use StatsGl, so stats-gl resolves to a do-nothing stand-in (src/lib/stubs/stats-gl.ts).
  // Turbopack only: Next 16 refuses a Turbopack build when a webpack() override exists.
  turbopack: {
    resolveAlias: {
      "stats-gl": "./src/lib/stubs/stats-gl.ts",
    },
  },
  // the patch list on a deployment reads the files from the function's own bundle
  outputFileTracingIncludes: {
    "/noisecraft/list-patches": ["./public/noisecraft/examples/**"],
  },
};

export default nextConfig;
