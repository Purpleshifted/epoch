import { redirectKeepingQuery } from "@/lib/routeRedirect";

/**
 * /rehearsal/experiment — the redesigned personal view (the mobile view lab's look, every asset as saved there), beside
 * the exhibition's for comparing (the artist, 2026-11-27: "rehearsal 밑에 experiment 추가해서 거기서 개편 개인뷰 보이게").
 * The same page as /rehearsal/personal (/v2/mobile), in the same world on the same server; only ?experiment=1 differs
 * (components/parliament/mobileLab.ts newLook).
 */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await redirectKeepingQuery("/v2/mobile?experiment=1", searchParams);
}
