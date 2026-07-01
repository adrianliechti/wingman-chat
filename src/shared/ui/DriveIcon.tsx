import { HardDrive } from "lucide-react";
import type { DriveConfig } from "@/shared/config";

/** A drive's configured mask icon, falling back to a generic drive glyph. */
export function DriveIcon({ drive, size = 16 }: { drive: DriveConfig; size?: number }) {
  if (!drive.icon) {
    return <HardDrive size={size} />;
  }
  return (
    <span
      className="shrink-0 bg-current inline-block"
      style={{
        width: size,
        height: size,
        maskImage: `url(${drive.icon})`,
        WebkitMaskImage: `url(${drive.icon})`,
        maskSize: "contain",
        maskRepeat: "no-repeat",
        maskPosition: "center",
      }}
    />
  );
}
