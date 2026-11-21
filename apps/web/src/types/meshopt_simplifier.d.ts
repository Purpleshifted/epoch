/**
 * three.js ships meshoptimizer's simplifier (examples/jsm/libs/meshopt_simplifier.module.js: the WASM, inline) without
 * a type declaration (@types/three 0.186 declares only the decoder). The part of it the fossil uses (fuseUnits.ts
 * simplifyMesh, side.worker.ts): index-only simplification, so every per-vertex attribute stays as it was.
 */
declare module "three/examples/jsm/libs/meshopt_simplifier.module.js" {
  export type MeshoptSimplifyFlag = "LockBorder" | "Sparse" | "ErrorAbsolute" | "Prune" | "Regularize" | "Permissive" | "RegularizeLight";
  export const MeshoptSimplifier: {
    /** Resolves once the WASM is instantiated; nothing may be called before. */
    ready: Promise<void>;
    supported: boolean;
    /** The simplified index buffer (a subset of the vertices) and the error reached (relative to the mesh's extent, or
     *  absolute with "ErrorAbsolute"). `target` is an index count, a multiple of 3, at most `indices.length`. */
    simplify(indices: Uint32Array, positions: Float32Array, stride: number, target: number, error: number, flags?: readonly MeshoptSimplifyFlag[]): [Uint32Array, number];
    /** The same, with per-vertex attributes weighed into the error (none: an empty array, stride 0, no weights) and a
     *  per-vertex lock (1 = the vertex stays). */
    simplifyWithAttributes(indices: Uint32Array, positions: Float32Array, stride: number, attributes: Float32Array, attributeStride: number, weights: readonly number[], lock: Uint8Array | null, target: number, error: number, flags?: readonly MeshoptSimplifyFlag[]): [Uint32Array, number];
    getScale(positions: Float32Array, stride: number): number;
  };
}
