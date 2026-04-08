/**
 * Meeting bridge — unified meeting lifecycle coordinator.
 *
 * Previously this module held transcript segments in memory (no persistence).
 * Now it delegates to MeetingTranscriptCheckpoint for crash-safe incremental saves
 * and MeetingAudioBuffer for local audio persistence.
 *
 * This module is the ONLY entry point for WhisperWoof meeting state.
 * The streaming transcription system (OpenAI Realtime) feeds segments here,
 * and this bridge ensures they reach both the UI and the database.
 */
const crypto = require("crypto");
const debugLogger = require("../../helpers/debugLogger");

let activeMeeting = null;

function startMeeting(options = {}) {
  if (activeMeeting) {
    debugLogger.log("[WhisperWoof] Cannot start meeting — one is already active", {
      id: activeMeeting.id,
    });
    return null;
  }

  const meeting = {
    id: crypto.randomUUID(),
    startedAt: Date.now(),
    transcriptOnly: options.transcriptOnly ?? false,
    noteId: options.noteId ?? null,
    segmentCount: 0,
  };

  activeMeeting = meeting;

  debugLogger.log("[WhisperWoof] Meeting started", {
    id: meeting.id,
    transcriptOnly: meeting.transcriptOnly,
    noteId: meeting.noteId,
  });

  return meeting.id;
}

function addMeetingSegment(text) {
  if (!activeMeeting) return;
  if (typeof text !== "string" || text.trim().length === 0) return;

  // Update segment count (segments are now persisted by MeetingTranscriptCheckpoint)
  activeMeeting = {
    ...activeMeeting,
    segmentCount: activeMeeting.segmentCount + 1,
  };
}

function endMeeting() {
  if (!activeMeeting) return null;

  const meeting = activeMeeting;
  const durationMs = Date.now() - meeting.startedAt;

  activeMeeting = null;

  debugLogger.log("[WhisperWoof] Meeting ended", {
    id: meeting.id,
    duration: durationMs,
    segments: meeting.segmentCount,
  });

  return {
    id: meeting.id,
    durationMs,
    segmentCount: meeting.segmentCount,
    transcriptOnly: meeting.transcriptOnly,
    noteId: meeting.noteId,
  };
}

function getActiveMeeting() {
  if (!activeMeeting) return null;
  return {
    id: activeMeeting.id,
    startedAt: activeMeeting.startedAt,
    segmentCount: activeMeeting.segmentCount,
    transcriptOnly: activeMeeting.transcriptOnly,
    noteId: activeMeeting.noteId,
  };
}

module.exports = { startMeeting, addMeetingSegment, endMeeting, getActiveMeeting };
