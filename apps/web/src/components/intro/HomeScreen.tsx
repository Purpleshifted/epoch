"use client";

import { EntryGroup } from "./EntryGroup";

/**
 * Entry page (the artist, 2026-10-29): buttons only. EXHIBITION = the wall and the visitor's screen with no panel (the
 * wall opens in a window of its own, for the second display); REHEARSAL = the same two with Leva, and MANAGEMENT for
 * the tools around the work (the sound bench, the lab, the database later). Exhibition and rehearsal land on the same
 * pages, so the Leva values saved while rehearsing are the ones the exhibition loads. "Global" is the 3D timespace.
 * "Personal · gallery" is the same screen on the gallery machine (?venue=gallery): the end card prints (출력하기) instead
 * of saving, and the gallery comes back to it (the artist, 2026-11-22: "베뉴 갤러리가 설정된 버튼을 홈화면에 추가해줘").
 * LAB (the artist, 2026-11-23): what is not a run-through of the real screens leaves REHEARSAL — the wall's visual lab,
 * the mobile view lab (the personal view's assets one page each, then an action preview) and management.
 */
export default function HomeScreen() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-10 text-center text-white">
      <h1 className="vintage-serif text-4xl font-bold leading-tight tracking-wide sm:text-5xl md:text-6xl">Stratum of the Anthropocene</h1>
      <div className="flex w-[300px] flex-col gap-8">
        <EntryGroup
          title="EXHIBITION"
          note="no panel"
          entries={[
            { href: "/exhibition/global", name: "Global", sub: "the wall · opens in its own window", main: true, window: true },
            { href: "/exhibition/personal", name: "Personal", sub: "the visitor's screen", main: true },
            { href: "/exhibition/personal?venue=gallery", name: "Personal · gallery", sub: "the gallery machine · 출력하기 prints the card", main: true },
          ]}
        />
        <EntryGroup
          title="REHEARSAL"
          note="with Leva"
          entries={[
            { href: "/rehearsal/global", name: "Global", sub: "the wall, for tuning" },
            { href: "/rehearsal/future", name: "Future", sub: "the layer above only, live · light to draw" },
            { href: "/rehearsal/personal", name: "Personal", sub: "the visitor's screen, for tuning" },
            { href: "/rehearsal/personal?venue=gallery", name: "Personal · gallery", sub: "the gallery machine's screen (출력하기), for tuning" },
          ]}
        />
        <EntryGroup
          title="LAB"
          note="not a run-through"
          entries={[
            { href: "/rehearsal/lab", name: "Visual lab", sub: "the wall's world taken once · no bots · for tuning the look" },
            { href: "/lab/mobile", name: "Mobile view lab", sub: "scan · bot, present · future · action preview" },
            { href: "/rehearsal/management", name: "Management", sub: "sound bench · lab · other views" },
          ]}
        />
      </div>
    </div>
  );
}
