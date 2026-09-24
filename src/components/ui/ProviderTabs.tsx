import { ReactNode, useRef, useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { ProviderIcon } from "./ProviderIcon";
import type { ColorScheme as BaseColorScheme } from "../../utils/modelPickerStyles";

export interface ProviderTabItem {
  id: string;
  name: string;
  recommended?: boolean;
}

type ColorScheme = Exclude<BaseColorScheme, "blue"> | "dynamic";

interface ProviderTabsProps {
  providers: ProviderTabItem[];
  selectedId: string;
  onSelect: (id: string) => void;
  renderIcon?: (providerId: string) => ReactNode;
  colorScheme?: ColorScheme;
  /** Allow horizontal scrolling for many providers */
  scrollable?: boolean;
}

export function ProviderTabs({
  providers,
  selectedId,
  onSelect,
  renderIcon,
  colorScheme = "purple",
  scrollable = false,
}: ProviderTabsProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const [indicatorStyle, setIndicatorStyle] = useState<React.CSSProperties>({
    opacity: 0,
  });

  const updateIndicator = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const selectedIndex = providers.findIndex((p) => p.id === selectedId);
    if (selectedIndex === -1) {
      setIndicatorStyle({ opacity: 0 });
      return;
    }

    const buttons = container.querySelectorAll<HTMLButtonElement>("[data-tab-button]");
    const selectedButton = buttons[selectedIndex];
    if (!selectedButton) return;

    const containerRect = container.getBoundingClientRect();
    const buttonRect = selectedButton.getBoundingClientRect();

    setIndicatorStyle({
      width: buttonRect.width,
      height: buttonRect.height,
      transform: `translateX(${buttonRect.left - containerRect.left}px)`,
      opacity: 1,
    });
  }, [providers, selectedId]);

  useEffect(() => {
    updateIndicator();
  }, [updateIndicator]);

  useEffect(() => {
    const observer = new ResizeObserver(() => updateIndicator());
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [updateIndicator]);

  return (
    <div
      ref={containerRef}
      className={`relative flex p-[3px] rounded-full bg-surface-1 shadow-[inset_0_0_0_1px_var(--color-border)] ${scrollable ? "overflow-x-auto" : ""}`}
    >
      {/* Sliding knob: a white capsule under the chosen segment */}
      <div
        className="absolute top-[3px] left-0 rounded-full bg-card shadow-[0_1px_3px_rgb(58_36_20/0.18),inset_0_1px_0_rgb(255_255_255/0.6)] dark:bg-surface-raised dark:shadow-[0_1px_3px_rgb(0_0_0/0.4)] transition-[width,height,transform,opacity] duration-[320ms] ease-[cubic-bezier(.3,.7,.3,1.15)] pointer-events-none"
        style={indicatorStyle}
      />

      {providers.map((provider) => {
        const isSelected = selectedId === provider.id;

        return (
          <button
            key={provider.id}
            data-tab-button
            onClick={() => onSelect(provider.id)}
            className={`relative z-10 flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-full font-semibold text-xs transition-colors duration-150 ${
              scrollable ? "whitespace-nowrap" : ""
            } ${isSelected ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            {renderIcon ? renderIcon(provider.id) : <ProviderIcon provider={provider.id} />}
            <span>{provider.name}</span>
            {provider.recommended && (
              <span className="text-xs text-primary/70 font-medium">{t("common.recommended")}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
