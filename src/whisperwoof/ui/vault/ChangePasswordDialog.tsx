// "Change password…": re-wraps the key with a new password; nothing is re-encrypted.

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
import { useToast } from "../../../components/ui/Toast";
import { FieldError, NewPasswordFields, PasswordField } from "./VaultFields";
import { vaultApi } from "./useVaultStatus";
import { callVault, checkNewPassword, isVaultFailure, vaultErrorMessage } from "./vault-ui-pure";

export default function ChangePasswordDialog({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [currentError, setCurrentError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const ready = current.length > 0 && checkNewPassword(next, again).ok;

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    const result = await callVault(vaultApi()?.vaultChangePassword, {
      currentPassword: current,
      newPassword: next,
    });
    setBusy(false);
    if (!isVaultFailure(result)) {
      toast({ title: "Password changed", variant: "success", duration: 2500 });
      onClose();
    } else if (result.code === "WRONG_PASSWORD") {
      setCurrentError(vaultErrorMessage(result));
    } else {
      setMessage(vaultErrorMessage(result));
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-[440px] gap-5">
        <DialogHeader className="space-y-1.5">
          <DialogTitle className="text-[19px] font-bold tracking-[-0.01em]">Change password</DialogTitle>
          <DialogDescription className="text-[13px]">
            Your old password stops working. Touch ID and your recovery phrase don't change.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="space-y-2">
            <PasswordField
              label="Current password"
              value={current}
              onValueChange={(value) => {
                setCurrent(value);
                setCurrentError(null);
              }}
              autoComplete="current-password"
              autoFocus
              aria-invalid={currentError ? true : undefined}
            />
            <FieldError message={currentError} />
          </div>
          <NewPasswordFields
            password={next}
            confirm={again}
            onPasswordChange={setNext}
            onConfirmChange={setAgain}
            labels={["New password", "Type it again"]}
          />
          <FieldError message={message} />
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!ready || busy}>
              {busy ? "Changing…" : "Change password"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
