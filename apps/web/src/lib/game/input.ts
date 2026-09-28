export interface PointerData {
  x: number;
  y: number;
}

export const computePointerFromEvent = (
  event: PointerEvent | MouseEvent | TouchEvent,
  canvas: HTMLCanvasElement
): PointerData | null => {
  const rect = canvas.getBoundingClientRect();

  if ("touches" in event) {
    const touch = event.touches[0];
    if (!touch) return null;
    return {
      // 고해상도 캔버스에서도 논리 좌표계는 CSS 크기 기준으로 삼기
      x: touch.clientX - rect.left - rect.width / 2,
      y: touch.clientY - rect.top - rect.height / 2,
    };
  }

  if ("clientX" in event && "clientY" in event) {
    return {
      x: event.clientX - rect.left - rect.width / 2,
      y: event.clientY - rect.top - rect.height / 2,
    };
  }

  return null;
};

export const preventScrollOnTouch = (event: TouchEvent) => {
  event.preventDefault();
};
