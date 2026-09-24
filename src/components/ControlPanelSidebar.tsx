import React, { useState } from "react";
import {
  Home,
  NotebookPen,
  BookOpen,
  Upload,
  // Blocks,        // WhisperWoof: unused — Integrations view hidden
  // Gift,          // WhisperWoof: unused — Referrals removed
  Settings,
  // HelpCircle,    // WhisperWoof: unused — Support dropdown removed
  // UserCircle,    // WhisperWoof: unused — User profile replaced with branding
  X,
  Search,
  Clock,
  FileText,
  Puzzle,
  Copy,
  HardDrive,
} from "lucide-react";
import logoIcon from "../assets/mando-head.svg";
import { useTranslation } from "react-i18next";
import { cn } from "./lib/utils";
// import SupportDropdown from "./ui/SupportDropdown"; // WhisperWoof: unused — Support dropdown removed
import { getCachedPlatform } from "../utils/platform";

const platform = getCachedPlatform();

export type ControlPanelView = "home" | "voice-notes" | "personal-notes" | "dictionary" | "memory" | "upload" | "integrations" | "whisperwoof-history" | "whisperwoof-plugins" | "smart-clipboard" | "storage";

interface ControlPanelSidebarProps {
  activeView: ControlPanelView;
  onViewChange: (view: ControlPanelView) => void;
  onOpenSettings: () => void;
  onOpenSearch?: () => void;
  onOpenReferrals?: () => void;
  onUpgrade?: () => void;
  onUpgradeCheckout?: () => void;
  isOverLimit?: boolean;
  // WhisperWoof: Auth props kept in interface for compatibility but no longer used
  userName?: string | null;
  userEmail?: string | null;
  userImage?: string | null;
  isSignedIn?: boolean;
  authLoaded?: boolean;
  isProUser?: boolean;
  usageLoaded?: boolean;
  updateAction?: React.ReactNode;
}

