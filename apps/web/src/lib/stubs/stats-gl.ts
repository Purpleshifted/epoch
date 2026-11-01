/**
 * A do-nothing stand-in for `stats-gl` (2026-11-01). @react-three/drei re-exports its `StatsGl` component from the
 * package index, and `stats-gl@2.4.2` brings its own `three@0.170.0` — so the app shipped TWO copies of three
 * ("THREE.WARNING: Multiple instances of Three.js being imported" on the production wall). We never use StatsGl;
 * next.config's turbopack.resolveAlias points `stats-gl` here so neither it nor its three is bundled. The shape
 * matches what drei's StatsGl touches, so mounting it by mistake shows nothing instead of crashing. To actually use
 * StatsGl, remove the alias.
 */
export default class Stats {
  domElement: HTMLDivElement;

  constructor(_opts?: unknown) {
    this.domElement = typeof document === "undefined" ? (null as unknown as HTMLDivElement) : document.createElement("div");
  }

  init(_renderer?: unknown): void {}

  begin(): void {}

  end(): void {}

  update(): void {}
}
