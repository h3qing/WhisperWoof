// The control panel while WhisperWoof is locked: Touch ID, the password, or
// the recovery phrase (docs/design/at-rest-encryption.md 4.6 and 5). Main
// enforces the lock; this screen only asks for the way in.

import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { Fingerprint } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Textarea } from "../../../components/ui/textarea";
import mandoHead from "../../../assets/mando-head.svg";
import type { VaultStatus } from "../../../types/electron";
import { FieldError, NewPasswordFields } from "./VaultFields";
import { vaultApi } from "./useVaultStatus";
import {
  RECOVERY_WORD_COUNT,
  afterAuthFailure,
  callVault,
  checkNewPassword,
  initialAuthMode,
  isVaultFailure,
  lockScreenView,
  parseRecoveryPhrase,
  recoveryPhraseProblem,
  vaultErrorMessage,
  type AuthMode,
} from "./vault-ui-pure";

const linkClass =
  "text-[13px] font-medium text-primary underline-offset-4 hover:underline outline-none focus-visible:underline";

function UnlockForm({
  status,
  wasPrompted,
  markPrompted,
  onUnlocked,
  onForgot,
}: {
  status: VaultStatus;
  /** Shared with the parent so the recovery view and back never re-prompts. */
  wasPrompted: () => boolean;
  markPrompted: () => void;
  onUnlocked: () => void;
  onForgot: () => void;
}) {
  const { canUseTouchId } = lockScreenView(status);
  const passwordId = useId();
  const [mode, setMode] = useState<AuthMode>(() => initialAuthMode(status));
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const switchTo = (next: AuthMode) => {
    setMode(next);
    setMessage(null);
  };

  const unlockWithTouchId = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    const result = await callVault(vaultApi()?.vaultUnlockWithTouchId);
    setBusy(false);
    if (!isVaultFailure(result)) return onUnlocked();
    const next = afterAuthFailure("touchId", result);
    setMode(next.mode);
    setMessage(next.message);
  }, [onUnlocked]);

  // Ask for Touch ID once, when the lock screen is first in front of the
  // user (not behind the Mac's own lock screen), and never again after a
  // cancel: the button is there for that.
  useEffect(() => {
    if (!canUseTouchId || wasPrompted()) return;
    const prompt = () => {
      if (wasPrompted()) return;
      markPrompted();
      void unlockWithTouchId();
    };
    if (document.hasFocus()) return prompt();
    window.addEventListener("focus", prompt, { once: true });
    return () => window.removeEventListener("focus", prompt);
  }, [canUseTouchId, wasPrompted, markPrompted, unlockWithTouchId]);

  const unlockWithPassword = async () => {
    if (!password || busy) return;
    setBusy(true);
    setMessage(null);
    const result = await callVault(vaultApi()?.vaultUnlockWithPassword, password);
    setBusy(false);
    if (!isVaultFailure(result)) {
      setPassword("");
      return onUnlocked();
    }
    setMessage(afterAuthFailure("password", result).message);
  };

  return (
    <div className="space-y-4">
      {mode === "touchId" ? (
        <div className="space-y-3">
          <Button className="w-full" disabled={busy} onClick={() => void unlockWithTouchId()}>
            <Fingerprint aria-hidden />
            {busy ? "Waiting for Touch ID…" : "Unlock with Touch ID"}
          </Button>
          <FieldError message={message} />
          <p className="text-center">
            <button type="button" className={linkClass} onClick={() => switchTo("password")}>
              Use password
            </button>
          </p>
        </div>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void unlockWithPassword();
          }}
        >
          <label htmlFor={passwordId} className="sr-only">
            Password
          </label>
          <Input
            id={passwordId}
            type="password"
            placeholder="Password"
            autoComplete="current-password"
            spellCheck={false}
            autoFocus
            value={password}
            aria-invalid={message ? true : undefined}
            onChange={(e) => {
              setPassword(e.target.value);
              setMessage(null);
            }}
          />
          <FieldError message={message} />
          <Button type="submit" className="w-full" disabled={!password || busy}>
            {busy ? "Unlocking…" : "Unlock"}
          </Button>
          {canUseTouchId && (
            <p className="text-center">
              <button type="button" className={linkClass} onClick={() => switchTo("touchId")}>
                Use Touch ID
              </button>
            </p>
          )}
        </form>
      )}
      <p className="text-center">
        <button type="button" className={linkClass} onClick={onForgot}>
          Forgot your password? Use your recovery phrase
        </button>
      </p>
    </div>
  );
}

