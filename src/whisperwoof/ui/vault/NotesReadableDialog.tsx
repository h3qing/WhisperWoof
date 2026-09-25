// "Keep notes readable by other apps", turned on: every note is rewritten as
// plain Markdown, so it asks who you are first — like turning encryption off.

import React, { useState } from "react";
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
import { vaultApi } from "./useVaultStatus";
import { callVault, isVaultFailure } from "./vault-ui-pure";

export default function NotesReadableDialog({ status, onClose }: { status: VaultStatus; onClose: () => void }) {
  const reauth = useReauth(status);
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    if (busy || !reauth.ready) return;
    setBusy(true);
    const result = await callVault(vaultApi()?.vaultSetPrefs, { notesReadable: true }, reauth.credentials());
    setBusy(false);
    if (isVaultFailure(result)) return reauth.fail(result);
    reauth.setPassword("");
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-[460px] gap-5">
        <DialogHeader className="space-y-1.5">
          <DialogTitle className="text-[19px] font-bold tracking-[-0.01em]">Keep notes readable</DialogTitle>
          <DialogDescription className="text-[13px]">
            Your notes will be saved as plain Markdown again, so Obsidian and iCloud can read them — and so can anyone
            who can open your files. Your history and recordings stay encrypted.
          </DialogDescription>
        </DialogHeader>
        <ReauthFields reauth={reauth} onSubmit={() => void confirm()} />
        <DialogFooter className="gap-2">
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!reauth.ready || busy} onClick={() => void confirm()}>
            {busy ? "Saving notes…" : "Keep notes readable"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
