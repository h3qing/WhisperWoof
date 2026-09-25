// Settings → Encryption (docs/design/at-rest-encryption.md section 5).
// Hidden when the vault isn't available (off macOS, or no preload API).

import React, { useState } from "react";
import { Button } from "../../../components/ui/button";
import { Toggle } from "../../../components/ui/toggle";
import {
  SectionHeader,
  SettingsPanel,
  SettingsPanelRow,
  SettingsRow,
} from "../../../components/ui/SettingsSection";
import type { VaultFailure, VaultPrefs, VaultResult } from "../../../types/electron";
import ChangePasswordDialog from "./ChangePasswordDialog";
import NewPhraseDialog from "./NewPhraseDialog";
import TurnOffEncryptionDialog from "./TurnOffEncryptionDialog";
import TurnOnEncryptionDialog from "./TurnOnEncryptionDialog";
import { FieldError, MigrationProgress, SegmentedControl } from "./VaultFields";
import { useVaultStatus, vaultApi } from "./useVaultStatus";
import {
  IDLE_LOCK_OPTIONS,
  NOTES_READABLE_WARNING,
  callVault,
  encryptionSummary,
  isVaultFailure,
  lockNowDescription,
  settingsMode,
  touchIdRowDescription,
  vaultErrorMessage,
} from "./vault-ui-pure";

type DialogKind = "turnOn" | "changePassword" | "newPhrase" | "turnOff" | null;

export default function EncryptionSettings() {
  const { status, refresh } = useVaultStatus();
  const [dialog, setDialog] = useState<DialogKind>(null);
  // What the user just asked for, shown until the main process answers.
  const [draft, setDraft] = useState<Partial<VaultPrefs>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const mode = settingsMode(status);
  if (mode === "hidden" || !status) return null;

  const api = vaultApi();
  const prefs: VaultPrefs = { ...status.prefs, ...draft };
  const disabled = busy || status.migrating !== null;
  const close = () => setDialog(null);

  const run = async (patch: Partial<VaultPrefs>, call: () => Promise<VaultResult | VaultFailure>) => {
    setDraft(patch);
    setBusy(true);
    setMessage(null);
    const result = await call();
    if (isVaultFailure(result)) setMessage(vaultErrorMessage(result));
    await refresh();
    setDraft({});
    setBusy(false);
  };
  const setPref = (patch: Partial<Omit<VaultPrefs, "touchId">>) =>
    run(patch, () => callVault(api?.vaultSetPrefs, patch));

  return (
    <div className="space-y-4">
      <SectionHeader title="Encryption" description={encryptionSummary(status)} />

      {status.migrating && (
        <SettingsPanel>
          <SettingsPanelRow>
            <MigrationProgress migration={status.migrating} notesReadable={status.prefs.notesReadable} />
          </SettingsPanelRow>
        </SettingsPanel>
      )}

      {mode === "off" ? (
        <Button disabled={disabled} onClick={() => setDialog("turnOn")}>
          Turn on encryption…
        </Button>
      ) : (
        <>
          <SettingsPanel>
            <SettingsPanelRow>
              <SettingsRow label="Unlock with Touch ID" description={touchIdRowDescription(status.touchId)}>
                <Toggle
                  checked={prefs.touchId}
                  disabled={disabled || !status.touchId.available}
                  onChange={(touchId) => run({ touchId }, () => callVault(api?.vaultSetTouchId, touchId))}
                />
              </SettingsRow>
            </SettingsPanelRow>
            <SettingsPanelRow>
              <SettingsRow label="Lock when my Mac locks or sleeps">
                <Toggle
                  checked={prefs.lockOnSleep}
                  disabled={disabled}
                  onChange={(lockOnSleep) => setPref({ lockOnSleep })}
                />
              </SettingsRow>
            </SettingsPanelRow>
            <SettingsPanelRow>
              <SettingsRow label="Lock after I'm idle">
                <SegmentedControl
                  label="Lock after I'm idle"
                  options={IDLE_LOCK_OPTIONS}
                  value={prefs.idleMinutes}
                  disabled={disabled}
                  onChange={(idleMinutes) => setPref({ idleMinutes })}
                />
              </SettingsRow>
            </SettingsPanelRow>
            <SettingsPanelRow>
              <SettingsRow label="Keep notes readable by other apps" description={NOTES_READABLE_WARNING}>
                <Toggle
                  checked={prefs.notesReadable}
                  disabled={disabled}
                  onChange={(notesReadable) => setPref({ notesReadable })}
                />
              </SettingsRow>
            </SettingsPanelRow>
          </SettingsPanel>

          <SettingsPanel>
            <SettingsPanelRow>
              <SettingsRow label="Lock WhisperWoof" description={lockNowDescription(status)}>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={disabled}
                  onClick={() => run({}, () => callVault(api?.vaultLock))}
                >
                  Lock now
                </Button>
              </SettingsRow>
            </SettingsPanelRow>
            <SettingsPanelRow>
              <SettingsRow label="Password" description="The password you unlock with.">
                <Button variant="outline" size="sm" disabled={disabled} onClick={() => setDialog("changePassword")}>
                  Change password…
                </Button>
              </SettingsRow>
            </SettingsPanelRow>
            <SettingsPanelRow>
              <SettingsRow
                label="Recovery phrase"
                description="Make a new one if you lost yours or someone saw it. The old one stops working."
              >
                <Button variant="outline" size="sm" disabled={disabled} onClick={() => setDialog("newPhrase")}>
                  Make a new recovery phrase…
                </Button>
              </SettingsRow>
            </SettingsPanelRow>
          </SettingsPanel>

          <SettingsPanel>
            <SettingsPanelRow>
              <SettingsRow
                label="Decrypt your data"
                description="Stores everything as plain files on this Mac again."
              >
                <Button
                  variant="outline"
                  size="sm"
                  className="text-destructive"
                  disabled={disabled}
                  onClick={() => setDialog("turnOff")}
                >
                  Turn off encryption…
                </Button>
              </SettingsRow>
            </SettingsPanelRow>
          </SettingsPanel>
        </>
      )}

      <FieldError message={message} />

      {dialog === "turnOn" && <TurnOnEncryptionDialog status={status} onClose={close} />}
      {dialog === "changePassword" && <ChangePasswordDialog onClose={close} />}
      {dialog === "newPhrase" && <NewPhraseDialog status={status} onClose={close} />}
      {dialog === "turnOff" && <TurnOffEncryptionDialog status={status} onClose={close} />}
    </div>
  );
}
