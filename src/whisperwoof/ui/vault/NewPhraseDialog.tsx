// "Make a new recovery phrase…": confirm it's you, show the new words once,
// check three of them, then re-key. The old phrase stops working.

import React, { useEffect, useState } from "react";
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
import { ReauthFields, useReauth } from "./ReauthFields";
import { ConfirmWordsFields, FieldError, MigrationProgress, PhraseGrid } from "./VaultFields";
import { vaultApi } from "./useVaultStatus";
import {
  callVault,
  checkConfirmWords,
  confirmWordsPayload,
  isVaultFailure,
  operationFinished,
  vaultErrorMessage,
} from "./vault-ui-pure";

type Step = "reauth" | "phrase" | "confirm" | "working" | "done";

const HEADINGS: Record<Step, { title: string; description: string }> = {
  reauth: {
    title: "Make a new recovery phrase",
    description:
      "WhisperWoof makes 12 new words and switches your data over to them. Your old recovery phrase will stop working.",
  },
  phrase: {
    title: "Write down your new recovery phrase",
    description:
      "These 12 words open your data on any Mac, even if you forget your password. Write them down or save them in your password manager. They won't be shown again.",
  },
  confirm: { title: "Check your new recovery phrase", description: "Type these words from your new recovery phrase." },
  working: {
    title: "Switching to your new recovery phrase",
    description: "You can close this. It keeps going in the background, and dictation keeps working.",
  },
  done: { title: "Your new recovery phrase is ready.", description: "Your old recovery phrase no longer works." },
};

export default function NewPhraseDialog({ status, onClose }: { status: VaultStatus; onClose: () => void }) {
  // Main wraps the new key with your password, so Touch ID alone can't start this.
  const reauth = useReauth(status, { allowTouchId: false });
  const [step, setStep] = useState<Step>("reauth");
  const [words, setWords] = useState<readonly string[]>([]);
  const [indexes, setIndexes] = useState<readonly number[]>([]);
  const [answers, setAnswers] = useState<Readonly<Record<number, string>>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (step === "working" && operationFinished("rotate", status)) setStep("done");
  }, [step, status]);

  const begin = async () => {
    const result = await callVault(vaultApi()?.vaultBeginNewPhrase, reauth.credentials());
    if (isVaultFailure(result)) return reauth.fail(result);
    reauth.setPassword("");
    setWords(result.words);
    setIndexes(result.confirmIndexes);
    setStep("phrase");
  };

  const finish = async () => {
    const check = checkConfirmWords(words, indexes, answers);
    if (check.message) return setMessage(check.message);
    const result = await callVault(vaultApi()?.vaultCompleteNewPhrase, {
      confirmWords: confirmWordsPayload(indexes, answers),
    });
    if (isVaultFailure(result)) return setMessage(vaultErrorMessage(result, "confirm"));
    setWords([]);
    setAnswers({});
    setStep("working");
  };

  const onPrimary = async () => {
    if (busy) return;
    if (step === "phrase") return setStep("confirm");
    setBusy(true);
    try {
      if (step === "reauth") await begin();
      else if (step === "confirm") await finish();
    } finally {
      setBusy(false);
    }
  };

  const confirmComplete = checkConfirmWords(words, indexes, answers).complete;
  const canPress = step === "reauth" ? reauth.ready : step === "confirm" ? confirmComplete : true;
  const primaryLabel =
    step === "reauth" ? (busy ? "Checking…" : "Continue")
      : step === "phrase" ? "I wrote them down"
        : busy ? "Making…" : "Make a new recovery phrase";
  const { title, description } = HEADINGS[step];
  const finished = step === "working" || step === "done";

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent
        className="sm:max-w-[520px] max-h-[85vh] overflow-y-auto gap-5"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader className="space-y-1.5">
          <DialogTitle className="text-[19px] font-bold tracking-[-0.01em]">{title}</DialogTitle>
          <DialogDescription className="text-[13px]">{description}</DialogDescription>
        </DialogHeader>

        {step === "reauth" && <ReauthFields reauth={reauth} onSubmit={() => void onPrimary()} />}
        {step === "phrase" && <PhraseGrid words={words} />}
        {step === "confirm" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void onPrimary();
            }}
          >
            <ConfirmWordsFields
              indexes={indexes}
              answers={answers}
              onAnswer={(index, value) => {
                setMessage(null);
                setAnswers({ ...answers, [index]: value });
              }}
            />
          </form>
        )}
        {step === "working" && status.migrating && (
          <MigrationProgress migration={status.migrating} notesReadable={status.prefs.notesReadable} />
        )}

        <FieldError message={message} />

        <DialogFooter className="gap-2">
          {finished ? (
            <Button variant={step === "done" ? "default" : "outline"} onClick={onClose}>
              {step === "done" ? "Done" : "Close"}
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => (step === "confirm" ? setStep("phrase") : onClose())}
              >
                {step === "confirm" ? "Back" : "Cancel"}
              </Button>
              <Button disabled={!canPress || busy} onClick={() => void onPrimary()}>
                {primaryLabel}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
