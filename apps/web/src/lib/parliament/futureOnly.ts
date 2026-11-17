/**
 * THE LAYER ABOVE THE COLUMN, ALONE (the artist, 2026-11-17: "rehearsal 단락에 버튼 하나 추가해서 거기서는 미래 도시
 * 비주얼만 실시간 연동돼서 조절 가능하도록 해줘, 렌더 부하 적은 상태에서 레바로 이것저것 조절하면서 보고싶어 … 그 창에서는
 * '현재' 구간 포함 배경, 핀조명도 렌더할 필요 없음"). The wall opened with `?only=future` (/rehearsal/future) is the
 * same page on the same shared world — the bots run and the worker works as ever, so the layer is the live one — but
 * of all it draws only the layer: not the column of the present (its parts, fossil, pipes, ways, vegetation,
 * markers), not the pit and its light. The camera is set on the layer once and left to the hand.
 *
 * Read once, when the page loads.
 */
export const FUTURE_ONLY: boolean = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("only") === "future";
