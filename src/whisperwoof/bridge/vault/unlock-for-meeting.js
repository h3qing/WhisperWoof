// A meeting prompt's Start while WhisperWoof is locked. The meeting's note goes
// into the encrypted database, so it's unlocked first: Touch ID right away,
// else the lock screen, and the meeting starts once it's unlocked.
//
// unlock() resolves "ready" (the database is open), "waiting" (for the lock
// screen, or an unlock still opening the database) or "declined" (Touch ID
// cancelled: not now).
function createUnlockForMeeting({ vault, controller, databaseOpen, showLockScreen }) {
  // "Unlocked" comes before the unlock steps that open the database.
  const ready = () => !vault.isOn() || (vault.isUnlocked() && databaseOpen());

  async function unlock() {
    if (ready()) return "ready";
    if (vault.isUnlocked()) return "waiting";
    const result = await controller.unlockWithTouchId();
    if (ready()) return "ready";
    if (result?.code === "CANCELLED") return "declined";
    await showLockScreen();
    return ready() ? "ready" : "waiting";
  }

  return { ready, unlock };
}

module.exports = { createUnlockForMeeting };
