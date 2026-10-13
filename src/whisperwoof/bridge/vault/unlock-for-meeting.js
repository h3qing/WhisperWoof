// A meeting prompt's Start while WhisperWoof is locked. The meeting's note goes
// into the encrypted database, so it's unlocked first: Touch ID right away,
// else the lock screen (the meeting then starts once it's unlocked).
// Resolves true when WhisperWoof is unlocked.
function createUnlockForMeeting({ vault, controller, showLockScreen }) {
  return async () => {
    if (!vault.isOn() || vault.isUnlocked()) return true;
    await controller.unlockWithTouchId().catch(() => {});
    if (vault.isUnlocked()) return true;
    await showLockScreen();
    return false;
  };
}

module.exports = { createUnlockForMeeting };
