import { redirectKeepingQuery } from "@/lib/routeRedirect";

/** /lab/mobile — the mobile view lab (components/intro/MobileLabIndex.tsx): its page under /v2 (the personal view's version). */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await redirectKeepingQuery("/v2/lab/mobile", searchParams);
}
