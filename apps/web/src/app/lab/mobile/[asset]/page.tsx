import { redirectKeepingQuery } from "@/lib/routeRedirect";

/** /lab/mobile/<asset> — one page of the mobile view lab (components/parliament/MobileLabStage.tsx), under /v2. */
export default async function Page({ params, searchParams }: { params: Promise<{ asset: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { asset } = await params;
  await redirectKeepingQuery(`/v2/lab/mobile/${encodeURIComponent(asset)}`, searchParams);
}
