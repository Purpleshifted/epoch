import { redirectKeepingQuery } from "@/lib/routeRedirect";

/**
 * /rehearsal/personal — the player view with Leva, for tuning. Same page as /exhibition/personal (/v2/mobile), so what
 * is saved here is what the visitor gets.
 */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await redirectKeepingQuery("/v2/mobile", searchParams);
}
