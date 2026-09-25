// "Confirm it's you" for the dialogs that change the vault (new recovery
// phrase, turn off encryption): Touch ID when it's on, or the password. The
// dialog owns the action button; this owns the mode, the field and the error.

import React, { useCallback, useState } from "react";
import { Fingerprint } from "lucide-react";
import type { VaultFailure, VaultReauth, VaultStatus } from "../../../types/electron";
import { FieldError, PasswordField } from "./VaultFields";
import { afterAuthFailure, canUseTouchId, initialAuthMode, type AuthMode } from "./vault-ui-pure";

/** `allowTouchId: false` for calls main only accepts with the password (a new recovery phrase). */
export function useReauth(status: VaultStatus, { allowTouchId = true } = {}) {
  const touchIdOk = allowTouchId && canUseTouchId(status);
  const [mode, setModeState] = useState<AuthMode>(() => (touchIdOk ? initialAuthMode(status) : "password"));
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const setMode = useCallback((next: AuthMode) => {
    setModeState(next);
    setMessage(null);
  }, []);

  const credentials = useCallback(
    (): VaultReauth => (mode === "touchId" ? { touchId: true } : { password }),
    [mode, password]
  );

  const fail = useCallback(
    (result: VaultFailure) => {
      const next = afterAuthFailure(mode, result);
      setModeState(next.mode);
      setMessage(next.message);
    },
    [mode]
  );

  return {
    touchIdOk,
    mode,
    setMode,
    password,
    setPassword,
    message,
    setMessage,
    credentials,
    fail,
    ready: mode === "touchId" || password.length > 0,
  };
}

export type Reauth = ReturnType<typeof useReauth>;

const linkClass =
  "text-[13px] font-medium text-primary underline-offset-4 hover:underline outline-none focus-visible:underline";

export function ReauthFields({ reauth, onSubmit }: { reauth: Reauth; onSubmit: () => void }) {
  if (reauth.mode === "touchId") {
    return (
      <div className="space-y-1.5">
        <p className="flex items-center gap-2 text-sm text-foreground">
          <Fingerprint className="size-4 text-primary" aria-hidden />
          You'll confirm with Touch ID.
        </p>
        <button type="button" className={linkClass} onClick={() => reauth.setMode("password")}>
          Use your password instead
        </button>
        <FieldError message={reauth.message} />
      </div>
    );
  }
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (reauth.ready) onSubmit();
      }}
    >
      <PasswordField
        label="Your password"
        value={reauth.password}
        onValueChange={(value) => {
          reauth.setPassword(value);
          reauth.setMessage(null);
        }}
        autoComplete="current-password"
        autoFocus
        aria-invalid={reauth.message ? true : undefined}
      />
      <FieldError message={reauth.message} />
      {reauth.touchIdOk && (
        <button type="button" className={linkClass} onClick={() => reauth.setMode("touchId")}>
          Use Touch ID instead
        </button>
      )}
    </form>
  );
}
