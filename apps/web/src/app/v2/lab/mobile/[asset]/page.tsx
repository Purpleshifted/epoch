"use client";

/**
 * /v2/lab/mobile/<asset> (/lab/mobile/<asset>) — one page of the mobile view lab: scan-future, scan-present,
 * bot-present, bot-future, or preview (components/parliament/MobileLabStage.tsx, mobileLab.ts).
 */
import { useParams } from "next/navigation";
import Link from "next/link";
import MobileLabStage from "@/components/parliament/MobileLabStage";
import { LAB_INFO, type LabPage } from "@/components/parliament/mobileLab";

export default function MobileLabAssetPage() {
  const { asset } = useParams<{ asset: string }>();
  if (!(asset in LAB_INFO)) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#0a0a0a] font-mono text-[11px] text-white/60">
        <Link href="/lab/mobile">no such page — back to the mobile view lab</Link>
      </div>
    );
  }
  return <MobileLabStage page={asset as LabPage} />;
}
