export const addResizeListener = (
  handler: () => void,
  options?: { immediate?: boolean }
) => {
  if (typeof window === "undefined") return () => undefined;

  const wrapped = () => handler();
  window.addEventListener("resize", wrapped);

  if (options?.immediate) {
    handler();
  }

  return () => {
    window.removeEventListener("resize", wrapped);
  };
};

export const createHeartbeat = (callback: () => void, interval = 1000) => {
  if (typeof window === "undefined") return () => undefined;

  const id = window.setInterval(callback, interval);
  return () => window.clearInterval(id);
};
