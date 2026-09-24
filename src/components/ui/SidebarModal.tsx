import React from "react";
import { useTranslation } from "react-i18next";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

export interface SidebarItem<T extends string> {
  id: T;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  group?: string;
  description?: string;
  badge?: string;
  badgeVariant?: "default" | "new" | "update" | "dot";
  shortcut?: string;
}

interface SidebarModalProps<T extends string> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  sidebarItems: SidebarItem<T>[];
  activeSection: T;
  onSectionChange: (section: T) => void;
  children: React.ReactNode;
  sidebarWidth?: string;
  version?: string;
}

export default function SidebarModal<T extends string>({
  open,
  onOpenChange,
  title,
  sidebarItems,
  activeSection,
  onSectionChange,
  children,
  sidebarWidth = "w-52",
  version,
}: SidebarModalProps<T>) {
  const { t } = useTranslation();
  // Group items by their group property
  const groupedItems = React.useMemo(() => {
    const groups: { label: string | null; items: SidebarItem<T>[] }[] = [];
    let currentGroup: string | null | undefined = undefined;

    for (const item of sidebarItems) {
      const group = item.group ?? null;
      if (group !== currentGroup) {
        groups.push({ label: group, items: [item] });
        currentGroup = group;
      } else {
        groups[groups.length - 1].items.push(item);
      }
    }

    return groups;
  }, [sidebarItems]);

  const renderBadge = (item: SidebarItem<T>) => {
    if (!item.badge && item.badgeVariant !== "dot") return null;

    if (item.badgeVariant === "dot") {
      return <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary shrink-0" />;
    }

    return (
      <span
        className={`ml-auto text-[11px] font-semibold px-2 py-px rounded-full shrink-0 ${
          item.badgeVariant === "new"
            ? "bg-primary/12 text-primary"
            : item.badgeVariant === "update"
              ? "bg-warning/12 text-warning"
              : "bg-muted text-muted-foreground"
        }`}
      >
        {item.badge}
      </span>
    );
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/30 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content aria-describedby={undefined} className="fixed left-[50%] top-[50%] z-50 max-h-[85vh] w-[90vw] max-w-4xl translate-x-[-50%] translate-y-[-50%] rounded-[var(--radius-window)] p-0 overflow-hidden glass-thick glass-rim text-foreground duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-98 data-[state=open]:zoom-in-98">
          <div className="relative h-full max-h-[85vh] overflow-hidden">
            <DialogPrimitive.Close className="absolute right-5 top-5 z-10 rounded-full p-1.5 opacity-40 ring-offset-background transition-[opacity,background-color] hover:opacity-100 bg-transparent hover:bg-accent/70 focus:outline-none focus:ring-2 focus:ring-ring/50 focus:ring-offset-1">
              <X className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="sr-only">{t("common.close")}</span>
            </DialogPrimitive.Close>

            <div className="flex h-[85vh]">
              {/* Sidebar */}
              <div
                className={`${sidebarWidth} shrink-0 flex flex-col bg-transparent`}
              >
                {/* Title */}
                <div className="px-5 pt-5 pb-0.5">
                  <DialogPrimitive.Title className="text-[19px] font-bold tracking-[-0.01em] text-foreground">
                    {title}
                  </DialogPrimitive.Title>
                </div>

                {/* Navigation */}
                <nav className="relative flex-1 px-2.5 pt-2.5 pb-2 overflow-y-auto">
                  {groupedItems.map((group, groupIndex) => (
                    <div key={groupIndex} className={groupIndex > 0 ? "mt-3" : ""}>
                      {group.label && (
                        <div className="px-3 pb-1 pt-1.5">
                          <span className="text-xs font-semibold text-muted-foreground">
                            {group.label}
                          </span>
                        </div>
                      )}
                      <div className="space-y-0.5">
                        {group.items.map((item) => {
                          const Icon = item.icon;
                          const isActive = activeSection === item.id;
                          return (
                            <button
                              key={item.id}
                              data-section-id={item.id}
                              onClick={() => onSectionChange(item.id)}
                              aria-current={isActive ? "page" : undefined}
                              className={`press group relative w-full flex items-center gap-2.5 min-h-9 px-3 text-left text-sm text-foreground rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                                isActive ? "bg-select" : "hover:bg-[var(--glass-hover)]"
                              }`}
                            >
                              <Icon className="h-[17px] w-[17px] shrink-0 text-primary" />
                              <span
                                className={`flex-1 truncate leading-tight ${isActive ? "font-semibold" : "font-medium"}`}
                              >
                                {item.label}
                              </span>
                              {renderBadge(item)}
                              {item.shortcut && !item.badge && (
                                <kbd className="ml-auto text-xs text-faint shrink-0">
                                  {item.shortcut}
                                </kbd>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </nav>

                {/* Footer / version */}
                {version && (
                  <div className="px-3 py-2.5 border-t border-border-subtle/60">
                    <div className="flex items-center gap-1.5">
                      <div className="h-1 w-1 rounded-full bg-success/60" />
                      <span className="text-xs text-muted-foreground/60 tabular-nums tracking-wide">
                        v{version}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Main content: a sheet nested in the glass window (radius = window - inset) */}
              <div className="flex-1 overflow-y-auto bg-card rounded-[calc(var(--radius-window)-8px)] m-2 ml-0 shadow-card">
                <div className="p-6">{children}</div>
              </div>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
