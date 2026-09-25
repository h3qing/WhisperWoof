// "Turn off encryption…": confirm it's you, then decrypt everything back to
// plain files. The only destructive action in the encryption UI.

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
import { MigrationProgress } from "./VaultFields";
import { vaultApi } from "./useVaultStatus";
import { callVault, isVaultFailure, operationFinished } from "./vault-ui-pure";

type Step = "confirm" | "working" | "done";

const HEADINGS: Record<Step, { title: string; description: string }> = {
  confirm: {
    title: "Turn off encryption",
    description:
      "WhisperWoof will decrypt your history, notes and recordings and store them as plain files on this Mac again. Anyone who can open your files can read them. Your password and recovery phrase stop working.",
  },
  working: {
    title: "Decrypting your data",
    description: "You can close this. It keeps going in the background, and dictation keeps working.",
  },
  done: { title: "Encryption is off.", description: "Your data is stored as plain files on this Mac again." },
};

export default function TurnOffEncryptionDialog({ status, onClose }: { status: VaultStatus; onClose: () => void }) {
  const reauth = useReauth(status);
  const [step, setStep] = useState<Step>("confirm");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (step === "working" && operationFinished("disable", status)) setStep("done");
  }, [step, status]);

  const turnOff = async () => {
    if (busy || !reauth.ready) return;
    setBusy(true);
    const result = await callVault(vaultApi()?.vaultDisable, reauth.credentials());
    setBusy(false);
    if (isVaultFailure(result)) return reauth.fail(result);
    reauth.setPassword("");
    setStep("working");
  };

  const { title, description } = HEADINGS[step];

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-[460px] gap-5">
        <DialogHeader className="space-y-1.5">
          <DialogTitle className="text-[19px] font-bold tracking-[-0.01em]">{title}</DialogTitle>
          <DialogDescription className="text-[13px]">{description}</DialogDescription>
        </DialogHeader>

        {step === "confirm" && <ReauthFields reauth={reauth} onSubmit={() => void turnOff()} />}
        {step === "working" && status.migrating && (
          <MigrationProgress migration={status.migrating} notesReadable={status.prefs.notesReadable} />
        )}

        <DialogFooter className="gap-2">
          {step === "confirm" ? (
            <>
              <Button variant="outline" disabled={busy} onClick={onClose}>
                Cancel
              </Button>
              <Button variant="destructive" disabled={!reauth.ready || busy} onClick={() => void turnOff()}>
                {busy ? "Turning off…" : "Turn off encryption"}
              </Button>
            </>
          ) : (
            <Button variant={step === "done" ? "default" : "outline"} onClick={onClose}>
              {step === "done" ? "Done" : "Close"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
