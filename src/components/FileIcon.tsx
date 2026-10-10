/** Icon for a file or folder: coloured type badge for files, tinted folder
 *  glyph for directories. The mapping lives in `lib/fileIcons.ts`. */

import { Folder, FolderOpen } from "lucide-react";
import { memo } from "react";

import { fileBadge, folderColor, isDimmedFolder } from "@/lib/fileIcons";

interface FileIconProps {
  name: string;
  isDir?: boolean;
  expanded?: boolean;
  /** Edge length in px. */
  size?: number;
  className?: string;
}

function FileIconImpl({ name, isDir = false, expanded = false, size = 16, className = "" }: FileIconProps) {
  if (isDir) {
    const Glyph = expanded ? FolderOpen : Folder;
    const color = folderColor(name);
    return (
      <Glyph
        size={size}
        aria-hidden="true"
        className={`shrink-0 ${className}`}
        style={{ color, fill: color, fillOpacity: isDimmedFolder(name) ? 0.12 : 0.28 }}
      />
    );
  }
  const badge = fileBadge(name);
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center font-mono font-bold leading-none ${className}`}
      style={{
        width: size,
        height: size,
        borderRadius: Math.max(3, Math.round(size / 4)),
        background: badge.bg,
        color: badge.fg,
        fontSize: Math.max(7, Math.round(size * (badge.label.length > 2 ? 0.42 : 0.5))),
      }}
    >
      {badge.label}
    </span>
  );
}

export const FileIcon = memo(FileIconImpl);
