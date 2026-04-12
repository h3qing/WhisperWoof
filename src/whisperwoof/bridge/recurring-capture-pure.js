/**
 * Pure logic for Recurring Capture — schedule validation + fire-time check.
 *
 * No file I/O, no electron, no side effects. Shared between
 * recurring-capture.js (which adds persistence + the setInterval loop)
 * and recurring-capture.test.ts.
 */

/**
 * Validate an "HH:MM" time string (24-hour format).
 */
function isValidTime(time) {
  if (!time || typeof time !== "string") return false;
  const match = time.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return false;
  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}

/**
 * Parse "HH:MM" into { hours, minutes }. Assumes the string has already
 * been validated with isValidTime.
 */
function parseTime(time) {
  const [h, m] = time.split(":").map(Number);
  return { hours: h, minutes: m };
}

/**
 * Get the ISO day-of-week (1=Mon..7=Sun) for a Date.
 * JS Date.getDay returns 0=Sun..6=Sat, so we normalize Sunday to 7.
 */
function getIsoDay(date) {
  const jsDay = date.getDay();
  return jsDay === 0 ? 7 : jsDay;
}

/**
 * Decide whether a schedule should fire at the given `now`.
 *
 * A schedule fires when:
 *   - it is enabled
 *   - today's ISO day is in schedule.days
 *   - now's hour/minute matches schedule.time
 *   - it hasn't already fired this minute (lastFiredAt guard)
 *
 * Does NOT mutate the schedule — the caller records firing in their own
 * persistence layer.
 */
function shouldFire(schedule, now) {
  if (!schedule.enabled) return false;

  const { hours, minutes } = parseTime(schedule.time);
  const isoDay = getIsoDay(now);

  if (!schedule.days.includes(isoDay)) return false;
  if (now.getHours() !== hours || now.getMinutes() !== minutes) return false;

  if (schedule.lastFiredAt) {
    const lastFired = new Date(schedule.lastFiredAt);
    if (
      lastFired.getFullYear() === now.getFullYear() &&
      lastFired.getMonth() === now.getMonth() &&
      lastFired.getDate() === now.getDate() &&
      lastFired.getHours() === now.getHours() &&
      lastFired.getMinutes() === now.getMinutes()
    ) {
      return false;
    }
  }

  return true;
}

/**
 * Preset schedule configurations shown in the quick-setup UI.
 */
function getPresets() {
  return [
    { name: "Morning Brain Dump", prompt: "What's on your mind this morning?", time: "08:00", days: [1, 2, 3, 4, 5] },
    { name: "End of Day Review", prompt: "What did you accomplish today?", time: "17:00", days: [1, 2, 3, 4, 5] },
    { name: "Weekly Reflection", prompt: "How did this week go? What would you improve?", time: "16:00", days: [5] },
    { name: "Daily Standup Prep", prompt: "What did you do yesterday, what's today's plan, any blockers?", time: "09:00", days: [1, 2, 3, 4, 5] },
  ];
}

module.exports = {
  isValidTime,
  parseTime,
  getIsoDay,
  shouldFire,
  getPresets,
};
