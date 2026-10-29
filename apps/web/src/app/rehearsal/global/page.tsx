import { redirectKeepingQuery } from "@/lib/routeRedirect";

/**
 * /rehearsal/global — the wall with Leva, for tuning. Same page as /exhibition/global (/v2/global/space), so what is
 * saved here is what the exhibition loads.
 */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await redirectKeepingQuery("/v2/global/space", searchParams);
}
