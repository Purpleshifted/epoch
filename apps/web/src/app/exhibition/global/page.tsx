import { redirectKeepingQuery } from "@/lib/routeRedirect";

/**
 * /exhibition/global — the wall: the 3D timespace with no panel, no text and no cursor. The home page opens it in a
 * window of its own (for the second display). It lands on /v2/global/space, so the Leva values saved while rehearsing
 * there (levaSave.ts keys them by that path) are the ones the wall loads.
 */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await redirectKeepingQuery("/v2/global/space?ui=0", searchParams);
}
