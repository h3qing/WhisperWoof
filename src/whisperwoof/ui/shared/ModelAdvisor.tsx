/**
 * ModelAdvisor — "Help me pick" guided model selector
 *
 * Asks 3-4 simple questions, recommends the best STT model.
 * Can be embedded in Settings, Voice Style, or onboarding.
 */

import { useState } from "react";
import { Sparkles, Check, ChevronRight, RotateCcw } from "lucide-react";
import { cn } from "../../../components/lib/utils";

interface ModelRecommendation {
  id: string;
  name: string;
  size: string;
  why: string;
  speed: string;
  quality: string;
}

const MODELS: Record<string, ModelRecommendation> = {
  tiny: { id: "tiny", name: "Tiny", size: "75MB", speed: "Instant", quality: "Basic", why: "Fastest possible. Good for short commands." },
  base: { id: "base", name: "Base", size: "142MB", speed: "Very fast", quality: "Good", why: "Good balance for everyday use with limited RAM." },
  small: { id: "small", name: "Small", size: "466MB", speed: "Fast", quality: "Great", why: "Best all-rounder. Good quality, reasonable speed." },
  "distil-large-v3.5": { id: "distil-large-v3.5", name: "Distil V3.5", size: "756MB", speed: "Fast", quality: "Excellent", why: "Near-perfect accuracy, 6x faster than Large. Best pick for English." },
  "distil-large-v3": { id: "distil-large-v3", name: "Distil V3", size: "756MB", speed: "Fast", quality: "Excellent", why: "Proven distilled model. Great for English dictation." },
  medium: { id: "medium", name: "Medium", size: "1.5GB", speed: "Moderate", quality: "Excellent", why: "High accuracy for multiple languages." },
  turbo: { id: "turbo", name: "Turbo", size: "1.6GB", speed: "Fast", quality: "Excellent", why: "Fast with great quality. Good multilingual support." },
  large: { id: "large", name: "Large V3", size: "3GB", speed: "Slow", quality: "Best", why: "Maximum accuracy for any language. Needs patience." },
};

type Step = "ram" | "language" | "priority" | "result";

interface Answer {
  ram?: "low" | "medium" | "high";
  language?: "english" | "multilingual";
  priority?: "speed" | "quality" | "balanced";
}

function recommend(answers: Answer): ModelRecommendation {
  const { ram, language, priority } = answers;

  // English-only path
  if (language === "english") {
    if (ram === "low") return priority === "speed" ? MODELS.tiny : MODELS.base;
    if (ram === "medium") return priority === "speed" ? MODELS.small : MODELS["distil-large-v3.5"];
    // high RAM
    return priority === "speed" ? MODELS["distil-large-v3.5"] : MODELS["distil-large-v3.5"];
  }

  // Multilingual path
  if (ram === "low") return priority === "speed" ? MODELS.tiny : MODELS.small;
  if (ram === "medium") return priority === "speed" ? MODELS.turbo : MODELS.medium;
  // high RAM
  return priority === "speed" ? MODELS.turbo : MODELS.large;
}

