import StartScreen from "@/components/intro/StartScreen";
import Link from "next/link";

/** The version before the parliament-of-things build (kept as it was, for the meeting). */
export default function LegacyHomePage() {
  return (
    <div className="relative flex min-h-screen items-center justify-center bg-[#0a0a0a] px-12 py-32 text-white sm:px-24 lg:px-48">
      <Link href="/" className="absolute left-6 top-6 font-mono text-[11px] tracking-wider text-white/30 hover:text-white/70">
        ← home
      </Link>
      <div className="relative z-10 w-full max-w-2xl">
        <StartScreen base="/legacy" />
      </div>
    </div>
  );
}
