// "Turn on encryption…": one dialog, five steps (docs/design/at-rest-encryption.md
// 4.7), then the migration's progress until the data is encrypted.

import React, { useEffect, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "../../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import type { VaultStatus } from "../../../types/electron";
import {
  CheckRow,
  ConfirmWordsFields,
  FieldError,
  MigrationProgress,
  NewPasswordFields,
  PhraseGrid,
  StepCount,
} from "./VaultFields";
import { vaultApi } from "./useVaultStatus";
import {
  NOTES_READABLE_WARNING,
  NO_BACK_DOOR_WARNING,
  TURN_ON_INPUT_STEPS,
  callVault,
  checkConfirmWords,
  confirmWordsPayload,
  initialTurnOnState,
  isVaultFailure,
  nextTurnOnStep,
  operationFinished,
  previousTurnOnStep,
  touchIdRowDescription,
  turnOnCanContinue,
  turnOnStepNumber,
  vaultErrorMessage,
  withoutSecrets,
  type TurnOnState,
  type TurnOnStep,
} from "./vault-ui-pure";

const finishedStep = (step: TurnOnStep) => step === "working" || step === "done";

interface Props {
  readonly status: VaultStatus;
  readonly onClose: () => void;
}

function heading(step: TurnOnStep, status: VaultStatus): { title: string; description?: string } {
  const touchId = status.touchId.available;
  switch (step) {
    case "explain":
      return { title: "Turn on encryption" };
    case "password":
      return { title: "Choose a password", description: "You'll type it to unlock WhisperWoof when you don't use Touch ID." };
    case "phrase":
      return {
        title: "Write down your recovery phrase",
        description:
          "These 12 words open your data on any Mac, even if you forget your password. Write them down or save them in your password manager. They won't be shown again.",
      };
    case "confirm":
      return { title: "Check your recovery phrase", description: "Type these words from your recovery phrase." };
    case "touchId":
      return touchId
        ? { title: "Unlock with Touch ID", description: "Your password always works too." }
        : {
            title: "Ready to turn on encryption",
            description: `${touchIdRowDescription(status.touchId)} You'll unlock with your password.`,
          };
    case "working":
      return {
        title: "Encrypting your data",
        description: "You can close this. Encryption keeps going in the background, and dictation keeps working.",
      };
    default:
      return {
        title: "Done — your data is encrypted.",
        description: status.prefs.lockOnSleep
          ? "WhisperWoof locks when your Mac locks or sleeps, and when you quit."
          : "WhisperWoof locks when you quit.",
      };
  }
}

function ExplainStep({ state, update }: { state: TurnOnState; update: (p: Partial<TurnOnState>) => void }) {
  return (
    <div className="space-y-4 text-sm text-foreground">
      <p>
        WhisperWoof will encrypt everything it keeps about you: history, notes, recordings, clipboard images and
        Memory. It unlocks with Touch ID or your password, and dictation keeps working while it's locked.
      </p>
      <p className="text-[13px] text-muted-foreground">
        Not encrypted: your settings and API keys, and text once it leaves WhisperWoof (what you paste, the clipboard,
        cloud providers). Old Time Machine backups and disk snapshots still have unencrypted copies of what's there
        today.
      </p>
      <div className="flex items-start gap-2.5 rounded-lg bg-surface-1 p-3.5">
        <TriangleAlert className="size-4 shrink-0 mt-0.5 text-warning" aria-hidden />
        <p className="font-semibold">{NO_BACK_DOOR_WARNING}</p>
      </div>
      <CheckRow
        checked={state.notesReadable}
        onChange={(notesReadable) => update({ notesReadable })}
        label="Keep notes readable by other apps"
        description={NOTES_READABLE_WARNING}
      />
      <CheckRow checked={state.understood} onChange={(understood) => update({ understood })} label="I understand" />
    </div>
  );
}

export default function TurnOnEncryptionDialog({ status, onClose }: Props) {
  const [state, setState] = useState<TurnOnState>(() => initialTurnOnState(status.touchId.available));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [touchIdNote, setTouchIdNote] = useState<string | null>(null);
  const update = (patch: Partial<TurnOnState>) => setState((s) => ({ ...s, ...patch }));
  const go = (step: TurnOnStep) => {
    setMessage(null);
    update({ step });
  };

  // The migration reports through the pushed status; land on "done" with it.
  useEffect(() => {
    if (state.step === "working" && operationFinished("enable", status)) update({ step: "done" });
  }, [state.step, status]);

  const beginPhrase = async () => {
    if (state.words.length > 0) return go("phrase");
    const phrase = await callVault(vaultApi()?.vaultBeginSetup);
    if (isVaultFailure(phrase)) return setMessage(vaultErrorMessage(phrase));
    setMessage(null);
    update({ words: phrase.words, confirmIndexes: phrase.confirmIndexes, step: "phrase" });
  };

  const complete = async () => {
    const result = await callVault(vaultApi()?.vaultCompleteSetup, {
      password: state.password,
      confirmWords: confirmWordsPayload(state.confirmIndexes, state.answers),
      useTouchId: state.useTouchId && status.touchId.available,
      notesReadable: state.notesReadable,
    });
    if (!isVaultFailure(result)) {
      setMessage(null);
      if (result.touchIdError) {
        setTouchIdNote("Touch ID wasn't set up. You can turn it on in these settings once encryption finishes.");
      }
      setState((s) => ({ ...withoutSecrets(s), step: "working" }));
    } else if (result.code === "WRONG_PHRASE") {
      update({ step: "confirm" });
      setMessage(vaultErrorMessage(result, "confirm"));
    } else if (result.code === "CANCELLED") {
      setMessage("Touch ID wasn't set up. Try again, or untick Unlock with Touch ID.");
    } else {
      setMessage(vaultErrorMessage(result));
    }
  };

  const onContinue = async () => {
    if (busy) return;
    if (state.step === "confirm") {
      const check = checkConfirmWords(state.words, state.confirmIndexes, state.answers);
      if (check.message) return setMessage(check.message);
    }
    if (!turnOnCanContinue(state)) return;
    setBusy(true);
    try {
      if (state.step === "password") await beginPhrase();
      else if (state.step === "touchId") await complete();
      else go(nextTurnOnStep(state.step));
    } finally {
      setBusy(false);
    }
  };

  const { title, description } = heading(state.step, status);
  const back = previousTurnOnStep(state.step);
  const confirmComplete = checkConfirmWords(state.words, state.confirmIndexes, state.answers).complete;
  const canPress = state.step === "confirm" ? confirmComplete : turnOnCanContinue(state);
  const primaryLabel =
    state.step === "phrase"
      ? "I wrote them down"
      : state.step === "touchId"
        ? busy ? "Turning on…" : "Turn on encryption"
        : state.step === "password" && busy
          ? "Making your phrase…"
          : "Continue";
  const finished = finishedStep(state.step);

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent
        className="sm:max-w-[520px] max-h-[85vh] overflow-y-auto gap-5"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader className="space-y-1.5">
          <StepCount number={turnOnStepNumber(state.step)} total={TURN_ON_INPUT_STEPS} />
          <DialogTitle className="text-[19px] font-bold tracking-[-0.01em]">{title}</DialogTitle>
          {description && <DialogDescription className="text-[13px]">{description}</DialogDescription>}
        </DialogHeader>

        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            void onContinue();
          }}
        >
          {state.step === "explain" && <ExplainStep state={state} update={update} />}
          {state.step === "password" && (
            <NewPasswordFields
              password={state.password}
              confirm={state.confirmPassword}
              onPasswordChange={(password) => update({ password })}
              onConfirmChange={(confirmPassword) => update({ confirmPassword })}
              autoFocus
            />
          )}
          {state.step === "phrase" && <PhraseGrid words={state.words} />}
          {state.step === "confirm" && (
            <ConfirmWordsFields
              indexes={state.confirmIndexes}
              answers={state.answers}
              onAnswer={(index, value) => {
                setMessage(null);
                update({ answers: { ...state.answers, [index]: value } });
              }}
            />
          )}
          {state.step === "touchId" && (
            <div className="space-y-4">
              {status.touchId.available && (
                <CheckRow
                  checked={state.useTouchId}
                  onChange={(useTouchId) => update({ useTouchId })}
                  label="Unlock with Touch ID"
                  description="You'll touch the sensor once to set it up."
                />
              )}
              <p className="text-[13px] text-muted-foreground">
                Encrypting takes a few minutes if you have a lot of recordings. Dictation keeps working while it runs.
              </p>
            </div>
          )}
          {state.step === "working" && status.migrating && (
            <MigrationProgress migration={status.migrating} notesReadable={status.prefs.notesReadable} />
          )}
          {finishedStep(state.step) && touchIdNote && (
            <p className="text-[13px] text-muted-foreground">{touchIdNote}</p>
          )}

          <FieldError message={message} />

          <DialogFooter className="gap-2">
            {finished ? (
              <Button type="button" variant={state.step === "done" ? "default" : "outline"} onClick={onClose}>
                {state.step === "done" ? "Done" : "Close"}
              </Button>
            ) : (
              <>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => (back ? go(back) : onClose())}
                >
                  {back ? "Back" : "Cancel"}
                </Button>
                <Button type="submit" disabled={!canPress || busy}>
                  {primaryLabel}
                </Button>
              </>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