export default function ControlPanelSidebar({
  activeView,
  onViewChange,
  onOpenSettings,
  onOpenSearch,
  onOpenReferrals,
  onUpgrade,
  onUpgradeCheckout,
  updateAction,
}: ControlPanelSidebarProps) {
  const { t } = useTranslation();
  const [upgradeDismissed, setUpgradeDismissed] = useState(
    () => localStorage.getItem("upgradeProDismissed") === "true"
  );

  // WhisperWoof: No cloud subscription — disable all upgrade/limit banners
  const showLimitBanner = false;
  const showUpgradeBanner = false;

  type NavItem = { id: ControlPanelView; label: string; icon: React.ComponentType<{ size?: number; className?: string }> };
  type NavSection = { label?: string; items: NavItem[] };

  const navSections: NavSection[] = [
    {
      // Primary — what you use every day
      items: [
        { id: "home", label: t("sidebar.home"), icon: Home },
        { id: "whisperwoof-history", label: "History", icon: Clock },
        { id: "voice-notes", label: "Notes", icon: FileText },
        { id: "smart-clipboard", label: "Clipboard", icon: Copy },
      ],
    },
    {
      label: "Tools",
      items: [
        { id: "memory", label: "Memory", icon: BookOpen },
        { id: "whisperwoof-plugins", label: "Plugins", icon: Puzzle },
      ],
    },
    {
      label: "System",
      items: [
        { id: "storage", label: "Storage", icon: HardDrive },
      ],
    },
  ];

  // Legacy navItems for backward compat with the top-section .map() renderer
  const navItems: { id: ControlPanelView; label: string; icon: React.ComponentType<{ size?: number; className?: string }> }[] = [];

  return (
    // Floating glass slab, 10px from the window edges; the traffic lights sit inside it.
    <div className="relative w-[220px] h-[calc(100%-20px)] m-[10px] shrink-0 rounded-window glass-thick glass-rim flex flex-col overflow-hidden">
      <div
        className="w-full h-[52px] shrink-0"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      />

      <div
        className="flex items-center gap-2.5 px-4 pb-3"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      >
        <img src={logoIcon} alt="" className="w-6 h-6 shrink-0" />
        <p className="text-[17px] font-bold tracking-[-0.01em] text-foreground select-none">
          WhisperWoof
        </p>
      </div>

      {onOpenSearch && (
        <div className="px-2.5 pb-1">
          <button
            onClick={onOpenSearch}
            className="group flex items-center w-full h-8 pl-3 pr-1.5 rounded-full border border-border bg-input/80 hover:bg-input transition-colors gap-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Search size={14} className="text-faint shrink-0" />
            <span className="flex-1 text-[13px] text-left text-faint">
              {t("commandSearch.shortPlaceholder")}
            </span>
            <kbd className="shrink-0 text-[11px] font-semibold px-1.5 rounded-md border border-border border-b-2 bg-card text-muted-foreground leading-[18px]">
              {platform === "darwin" ? "⌘K" : "Ctrl K"}
            </kbd>
          </button>
        </div>
      )}

      <nav className="flex flex-col px-2.5 pt-1 pb-2" aria-label="Main">
        {navSections.map((section, si) => (
          <div key={si} className="flex flex-col gap-0.5">
            {section.label && (
              <div className="text-xs font-semibold text-muted-foreground px-3 pt-3.5 pb-1 select-none">
                {section.label}
              </div>
            )}
            {section.items.map((item) => {
              const Icon = item.icon;
              const isActive = activeView === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => onViewChange(item.id)}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "press group relative flex items-center gap-2.5 w-full min-h-9 px-3 rounded-full outline-none text-left",
                    "focus-visible:ring-2 focus-visible:ring-ring",
                    isActive ? "bg-select" : "bg-transparent hover:bg-[var(--glass-hover)]"
                  )}
                >
                  <Icon size={17} className="shrink-0 text-primary" />
                  <span
                    className={cn(
                      "text-sm text-foreground",
                      isActive ? "font-semibold" : "font-medium"
                    )}
                  >
                    {item.label}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="flex-1" />

      {showLimitBanner && (
        <div className="px-2 pb-2">
          <div className="rounded-lg border border-destructive/25 bg-destructive/5 dark:bg-destructive/10 p-3">
            <div className="flex flex-col items-center text-center">
              <img src={logoIcon} alt="" className="w-7 h-7 rounded-md mb-2" />
              <p className="text-xs font-medium text-foreground mb-0.5">
                {t("sidebar.limitReached")}
              </p>
              <p className="text-[11px] leading-snug text-muted-foreground mb-2.5">
                {t("sidebar.limitReachedDescription")}
              </p>
              <button
                onClick={onUpgradeCheckout}
                className="w-full h-7 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
              >
                {t("sidebar.upgradeToPro")}
              </button>
            </div>
          </div>
        </div>
      )}

      {showUpgradeBanner && (
        <div className="px-2 pb-2">
          <div className="relative rounded-lg border border-primary/20 bg-primary/5 dark:bg-primary/10 p-3">
            <button
              onClick={() => {
                setUpgradeDismissed(true);
                localStorage.setItem("upgradeProDismissed", "true");
              }}
              aria-label={t("common.dismiss")}
              className="absolute top-1.5 right-1.5 p-0.5 rounded-sm text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors"
            >
              <X size={12} />
            </button>
            <div className="flex flex-col items-center text-center pt-1">
              <img src={logoIcon} alt="" className="w-7 h-7 rounded-md mb-2" />
              <p className="text-xs font-medium text-foreground mb-0.5">
                {t("sidebar.upgradeTitle")}
              </p>
              <p className="text-[11px] leading-snug text-muted-foreground mb-2.5">
                {t("sidebar.upgradeDescription")}
              </p>
              <button
                onClick={onUpgrade}
                className="w-full h-7 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
              >
                {t("sidebar.learnMore")}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="px-2.5 pb-2.5 space-y-0.5">
        {updateAction && (
          <div className="px-1 pb-1" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
            {updateAction}
          </div>
        )}

        {/* Settings button */}
        <button
          onClick={onOpenSettings}
          aria-label={t("sidebar.settings")}
          className="press group flex items-center gap-2.5 w-full min-h-9 px-3 rounded-full text-left outline-none hover:bg-[var(--glass-hover)] focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Settings size={17} className="shrink-0 text-primary" />
          <span className="text-sm font-medium text-foreground">{t("sidebar.settings")}</span>
        </button>
      </div>
    </div>
  );
}
