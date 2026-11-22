/**
 * paperLook — 흰 바탕 (the artist, 2026-11-22 night: "전체 흰 바탕"): whether the personal view is drawn as paper — a white
 * ground, the things on it dark smears. SET by the street look (개인뷰 비주얼 › 길거리, usePersonalVisuals); READ per frame by
 * whatever must match it (the future's frames: dark ink on paper when on, light on black when off). `near` is the radius
 * (world units) within which a person is drawn as a blot by the street look — beyond it the present's scan carries them.
 * A plain module value, no React. Owned by the street-feel session; others only read it.
 */
export const paperLook = { on: false, paper: "#ffffff", ink: "#141414", near: 8 };
