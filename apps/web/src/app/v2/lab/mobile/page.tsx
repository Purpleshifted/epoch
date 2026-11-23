import MobileLabIndex from "@/components/intro/MobileLabIndex";

export const metadata = { title: "Mobile view lab" };

/** /v2/lab/mobile (/lab/mobile) — the mobile view lab's buttons (components/intro/MobileLabIndex.tsx). */
export default function MobileLabPage() {
  return (
    <div className="relative flex min-h-screen items-center justify-center bg-[#0a0a0a] px-12 py-32 text-white sm:px-24 lg:px-48">
      <div className="relative z-10 w-full max-w-2xl">
        <MobileLabIndex />
      </div>
    </div>
  );
}
