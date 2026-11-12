import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { arriveCompile, makeArriveUniforms, setArrive } from "./arriveMaterial";

describe("arrival shader", () => {
  it("finds its two places in three.js's standard and depth vertex shaders", () => {
    const u = makeArriveUniforms();
    for (const lib of [THREE.ShaderLib.standard, THREE.ShaderLib.depth]) {
      const shader = { uniforms: {} as Record<string, unknown>, vertexShader: lib.vertexShader };
      arriveCompile(u)(shader);
      expect(shader.vertexShader).toContain("attribute vec2 aBorn;");
      expect(shader.vertexShader).toContain("float arriveP");
      // after the part's own vertex is set up, before its instance matrix is applied
      expect(shader.vertexShader.indexOf("float arriveP")).toBeGreaterThan(shader.vertexShader.indexOf("#include <begin_vertex>"));
      expect(shader.vertexShader.indexOf("float arriveP")).toBeLessThan(shader.vertexShader.indexOf("#include <project_vertex>"));
      expect(shader.uniforms.uArriveNow).toBe(u.uArriveNow);
    }
  });

  it("off = duration 0 (the shader leaves every part as it is)", () => {
    const u = makeArriveUniforms();
    setArrive(u, { on: true, sec: 2.5, stagger: 4, way: "settle", lift: 1.5 });
    expect([u.uArriveDur.value, u.uArriveStagger.value, u.uArriveWay.value, u.uArriveLift.value]).toEqual([2.5, 4, 1, 1.5]);
    setArrive(u, { on: false, sec: 2.5, stagger: 4, way: "grow", lift: 1.5 });
    expect(u.uArriveDur.value).toBe(0);
  });
});
