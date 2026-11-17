/**
 * THE LAYER ABOVE THE COLUMN, ALONE (the artist, 2026-11-17: "rehearsal 단락에 버튼 하나 추가해서 거기서는 미래 도시
 * 비주얼만 실시간 연동돼서 조절 가능하도록 해줘, 렌더 부하 적은 상태에서 레바로 이것저것 조절하면서 보고싶어 … 그 창에서는
 * '현재' 구간 포함 배경, 핀조명도 렌더할 필요 없음"). The wall opened with `?only=future` (/rehearsal/future) is the
 * same page on the same shared world — the bots run on the bot server and the layer is the live one — but of all it
 * draws only the layer: not the column of the present (its parts, fossil, pipes, ways, vegetation, markers), not the
 * pit and its light; and its worker makes no part of the present (SpaceModel PartsInput.futureOnly).
 *
 * READ FROM THE ADDRESS EVERY TIME it is asked (the artist, the same evening, on production: "프로덕션 미래 탭에서
 * '현재'까지 왜 그리지?"): it was read once, when the module first loaded — and opened from the home screen's button
 * the page is reached by an in-app navigation and a redirect, so the module could load before the address said
 * `only=future`, and the whole column was drawn. Cheap: parsed again only when the address changes.
 */
let lastSearch: string | null = null;
let lastValue = false;

export function futureOnly(): boolean {
  if (typeof window === "undefined") return false;
  const s = window.location.search;
  if (s !== lastSearch) {
    lastSearch = s;
    lastValue = new URLSearchParams(s).get("only") === "future";
  }
  return lastValue;
}
