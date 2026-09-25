// Home's one-time offer: encryption is opt-in, so say it exists and give a
// real "no". Declining is remembered on this Mac and answered with where to
// find it later (docs/design/at-rest-encryption.md 5).

import React, { useState } from "react";
import { Lock, X } from "lucide-react";
import { Button } from "../../../components/ui/button";
import TurnOnEncryptionDialog from "./TurnOnEncryptionDialog";
import { useVaultStatus } from "./useVaultStatus";
import { ENCRYPTION_OFFER_KEY, encryptionOfferView, type EncryptionOfferAnswer } from "./vault-ui-pure";

function readAnswer(): EncryptionOfferAnswer {
  try {
    const value = localStorage.getItem(ENCRYPTION_OFFER_KEY);
    return value === "declined" || value === "accepted" ? value : null;
  } catch {
    return null;
  }
}

function saveAnswer(answer: Exclude<EncryptionOfferAnswer, null>) {
  try {
    localStorage.setItem(ENCRYPTION_OFFER_KEY, answer);
  } catch {
    // Private storage unavailable: the offer may show again, which is harmless.
  }
}

export default function EncryptionOffer() {
  const { status } = useVaultStatus();
  const [answer, setAnswer] = useState<EncryptionOfferAnswer>(readAnswer);
  const [declinedJustNow, setDeclinedJustNow] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [turningOn, setTurningOn] = useState(false);

  const view = dismissed ? "hidden" : encryptionOfferView(status, answer, declinedJustNow);
  if (view === "hidden" && !turningOn) return null;

  const decline = () => {
    saveAnswer("declined");
    setAnswer("declined");
    setDeclinedJustNow(true);
  };

  return (
    <>
      {view !== "hidden" && (
        <section
          aria-label="Encryption"
          className="mb-3 relative rounded-[var(--radius-sheet)] bg-card shadow-card p-3"
        >
          {view === "declined" && (
            <button
              type="button"
              onClick={() => setDismissed(true)}
              aria-label="Close"
              className="absolute top-2 right-2 p-1 rounded-full text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors"
            >
              <X size={14} />
            </button>
          )}
          <div className="flex items-start gap-3 pr-6">
            <div className="shrink-0 w-8 h-8 rounded-full bg-primary/15 flex items-center justify-center">
              <Lock size={16} className="text-primary" aria-hidden />
            </div>
            {view === "offer" ? (
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-foreground mb-0.5">Encrypt your notes and recordings?</p>
                <p className="text-xs text-muted-foreground mb-2">
                  They're stored as plain files on this Mac. Encryption locks them behind Touch ID or a password.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" className="h-7 text-xs" onClick={() => setTurningOn(true)}>
                    Turn on encryption…
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={decline}>
                    I don't need encryption
                  </Button>
                </div>
              </div>
            ) : (
              <p className="flex-1 min-w-0 text-xs text-muted-foreground self-center" aria-live="polite">
                OK. You can always turn it on later in Settings → Encryption.
              </p>
            )}
          </div>
        </section>
      )}
      {turningOn && status && (
        <TurnOnEncryptionDialog
          status={status}
          onClose={() => {
            setTurningOn(false);
            if (status.status !== "off") saveAnswer("accepted");
          }}
        />
      )}
    </>
  );
}
