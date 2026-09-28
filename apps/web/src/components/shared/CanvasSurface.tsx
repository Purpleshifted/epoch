"use client";

import { forwardRef } from "react";

interface CanvasSurfaceProps
  extends React.CanvasHTMLAttributes<HTMLCanvasElement> {
  className?: string;
}

const CanvasSurface = forwardRef<HTMLCanvasElement, CanvasSurfaceProps>(
  ({ className = "", style, ...props }, ref) => {
    return (
      <canvas
        ref={ref}
        className={`h-full w-full touch-none ${className}`}
        style={{ touchAction: "none", ...style }}
        {...props}
      />
    );
  }
);

CanvasSurface.displayName = "CanvasSurface";

export default CanvasSurface;
