import type { ReactNode } from "react";
import { VersionProvider } from "@/components/parliament/version";

export default function VersionLayout({ children }: { children: ReactNode }) {
  return <VersionProvider version="v1">{children}</VersionProvider>;
}
