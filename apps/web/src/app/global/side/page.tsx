import Link from "next/link";

/** Side view of the parliament build: not built yet (the legacy side view reads the old stratum data). */
export default function SidePage() {
  return (
    <div className="flex h-screen w-full flex-col items-center justify-center gap-4 bg-[#05060a] font-mono text-[11px] tracking-wider text-white/30">
      <p>side view — next</p>
      <Link href="/" className="text-white/40 hover:text-white/70">← home</Link>
    </div>
  );
}
