import { redirectKeepingQuery } from "@/lib/routeRedirect";

/**
 * /rehearsal/future — the layer above the column alone, live, with Leva: the wall's page on the shared world, drawing
 * only what is found after the people are gone (lib/parliament/futureOnly.ts). For tuning that layer's look without
 * the column's load on the screen.
 */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await redirectKeepingQuery("/v2/global/space?only=future", searchParams);
}
