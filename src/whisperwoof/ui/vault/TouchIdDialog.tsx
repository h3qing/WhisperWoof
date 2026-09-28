// "Unlock with Touch ID", turned on: it trusts every fingerprint this Mac has
// right now, so it asks for the password first (a finger someone added can't
// vouch for itself). Then one touch to test it.

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

export default function TouchIdDialog({ status, onClose }: { status: VaultStatus; onClose: () => void }) {
  const reauth = useReauth(status, { allowTouchId: false });
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    if (busy || !reauth.ready) return;
    setBusy(true);
    const result = await callVault(vaultApi()?.vaultSetTouchId, {
      enabled: true,
      reauth: reauth.credentials(),
    });
    setBusy(false);
    if (isVaultFailure(result)) return reauth.fail(result);
    reauth.setPassword("");
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-[460px] gap-5">
        <DialogHeader className="space-y-1.5">
          <DialogTitle className="text-[19px] font-bold tracking-[-0.01em]">Turn on Touch ID</DialogTitle>
          <DialogDescription className="text-[13px]">
            Any fingerprint added to this Mac will unlock WhisperWoof. Enter your password to confirm, then touch the
            sensor once to test it.
          </DialogDescription>
        </DialogHeader>
        <ReauthFields reauth={reauth} onSubmit={() => void confirm()} />
        <DialogFooter className="gap-2">
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!reauth.ready || busy} onClick={() => void confirm()}>
            {busy ? "Turning on…" : "Turn on Touch ID"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
