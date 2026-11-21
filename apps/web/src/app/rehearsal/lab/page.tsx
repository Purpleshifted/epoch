import { redirectKeepingQuery } from "@/lib/routeRedirect";

/**
 * /rehearsal/lab — the visual lab: the wall's own component on the wall's world TAKEN ONCE (no bots, nothing built
 * after; useLabWorld.ts), with Leva, for turning the look's knobs on the same buildings. It saves into the same
 * folders as the wall (/v2/global/space), so what is tuned here is what the wall shows.
 */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await redirectKeepingQuery("/v2/global/lab", searchParams);
}
