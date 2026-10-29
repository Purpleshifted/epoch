import { redirectKeepingQuery } from "@/lib/routeRedirect";

/**
 * /exhibition/personal — the visitor's screen: the player view with no panel, in Korean. It lands on /v2/mobile, so the
 * Leva values saved while rehearsing there (levaSave.ts keys them by that path) are the ones the visitor gets.
 */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await redirectKeepingQuery("/v2/mobile?ui=0&lang=ko", searchParams);
}
