import React, { useState } from "react";
import { type NavButtonDef, visibleNavButtons, localizedNavButton } from "@/lib/navButtons";
import { getNavAction } from "@/lib/navActions";
import { moveNavToZone, handleNavDrop, useNavDragStore } from "@/lib/navDrag";
import type { AppConfig } from "@/lib/types";
import { useAppStore } from "@/state/appStore";
import { openContextMenu } from "@/state/uiStore";
import { t } from "@/lib/i18n";
import { EyeOff, SlidersHorizontal, ArrowLeftToLine, AlignLeft, AlignCenter, AlignRight } from "lucide-react";

export const ChromeNavButtons = ({ config }: { config: AppConfig | null }) => {
  const navDragId = useNavDragStore((s) => s.dragId);
  const setNavDragId = useNavDragStore((s) => s.setDragId);
  const [navDragOverId, setNavDragOverId] = useState<string | null>(null);

  if (!config) return null;
  const chromeIds = config.ui.nav_chrome || [];

  // Show buttons explicitly assigned to the chrome zone
  const buttons = visibleNavButtons(config.ui.nav_order, config.ui.nav_hidden)
    .filter((b) => chromeIds.includes(b.id))
    .filter((b) => b.id !== "web" || config.ui.browser_enabled)
    .map(localizedNavButton);

  const navContextMenu = (e: React.MouseEvent, def?: NavButtonDef) => {
    openContextMenu(e, [
      ...(def
        ? [
            {
              label: t("Move to sidebar"),
              icon: ArrowLeftToLine,
              onClick: () => moveNavToZone(def.id, "sidebar"),
            },
            {
              label: t("Top bar: align left"),
              icon: AlignLeft,
              onClick: () => moveNavToZone(def.id, "topbar-left"),
            },
            {
              label: t("Top bar: align center"),
              icon: AlignCenter,
              onClick: () => moveNavToZone(def.id, "topbar-center"),
            },
            {
              label: t("Top bar: align right"),
              icon: AlignRight,
              onClick: () => moveNavToZone(def.id, "topbar-right"),
            },
            {
              label: t('Hide "{0}" button').replace("{0}", def.label),
              icon: EyeOff,
              onClick: () => moveNavToZone(def.id, "hidden"),
            },
            { separator: true },
          ]
        : []),
      {
        label: t("Customize in Settings…"),
        icon: SlidersHorizontal,
        onClick: () => useAppStore.getState().setSettingsOpen(true, "interface"),
      },
    ]);
  };

  const onDrop = (targetId: string | null) => {
    if (navDragId) handleNavDrop(navDragId, targetId, "chrome");
    setNavDragId(null);
    setNavDragOverId(null);
  };

  return (
    <div 
      className="flex h-full items-center gap-0.5 px-2"
      onDragOver={(e) => {
        if (!navDragId) return;
        e.preventDefault();
        setNavDragOverId("chrome-zone");
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDrop(null);
      }}
    >
      {buttons.map((b) => (
        <button
          key={b.id}
          className={`lx-square-btn lx-toolbar-item flex h-7 w-7 items-center justify-center text-muted hover:text-strong ${
            navDragOverId === b.id ? "border-l-accent" : ""
          } ${navDragId === b.id ? "opacity-30" : ""}`}
          title={b.title}
          onClick={(e) => {
            if (e.detail > 1) return; // ignore double clicks
            getNavAction(b.id)();
          }}
          onContextMenu={(e) => navContextMenu(e, b)}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = "move";
            // e.dataTransfer.setDragImage(e.currentTarget, 14, 14); // native ghost
            setNavDragId(b.id);
          }}
          onDragOver={(e) => {
            if (!navDragId || navDragId === b.id) return;
            e.preventDefault();
            e.stopPropagation();
            setNavDragOverId(b.id);
          }}
          onDragLeave={() => setNavDragOverId(null)}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onDrop(b.id);
          }}
        >
          <b.icon size={15} strokeWidth={1.5} />
        </button>
      ))}
    </div>
  );
};
