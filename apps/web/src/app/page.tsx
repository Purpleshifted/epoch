import StartScreen from "@/components/intro/StartScreen";

export default function IntroPage() {
  console.log("SSR hit");
  return (
    <div className="relative flex min-h-screen items-center justify-center bg-[#0a0a0a] px-12 py-32 text-white sm:px-24 lg:px-48">
      <div className="relative z-10 w-full max-w-2xl">
        <StartScreen />
      </div>
    </div>
  );
}
