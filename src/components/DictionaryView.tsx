import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { BookOpen, X, CornerDownLeft, Info } from "lucide-react";
import { Input } from "./ui/input";
import { ConfirmDialog } from "./ui/dialog";
import { useSettings } from "../hooks/useSettings";
import { getAgentName } from "../utils/agentName";

export default function DictionaryView() {
  const { t } = useTranslation();
  const { customDictionary, setCustomDictionary } = useSettings();
  const agentName = getAgentName();
  const [newWord, setNewWord] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const [showInfo, setShowInfo] = useState(false);

  const isEmpty = customDictionary.length === 0;

  const handleAdd = useCallback(() => {
    const words = newWord
      .split(",")
      .map((w) => w.trim())
      .filter((w) => w && !customDictionary.includes(w));
    if (words.length > 0) {
      setCustomDictionary([...customDictionary, ...words]);
      setNewWord("");
    }
  }, [newWord, customDictionary, setCustomDictionary]);

  const handleRemove = useCallback(
    (word: string) => {
      if (word === agentName) return;
      setCustomDictionary(customDictionary.filter((w) => w !== word));
    },
    [customDictionary, setCustomDictionary, agentName]
  );

  return (
    <div className="flex flex-col h-full">
      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title={t("dictionary.clearTitle")}
        description={t("dictionary.clearDescription")}
        onConfirm={() => setCustomDictionary(customDictionary.filter((w) => w === agentName))}
        variant="destructive"
      />

      {isEmpty ? (
        /* ─── Empty state ─── */
        <div className="flex-1 flex flex-col items-center justify-center px-8 -mt-4">
          <div className="w-10 h-10 rounded-[10px] bg-card shadow-card flex items-center justify-center mb-4">
            <BookOpen
              size={17}
              strokeWidth={1.5}
              className="text-primary"
            />
          </div>

          <h2 className="text-xs font-semibold text-foreground mb-1">{t("dictionary.title")}</h2>
          <p className="text-xs text-muted-foreground text-center leading-relaxed max-w-[240px] mb-6">
            {t("dictionary.description")}
          </p>

          <div className="w-full max-w-[260px] relative">
            <Input
              placeholder={t("dictionary.addPlaceholder")}
              value={newWord}
              onChange={(e) => setNewWord(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAdd();
              }}
              className="w-full h-8 text-xs pr-8 placeholder:text-muted-foreground/70"
            />
            {newWord.trim() ? (
              <button
                onClick={handleAdd}
                aria-label={t("dictionary.addWord")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-primary/50 hover:text-primary transition-colors"
              >
                <CornerDownLeft size={11} />
              </button>
            ) : (
              <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground/70 font-mono select-none pointer-events-none">
                ⏎
              </kbd>
            )}
          </div>

          <div className="flex items-center gap-1.5 mt-3">
            {["OpenWhispr", "Dr. Smith", "gRPC"].map((ex) => (
              <span
                key={ex}
                className="text-xs text-muted-foreground px-1.5 py-0.5 rounded-[4px] border border-dashed border-border"
              >
                {ex}
              </span>
            ))}
          </div>

          <div className="mt-8 w-full max-w-[260px]">
            <button
              onClick={() => setShowInfo(!showInfo)}
              aria-expanded={showInfo}
              aria-label={t("dictionary.howItWorks")}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mx-auto"
            >
              <Info size={9} />
              {t("dictionary.howItWorks")}
            </button>
            {showInfo && (
              <div className="mt-2.5 rounded-md bg-card shadow-card px-3 py-2.5">
                <p className="text-xs text-muted-foreground leading-[1.6]">
                  {t("dictionary.howItWorksDetail")}
                </p>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* ─── Populated state ─── */
        <>
          <div className="px-5 pt-4 pb-2.5 flex items-baseline justify-between">
            <div className="flex items-baseline gap-2">
              <h2 className="text-xs font-semibold text-foreground">{t("dictionary.title")}</h2>
              <span className="text-xs text-muted-foreground font-mono tabular-nums">
                {customDictionary.length}
              </span>
            </div>
            <button
              onClick={() => setConfirmClear(true)}
              aria-label={t("dictionary.clearAll")}
              className="text-xs text-muted-foreground hover:text-destructive transition-colors"
            >
              {t("dictionary.clearAll")}
            </button>
          </div>

          <div className="px-5 pb-3">
            <div className="relative">
              <Input
                placeholder={t("dictionary.addPlaceholder")}
                value={newWord}
                onChange={(e) => setNewWord(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAdd();
                }}
                className="w-full h-7 text-xs pr-8 placeholder:text-muted-foreground/70"
              />
              {newWord.trim() ? (
                <button
                  onClick={handleAdd}
                  aria-label={t("dictionary.addWord")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-primary/50 hover:text-primary transition-colors"
                >
                  <CornerDownLeft size={10} />
                </button>
              ) : (
                <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground/70 font-mono select-none pointer-events-none">
                  ⏎
                </kbd>
              )}
            </div>
          </div>

          <div className="mx-5 h-px bg-border/60" />

          <div className="flex-1 overflow-y-auto px-5 py-3">
            <div className="flex flex-wrap gap-1.5">
              {customDictionary.map((word) => {
                const isAgentName = word === agentName;
                return (
                  <span
                    key={word}
                    className={`group inline-flex items-center gap-1 py-[3px]
                      rounded-[5px] text-xs
                      border transition-colors duration-150
                      ${
                        isAgentName
                          ? "pl-2.5 pr-2.5 bg-primary/15 text-foreground border-primary/30"
                          : "pl-2.5 pr-1 bg-card shadow-card text-foreground/80 border-transparent hover:border-border-hover hover:text-foreground"
                      }`}
                    title={isAgentName ? t("dictionary.autoManaged") : undefined}
                  >
                    {word}
                    {!isAgentName && (
                      <button
                        onClick={() => handleRemove(word)}
                        aria-label={t("dictionary.removeWord", { word })}
                        className="p-0.5 rounded-sm
                          opacity-0 group-hover:opacity-100
                          text-foreground/25 hover:!text-destructive/70
                          transition-colors duration-150"
                      >
                        <X size={10} strokeWidth={2} />
                      </button>
                    )}
                  </span>
                );
              })}
            </div>
          </div>

          <div className="px-5 pb-3 flex items-start gap-1.5">
            <Info size={9} className="text-foreground/10 mt-px shrink-0" />
            <p className="text-xs text-foreground/12 leading-relaxed">
              {t("dictionary.inputHint")}
            </p>
          </div>
        </>
      )}
    </div>
  );
}
