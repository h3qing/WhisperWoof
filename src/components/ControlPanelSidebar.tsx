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
  FolderOpen,
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

export type ControlPanelView = "home" | "personal-notes" | "dictionary" | "memory" | "upload" | "integrations" | "whisperwoof-history" | "whisperwoof-projects" | "whisperwoof-plugins" | "smart-clipboard" | "storage";

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
        { id: "smart-clipboard", label: "Clipboard", icon: Copy },
      ],
    },
    {
      label: "Tools",
      items: [
        { id: "memory", label: "Memory", icon: BookOpen },
        { id: "whisperwoof-projects", label: "Projects", icon: FolderOpen },
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
    <div className="w-48 h-[calc(100%-1rem)] m-2 mr-0 shrink-0 rounded-xl glass-thick flex flex-col overflow-hidden">
      <div
        className="w-full h-10 shrink-0"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      />

      {onOpenSearch && (
        <div className="px-2 pt-2 pb-1">
          <button
            onClick={onOpenSearch}
            className="group flex items-center w-full h-7 px-2.5 rounded-md border border-border/60 bg-card/60 hover:bg-card transition-colors gap-2 outline-none focus-visible:ring-1 focus-visible:ring-primary/30"
          >
            <Search size={11} className="text-muted-foreground/70 shrink-0" />
            <span className="flex-1 text-[11px] text-left text-muted-foreground/70">
              {t("commandSearch.shortPlaceholder")}
            </span>
            <div className="flex items-center gap-0.5 shrink-0">
              <kbd className="text-[10px] px-1 py-px rounded border border-border/60 bg-muted/40 text-muted-foreground/70 font-mono leading-tight">
                {platform === "darwin" ? "⌘" : "Ctrl"}
              </kbd>
              <kbd className="text-[10px] px-1 py-px rounded border border-border/60 bg-muted/40 text-muted-foreground/70 font-mono leading-tight">
                K
              </kbd>
            </div>
          </button>
        </div>
      )}

      <nav className="flex flex-col gap-0.5 px-2 pt-2 pb-2">
        {navSections.map((section, si) => (
          <div key={si}>
            {section.label && (
              <div className="text-[9px] uppercase tracking-wider text-muted-foreground/70 font-medium px-2.5 pt-3 pb-1">
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
                  className={cn(
                    "group relative flex items-center gap-2.5 w-full h-8 px-2.5 rounded-md outline-none transition-colors duration-150 text-left",
                    "focus-visible:ring-1 focus-visible:ring-primary/30",
                    isActive
                      ? "bg-primary/15 text-foreground"
                      : "bg-transparent hover:bg-foreground/5 active:bg-foreground/8"
                  )}
                >
                  <Icon
                    size={15}
                    className={cn(
                      "shrink-0 transition-colors duration-150",
                      isActive
                        ? "text-foreground"
                        : "text-muted-foreground group-hover:text-foreground"
                    )}
                  />
                  <span
                    className={cn(
                  "text-xs transition-colors duration-150",
                  isActive
                    ? "text-foreground font-medium"
                    : "text-foreground/85 group-hover:text-foreground"
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

      <div className="px-2 pb-2 space-y-0.5">
        {updateAction && (
          <div className="px-1 pb-1" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
            {updateAction}
          </div>
        )}

        {/* Settings button */}
        <button
          onClick={onOpenSettings}
          aria-label={t("sidebar.settings")}
          className="group flex items-center gap-2.5 w-full h-8 px-2.5 rounded-md text-left outline-none hover:bg-foreground/5 focus-visible:ring-1 focus-visible:ring-primary/30 transition-colors duration-150"
        >
          <Settings
            size={15}
            className="shrink-0 text-muted-foreground group-hover:text-foreground transition-colors duration-150"
          />
          <span className="text-xs text-foreground/85 group-hover:text-foreground transition-colors duration-150">
            {t("sidebar.settings")}
          </span>
        </button>

        {/* Branding */}
        <div className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-md mt-1">
          <img src={logoIcon} alt="" className="w-5 h-5 rounded-sm shrink-0" />
          <p className="text-xs text-muted-foreground font-medium">
            WhisperWoof
          </p>
        </div>
      </div>
    </div>
  );
}
