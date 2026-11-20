/**
 * WHICH CODE A WORKER IS RUNNING (2026-11-16). The dev server hot-updates the page, not the workers the page has
 * already started: for half an hour that evening the artist's window ran the wall's new page with the workers of its
 * last real load, and four fixes made in the workers' code never ran there ("길과 배관은 … 여전히 화석화 안 되는 중").
 * Every answer of a worker now carries this stamp, and the wall's readout says so when a worker's is not the page's
 * own. BUMPED BY HAND whenever code that a worker runs is changed (lib/parliament/*, the worker files).
 */
export const WALL_BUILD = "11-20 17:05";
