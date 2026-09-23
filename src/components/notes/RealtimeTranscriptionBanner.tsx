import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Zap, X } from "lucide-react";
import { cn } from "../lib/utils";

interface RealtimeTranscriptionBannerProps {
  onUpgrade?: () => void;
}

export default function RealtimeTranscriptionBanner({
  onUpgrade,
}: RealtimeTranscriptionBannerProps) {
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem("realtimeProBannerDismissed") === "true"
  );

  if (dismissed) return null;

  const handleDismiss = () => {
    localStorage.setItem("realtimeProBannerDismissed", "true");
    setDismissed(true);
  };

  return (
    <div
      className={cn(
        "flex items-center gap-2 px-3 h-8 shrink-0",
        "glass",
        "animate-in slide-in-from-top-2 duration-300"
      )}
    >
      <Zap size={11} className="text-primary shrink-0" />
      <p className="text-xs text-foreground/80 flex-1 truncate">{t("notes.realtimeBanner.message")}</p>
      {onUpgrade && (
        <button
          onClick={onUpgrade}
          className="text-xs font-medium text-primary hover:text-primary/80 transition-colors shrink-0"
        >
          {t("notes.realtimeBanner.upgrade")}
        </button>
      )}
      <button
        onClick={handleDismiss}
        className="p-0.5 rounded text-primary/25 hover:text-primary/50 transition-colors shrink-0"
        aria-label={t("common.dismiss")}
      >
        <X size={11} />
      </button>
    </div>
  );
}
