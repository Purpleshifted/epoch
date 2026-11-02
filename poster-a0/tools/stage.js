// Page side of the capture: window.__stage({...}) poses the lab's camera; window.__tile(...) renders one tile of a larger frame.
(() => {
  const P = window.__poster;
  const st = () => P.get();
  window.__stage = async ({ fov = 40, dist = 160, az = 36, polar = 80, tx = 0, ty = 40, tz = 0, far = 40000, near = 1 } = {}) => {
    const { camera, controls, invalidate, size } = st();
    camera.manual = true;
    camera.fov = fov;
    camera.near = near;
    camera.far = far;
    camera.aspect = size.width / size.height;
    camera.clearViewOffset?.();
    const a = (az * Math.PI) / 180, b = (polar * Math.PI) / 180;
    const target = [tx, ty, tz];
    camera.position.set(tx + dist * Math.sin(b) * Math.sin(a), ty + dist * Math.cos(b), tz + dist * Math.sin(b) * Math.cos(a));
    camera.lookAt(...target);
    camera.updateProjectionMatrix();
    if (controls) {
      controls.target.set(...target);
      controls.minDistance = 0;
      controls.maxDistance = Infinity;
      controls.enableDamping = false;
      controls.update();
    }
    invalidate();
    await new Promise((ok) => setTimeout(ok, 50));
    return { hasControls: !!controls, size: [size.width, size.height], pos: camera.position.toArray().map((v) => +v.toFixed(1)), fov: camera.fov };
  };
  window.__frames = (n = 3) => new Promise((ok) => { const f = () => (n-- > 0 ? requestAnimationFrame(f) : ok(true)); f(); });
  return "stage ready";
})()
;(() => {
  // pose by what should be visible: vh = world units from top to bottom of the frame, top = the world y at the frame's top
  window.__elev = async ({ az = 36, polar = 86, vh = 56, top = 84, tx = 0, tz = 0, fov = 6 } = {}) => {
    const dist = vh / 2 / Math.tan((fov * Math.PI) / 360);
    return window.__stage({ fov, dist, az, polar, tx, tz, ty: top - vh / 2, near: Math.max(1, dist - 180), far: dist + 180 });
  };
  return "elev ready";
})()
