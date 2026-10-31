import type { ReactNode } from "react";
import { VersionProvider } from "@/components/parliament/version";
import ServerPresetsGate from "@/components/parliament/ServerPresetsGate";

export default function VersionLayout({ children }: { children: ReactNode }) {
  return (
    <VersionProvider version="v2">
      <ServerPresetsGate>{children}</ServerPresetsGate>
    </VersionProvider>
  );
}