function QuestionCard({
  question,
  options,
  selected,
  onSelect,
}: {
  question: string;
  options: { value: string; label: string; desc: string }[];
  selected: string | undefined;
  onSelect: (value: string) => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-foreground">{question}</p>
      <div className="space-y-2">
        {options.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onSelect(opt.value)}
            className={cn(
              "w-full text-left px-4 py-3 rounded-lg border transition-all",
              selected === opt.value
                ? "border-[#A06A3C]/40 bg-[#A06A3C]/[0.06]"
                : "border-border/15 dark:border-white/6 hover:border-border/30"
            )}
          >
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs font-medium text-foreground">{opt.label}</span>
                <p className="text-[11px] text-muted-foreground/60 mt-0.5">{opt.desc}</p>
              </div>
              {selected === opt.value && <Check size={14} className="text-[#A06A3C] shrink-0" />}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

interface ModelAdvisorProps {
  onSelect?: (modelId: string) => void;
  compact?: boolean;
}

export default function ModelAdvisor({ onSelect, compact }: ModelAdvisorProps) {
  const [step, setStep] = useState<Step>("ram");
  const [answers, setAnswers] = useState<Answer>({});

  const setAnswer = (key: keyof Answer, value: string) => {
    const updated = { ...answers, [key]: value };
    setAnswers(updated);

    // Auto-advance to next step
    if (key === "ram") setStep("language");
    else if (key === "language") setStep("priority");
    else if (key === "priority") setStep("result");
  };

  const reset = () => {
    setAnswers({});
    setStep("ram");
  };

  const result = step === "result" ? recommend(answers) : null;

  return (
    <div className={cn("space-y-4", compact && "text-sm")}>
      {/* Header */}
      {step !== "result" && (
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-[#A06A3C]" />
          <span className="text-xs font-medium text-foreground/70">Help me pick a model</span>
          <div className="flex gap-1 ml-auto">
            {["ram", "language", "priority"].map((s, i) => (
              <div
                key={s}
                className={cn(
                  "w-2 h-2 rounded-full",
                  step === s ? "bg-[#A06A3C]" : answers[s as keyof Answer] ? "bg-[#A06A3C]/40" : "bg-foreground/10"
                )}
              />
            ))}
          </div>
        </div>
      )}

      {/* Questions */}
      {step === "ram" && (
        <QuestionCard
          question="How much RAM can you spare?"
          options={[
            { value: "low", label: "Not much (< 1GB)", desc: "MacBook Air, older Mac, or many apps open" },
            { value: "medium", label: "Some (1-2GB)", desc: "Typical setup, a few apps running" },
            { value: "high", label: "Plenty (2GB+)", desc: "Lots of RAM, willing to wait for best quality" },
          ]}
          selected={answers.ram}
          onSelect={(v) => setAnswer("ram", v)}
        />
      )}

      {step === "language" && (
        <QuestionCard
          question="What language do you speak?"
          options={[
            { value: "english", label: "Mostly English", desc: "English with occasional proper nouns from other languages" },
            { value: "multilingual", label: "Multiple languages", desc: "I regularly switch between languages or speak non-English" },
          ]}
          selected={answers.language}
          onSelect={(v) => setAnswer("language", v)}
        />
      )}

      {step === "priority" && (
        <QuestionCard
          question="What matters more to you?"
          options={[
            { value: "speed", label: "Speed", desc: "I want text instantly. Some errors are OK." },
            { value: "balanced", label: "Balanced", desc: "Good speed and good accuracy." },
            { value: "quality", label: "Accuracy", desc: "I want perfect text. I can wait a bit." },
          ]}
          selected={answers.priority}
          onSelect={(v) => setAnswer("priority", v)}
        />
      )}

      {/* Result */}
      {step === "result" && result && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Sparkles size={14} className="text-[#A06A3C]" />
            <span className="text-xs font-medium text-foreground/70">Recommended for you</span>
          </div>

          <div className="rounded-lg border border-[#A06A3C]/30 bg-[#A06A3C]/[0.04] p-4 space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-foreground">{result.name}</h3>
              <span className="text-[11px] text-muted-foreground/50">{result.size}</span>
            </div>
            <p className="text-xs text-foreground/70">{result.why}</p>
            <div className="flex gap-3 text-[10px] text-muted-foreground/50">
              <span>Speed: {result.speed}</span>
              <span>Quality: {result.quality}</span>
            </div>
          </div>

          <div className="flex gap-2">
            {onSelect && (
              <button
                onClick={() => onSelect(result.id)}
                className="flex items-center gap-1.5 text-xs font-medium text-white bg-[#A06A3C] hover:bg-[#B8863C] px-4 py-2 rounded-lg transition-colors"
              >
                <Check size={12} /> Use {result.name}
              </button>
            )}
            <button
              onClick={reset}
              className="flex items-center gap-1.5 text-xs text-muted-foreground/60 hover:text-foreground px-3 py-2 rounded-lg border border-border/15 dark:border-white/6 transition-colors"
            >
              <RotateCcw size={11} /> Try again
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
