// Page side of the tiled capture: the same camera, a window into a frame far larger than the canvas.
;(() => {
  const G = () => __poster.get();
  let base = null;
  window.__tileInit = async ({ fullW, fullH, pose, pointK = 1, markers = false }) => {
    const { camera, scene, setFrameloop } = G();
    setFrameloop("demand");
    camera.clearViewOffset();
    await __elev(pose);
    camera.aspect = fullW / fullH;
    camera.updateProjectionMatrix();
    window.__STORE?.setValueAtPath?.("보기.markers", markers, true);
    // a point's size in three.js knows neither the lens nor the tile: scale what the wall's look would have at this frame
    if (base) base.forEach(([m, s]) => (m.size = s));
    base = [];
    scene.traverse((o) => {
      if (o.isPoints && o.material?.isPointsMaterial) {
        base.push([o.material, o.material.size]);
        o.material.size *= pointK;
      }
    });
    return { points: base.map(([m, s]) => [+s.toFixed(3), +m.size.toFixed(3)]) };
  };
  window.__tile = async (x, y, w, h, fullW, fullH) => {
    const { camera, invalidate } = G();
    camera.setViewOffset(fullW, fullH, x, y, w, h);
    camera.updateProjectionMatrix();
    for (let i = 0; i < 3; i++) {
      invalidate();
      await new Promise((ok) => requestAnimationFrame(ok));
    }
    await new Promise((ok) => setTimeout(ok, 30));
    invalidate();
    await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
    return document.querySelector("canvas").toDataURL("image/png");
  };
  window.__tileDone = () => {
    const { camera, setFrameloop } = G();
    camera.clearViewOffset();
    camera.updateProjectionMatrix();
    setFrameloop("demand");
    return true;
  };
  return "tiles ready";
})()
;(() => {
  // a clean ground for cutting out: no grain over it, one flat colour
  window.__keyGround = (hex) => {
    const { scene, invalidate } = __poster.get();
    window.__STORE?.setValueAtPath?.("렌더 · 성능.빛.grain", 0, true);
    scene.background?.set?.(hex);
    invalidate();
    return scene.background?.getHexString?.();
  };
  return "key ready";
})()
