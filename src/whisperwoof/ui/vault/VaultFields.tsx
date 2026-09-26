// Small building blocks shared by the encryption dialogs, the settings section
// and the lock screen. Tokens only; every control is a capsule (DESIGN.md).

import React, { useId, useState } from "react";
import { Check, CircleAlert, Copy, Loader2 } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { cn } from "../../../components/lib/utils";
import type { VaultMigration } from "../../../types/electron";
import {
  PASSWORD_HINT,
  checkNewPassword,
  migrationErrorText,
  migrationLabel,
  migrationPercent,
  wordLabel,
} from "./vault-ui-pure";

/** An error line: icon, words and color together (status is never color alone). */
export function FieldError({ message, className }: { message: string | null; className?: string }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className={cn("flex items-start gap-1.5 text-[13px] text-destructive", className)}
    >
      <CircleAlert className="size-3.5 shrink-0 mt-[3px]" aria-hidden />
      <span>{message}</span>
    </p>
  );
}

type PasswordFieldProps = Omit<React.ComponentProps<"input">, "onChange" | "type"> & {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
};

export function PasswordField({
  label,
  value,
  onValueChange,
  className,
  ...rest
}: PasswordFieldProps) {
  const id = useId();
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={id} className="block text-[13px] font-semibold text-foreground">
        {label}
      </label>
      <Input
        id={id}
        type="password"
        spellCheck={false}
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        {...rest}
      />
    </div>
  );
}

export function NewPasswordFields({
  password,
  confirm,
  onPasswordChange,
  onConfirmChange,
  labels = ["Password", "Type it again"],
  autoFocus = false,
}: {
  password: string;
  confirm: string;
  onPasswordChange: (value: string) => void;
  onConfirmChange: (value: string) => void;
  labels?: [string, string];
  autoFocus?: boolean;
}) {
  const { message } = checkNewPassword(password, confirm);
  return (
    <div className="space-y-3">
      <PasswordField
        label={labels[0]}
        value={password}
        onValueChange={onPasswordChange}
        autoComplete="new-password"
        autoFocus={autoFocus}
      />
      <PasswordField
        label={labels[1]}
        value={confirm}
        onValueChange={onConfirmChange}
        autoComplete="new-password"
        aria-invalid={message ? true : undefined}
      />
      <p className="text-[13px] text-muted-foreground">{PASSWORD_HINT}</p>
      <FieldError message={message} />
    </div>
  );
}

/**
 * The recovery phrase, shown once. Copying goes only through the Copy button:
 * main puts the words on the clipboard marked concealed (clipboard managers
 * skip them), keeps them out of WhisperWoof's history and clears them after a
 * minute. Plain selection and ⌘C stay off, so there's no unprotected copy.
 */
export function PhraseGrid({ words }: { words: readonly string[] }) {
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");
  const copy = async () => {
    const result = await window.electronAPI?.vaultCopyPhrase?.().catch(() => null);
    setCopied(result?.success ? "done" : "failed");
  };
  return (
    <div className="space-y-2">
      <ol
        aria-label="Recovery phrase"
        className="grid grid-cols-3 gap-x-4 gap-y-2.5 rounded-lg bg-surface-1 p-4 select-none"
        onCopy={(e) => e.preventDefault()}
      >
        {words.map((word, i) => (
          <li key={i} className="flex items-baseline gap-2 min-w-0">
            <span className="w-5 shrink-0 text-right text-xs text-faint tabular-nums">{i + 1}</span>
            <span className="truncate text-[15px] font-semibold text-foreground">{word}</span>
          </li>
        ))}
      </ol>
      <div className="flex items-center gap-3">
        <Button type="button" variant="outline" size="sm" onClick={() => void copy()}>
          {copied === "done" ? <Check aria-hidden /> : <Copy aria-hidden />}
          {copied === "done" ? "Copied" : "Copy"}
        </Button>
        <p className="text-[13px] text-muted-foreground" aria-live="polite">
          {copied === "done"
            ? "Paste it into your password manager. The clipboard clears in 1 minute."
            : copied === "failed"
              ? "Couldn't copy. Write the words down instead."
              : "Or paste it into your password manager."}
        </p>
      </div>
    </div>
  );
}

export function ConfirmWordsFields({
  indexes,
  answers,
  onAnswer,
}: {
  indexes: readonly number[];
  answers: Readonly<Record<number, string>>;
  onAnswer: (index: number, value: string) => void;
}) {
  const baseId = useId();
  return (
    <div className="grid grid-cols-3 gap-3">
      {indexes.map((index, n) => (
        <div key={index} className="space-y-1.5">
          <label
            htmlFor={`${baseId}-${index}`}
            className="block text-[13px] font-semibold text-foreground"
          >
            {wordLabel(index)}
          </label>
          <Input
            id={`${baseId}-${index}`}
            value={answers[index] ?? ""}
            onChange={(e) => onAnswer(index, e.target.value)}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoFocus={n === 0}
          />
        </div>
      ))}
    </div>
  );
}

export function MigrationProgress({
  migration,
  notesReadable,
}: {
  migration: VaultMigration;
  notesReadable: boolean;
}) {
  const percent = migrationPercent(migration);
  const error = migrationErrorText(migration);
  return (
    <div className="space-y-2" aria-live="polite">
      <p className="flex items-center gap-2 text-sm font-semibold text-foreground tabular-nums">
        {!error && <Loader2 className="size-3.5 animate-spin text-primary" aria-hidden />}
        {migrationLabel(migration, notesReadable)}
      </p>
      {percent !== null && (
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
        >
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
            style={{ width: `${percent}%` }}
          />
        </div>
      )}
      <FieldError message={error} />
    </div>
  );
}

export function CheckRow({
  checked,
  onChange,
  label,
  description,
  disabled = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className={cn("flex items-start gap-2.5", disabled && "opacity-50")}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-4 shrink-0 accent-primary cursor-pointer disabled:cursor-not-allowed"
      />
      <label htmlFor={id} className="min-w-0 cursor-pointer">
        <span className="block text-sm font-semibold text-foreground">{label}</span>
        {description && (
          <span className="block text-[13px] text-muted-foreground mt-0.5">{description}</span>
        )}
      </label>
    </div>
  );
}

export function SegmentedControl<T extends string | number>({
  options,
  value,
  onChange,
  label,
  disabled = false,
}: {
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  label: string;
  disabled?: boolean;
}) {
  const index = Math.max(
    0,
    options.findIndex((o) => o.value === value)
  );
  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled || undefined}
      className={cn(
        "relative grid p-[3px] rounded-full bg-surface-1 shadow-[inset_0_0_0_1px_var(--color-border)]",
        disabled && "opacity-50"
      )}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      <span
        aria-hidden
        className="absolute top-[3px] bottom-[3px] left-[3px] rounded-full bg-card shadow-card dark:bg-surface-raised transition-transform duration-[320ms] ease-[cubic-bezier(.3,.7,.3,1.15)]"
        style={{
          width: `calc((100% - 6px) / ${options.length})`,
          transform: `translateX(${index * 100}%)`,
        }}
      />
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={String(option.value)}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => !selected && onChange(option.value)}
            className={cn(
              "relative z-10 px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors duration-150",
              "outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed",
              selected ? "text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** "Step 2 of 5", quiet, above a dialog title. */
export function StepCount({ number, total }: { number: number | null; total: number }) {
  if (number === null) return null;
  return (
    <p className="text-xs font-medium text-muted-foreground tabular-nums">
      Step {number} of {total}
    </p>
  );
}