function RecoverForm({ onBack, onUnlocked }: { onBack: () => void; onUnlocked: () => void }) {
  const phraseId = useId();
  const [phrase, setPhrase] = useState("");
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const words = parseRecoveryPhrase(phrase);
  const ready = words.length === RECOVERY_WORD_COUNT && checkNewPassword(password, again).ok;

  const recover = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setMessage(null);
    const result = await callVault(vaultApi()?.vaultRecover, { phrase: words.join(" "), newPassword: password });
    setBusy(false);
    if (!isVaultFailure(result)) return onUnlocked();
    setMessage(vaultErrorMessage(result));
  };

  return (
    <form
      className="space-y-4 text-left"
      onSubmit={(e) => {
        e.preventDefault();
        void recover();
      }}
    >
      <p className="text-center text-[13px] text-muted-foreground">
        Enter your 12-word recovery phrase, then choose a new password.
      </p>
      <div className="space-y-1.5">
        <label htmlFor={phraseId} className="block text-[13px] font-semibold text-foreground">
          Recovery phrase
        </label>
        <Textarea
          id={phraseId}
          rows={3}
          value={phrase}
          autoFocus
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          onChange={(e) => {
            setPhrase(e.target.value);
            setMessage(null);
          }}
        />
        {recoveryPhraseProblem(phrase) && (
          <p className="text-[13px] text-muted-foreground tabular-nums">{recoveryPhraseProblem(phrase)}</p>
        )}
      </div>
      <NewPasswordFields
        password={password}
        confirm={again}
        onPasswordChange={setPassword}
        onConfirmChange={setAgain}
        labels={["New password", "Type it again"]}
      />
      <FieldError message={message} />
      <Button type="submit" className="w-full" disabled={!ready || busy}>
        {busy ? "Unlocking…" : "Set password and unlock"}
      </Button>
      <p className="text-center">
        <button type="button" className={linkClass} onClick={onBack}>
          Back
        </button>
      </p>
    </form>
  );
}

export default function VaultLockScreen({ status, onUnlocked }: { status: VaultStatus; onUnlocked: () => void }) {
  const view = lockScreenView(status);
  const [screen, setScreen] = useState<"unlock" | "recover">("unlock");
  // Shared by the unlock and recovery views, so going back never re-prompts.
  const touchIdPrompted = useRef(false);
  const wasTouchIdPrompted = useCallback(() => touchIdPrompted.current, []);
  const markTouchIdPrompted = useCallback(() => {
    touchIdPrompted.current = true;
  }, []);

  return (
    <div className="relative h-screen flex flex-col">
      <div className="mando-field" aria-hidden />
      <div className="relative z-10 h-[60px] shrink-0" style={{ WebkitAppRegion: "drag" } as React.CSSProperties} />
      <main className="relative z-10 flex-1 overflow-y-auto flex px-6 pb-[60px]">
        <section
          aria-labelledby="vault-lock-title"
          className="relative m-auto w-full max-w-[380px] glass-thick glass-rim rounded-window px-8 py-9"
        >
          <img src={mandoHead} alt="" className="mx-auto size-14" />
          <h1
            id="vault-lock-title"
            className="mt-4 text-center text-[26px] leading-tight font-extrabold tracking-[-0.022em] text-foreground"
          >
            WhisperWoof is locked
          </h1>
          <p className="mt-2 text-center text-sm text-muted-foreground [text-wrap:balance] tabular-nums">
            Dictation still works. New entries are saved sealed until you unlock.
            {view.waitingLine && ` ${view.waitingLine}`}
          </p>
          {view.finishingLine && (
            <p className="mt-2 text-center text-sm font-semibold text-foreground">{view.finishingLine}</p>
          )}
          <div className="mt-6">
            {screen === "unlock" ? (
              <UnlockForm
                status={status}
                wasPrompted={wasTouchIdPrompted}
                markPrompted={markTouchIdPrompted}
                onUnlocked={onUnlocked}
                onForgot={() => setScreen("recover")}
              />
            ) : (
              <RecoverForm onBack={() => setScreen("unlock")} onUnlocked={onUnlocked} />
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
