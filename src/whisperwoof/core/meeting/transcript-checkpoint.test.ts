import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock debugLogger before importing the module under test
vi.mock('../../../helpers/debugLogger', () => ({
  log: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
}));

const MeetingTranscriptCheckpoint = (await import('../../../helpers/meetingTranscriptCheckpoint')).default
  ?? (await import('../../../helpers/meetingTranscriptCheckpoint'));

describe('MeetingTranscriptCheckpoint', () => {
  let checkpoint;
  let databaseManager;

  beforeEach(() => {
    vi.useFakeTimers();
    databaseManager = { updateNote: vi.fn() };
    checkpoint = new MeetingTranscriptCheckpoint({
      databaseManager,
      intervalMs: 60_000,
    });
  });

  afterEach(() => {
    // Ensure timer is cleaned up even if a test fails
    if (checkpoint.isActive) {
      checkpoint.stop();
    }
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------
  // 1. start() begins the checkpoint timer
  // ---------------------------------------------------------------
  describe('start()', () => {
    it('begins the checkpoint timer and marks as active', () => {
      expect(checkpoint.isActive).toBe(false);

      checkpoint.start('note-1');

      expect(checkpoint.isActive).toBe(true);
    });

    it('accepts an optional audioBufferDir option', () => {
      checkpoint.start('note-1', { audioBufferDir: '/tmp/audio' });

      expect(checkpoint.isActive).toBe(true);
    });
  });

  // ---------------------------------------------------------------
  // 2. addSegment() accumulates segments
  // ---------------------------------------------------------------
  describe('addSegment()', () => {
    it('accumulates segments that will be saved on the next checkpoint', () => {
      checkpoint.start('note-1');

      checkpoint.addSegment({ id: 'seg-1', text: 'Hello', source: 'mic' });
      checkpoint.addSegment({ id: 'seg-2', text: 'World', source: 'mic' });

      // Force a checkpoint to verify both segments are present
      checkpoint.forceCheckpoint();

      expect(databaseManager.updateNote).toHaveBeenCalledTimes(1);
      const [noteId, payload] = databaseManager.updateNote.mock.calls[0];
      expect(noteId).toBe('note-1');
      expect(payload.content).toBe('Hello\nWorld');
    });

    it('assigns a default timestamp when none is provided', () => {
      vi.setSystemTime(new Date('2026-01-15T10:00:00Z'));
      checkpoint.start('note-1');

      checkpoint.addSegment({ id: 'seg-1', text: 'Hi', source: 'mic' });
      checkpoint.forceCheckpoint();

      const metadata = JSON.parse(databaseManager.updateNote.mock.calls[0][1].metadata);
      expect(metadata.lastSegmentTimestamp).toBe(new Date('2026-01-15T10:00:00Z').getTime());
    });

    it('preserves an explicit timestamp on the segment', () => {
      checkpoint.start('note-1');
      const explicitTs = 1700000000000;

      checkpoint.addSegment({ id: 'seg-1', text: 'Hi', source: 'mic', timestamp: explicitTs });
      checkpoint.forceCheckpoint();

      const metadata = JSON.parse(databaseManager.updateNote.mock.calls[0][1].metadata);
      expect(metadata.lastSegmentTimestamp).toBe(explicitTs);
    });
  });

  // ---------------------------------------------------------------
  // 3. Checkpoint fires after intervalMs and saves to database
  // ---------------------------------------------------------------
  describe('periodic checkpoint', () => {
    it('fires after intervalMs and saves accumulated segments to the database', () => {
      checkpoint.start('note-1');

      checkpoint.addSegment({ id: 'seg-1', text: 'first', source: 'mic' });
      checkpoint.addSegment({ id: 'seg-2', text: 'second', source: 'system' });

      // Timer hasn't fired yet
      expect(databaseManager.updateNote).not.toHaveBeenCalled();

      // Advance past the interval
      vi.advanceTimersByTime(60_000);

      expect(databaseManager.updateNote).toHaveBeenCalledTimes(1);
      const [noteId, payload] = databaseManager.updateNote.mock.calls[0];
      expect(noteId).toBe('note-1');
      expect(payload.content).toBe('first\nsecond');

      const metadata = JSON.parse(payload.metadata);
      expect(metadata.segmentCount).toBe(2);
    });

    it('only saves new segments added since the last checkpoint', () => {
      checkpoint.start('note-1');

      checkpoint.addSegment({ id: 'seg-1', text: 'one', source: 'mic' });
      vi.advanceTimersByTime(60_000);

      expect(databaseManager.updateNote).toHaveBeenCalledTimes(1);

      // No new segments — next tick should not call updateNote again
      vi.advanceTimersByTime(60_000);
      expect(databaseManager.updateNote).toHaveBeenCalledTimes(1);

      // Add another segment — next tick should fire
      checkpoint.addSegment({ id: 'seg-2', text: 'two', source: 'mic' });
      vi.advanceTimersByTime(60_000);

      expect(databaseManager.updateNote).toHaveBeenCalledTimes(2);
      // Full transcript includes both segments
      expect(databaseManager.updateNote.mock.calls[1][1].content).toBe('one\ntwo');
    });

    it('respects MIN_INTERVAL_MS floor (10 000 ms)', () => {
      const fastCheckpoint = new MeetingTranscriptCheckpoint({
        databaseManager,
        intervalMs: 1_000, // Below the minimum
      });

      fastCheckpoint.start('note-1');
      fastCheckpoint.addSegment({ id: 'seg-1', text: 'fast', source: 'mic' });

      // 1 s should NOT fire
      vi.advanceTimersByTime(1_000);
      expect(databaseManager.updateNote).not.toHaveBeenCalled();

      // 10 s should fire (MIN_INTERVAL_MS)
      vi.advanceTimersByTime(9_000);
      expect(databaseManager.updateNote).toHaveBeenCalledTimes(1);

      fastCheckpoint.stop();
    });
  });

  // ---------------------------------------------------------------
  // 4. stop() does a final checkpoint and cleans up
  // ---------------------------------------------------------------
  describe('stop()', () => {
    it('performs a final checkpoint and resets state', () => {
      checkpoint.start('note-1');
      checkpoint.addSegment({ id: 'seg-1', text: 'final', source: 'mic' });

      const result = checkpoint.stop();

      expect(databaseManager.updateNote).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ savedSegments: 1, noteId: 'note-1' });
      expect(checkpoint.isActive).toBe(false);
    });

    it('returns zero counts when called without starting', () => {
      const result = checkpoint.stop();

      expect(result).toEqual({ savedSegments: 0, noteId: null });
      expect(databaseManager.updateNote).not.toHaveBeenCalled();
    });

    it('clears the interval timer so no further checkpoints fire', () => {
      checkpoint.start('note-1');
      checkpoint.addSegment({ id: 'seg-1', text: 'only once', source: 'mic' });
      checkpoint.stop();

      // Reset mock after final checkpoint in stop()
      databaseManager.updateNote.mockClear();

      // Advance well past the interval — no more calls should occur
      vi.advanceTimersByTime(300_000);
      expect(databaseManager.updateNote).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------
  // 5. forceCheckpoint() saves immediately
  // ---------------------------------------------------------------
  describe('forceCheckpoint()', () => {
    it('saves all pending segments immediately without waiting for the timer', () => {
      checkpoint.start('note-1');
      checkpoint.addSegment({ id: 'seg-1', text: 'urgent', source: 'mic' });

      checkpoint.forceCheckpoint();

      expect(databaseManager.updateNote).toHaveBeenCalledTimes(1);
      expect(databaseManager.updateNote.mock.calls[0][1].content).toBe('urgent');
    });

    it('is a no-op when checkpoint is not active', () => {
      checkpoint.forceCheckpoint();

      expect(databaseManager.updateNote).not.toHaveBeenCalled();
    });

    it('does not save if there are no new segments since last checkpoint', () => {
      checkpoint.start('note-1');
      checkpoint.addSegment({ id: 'seg-1', text: 'only once', source: 'mic' });

      checkpoint.forceCheckpoint();
      expect(databaseManager.updateNote).toHaveBeenCalledTimes(1);

      // Force again with no new segments
      checkpoint.forceCheckpoint();
      expect(databaseManager.updateNote).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------
  // 6. Idempotent — duplicate segments are handled
  // ---------------------------------------------------------------
  describe('idempotency', () => {
    it('includes all added segments even if they share the same id', () => {
      checkpoint.start('note-1');

      // The implementation does not deduplicate by ID at addSegment time;
      // it simply appends. The dedup guarantee is that calling _doCheckpoint
      // multiple times does not re-save already-checkpointed segments.
      checkpoint.addSegment({ id: 'seg-1', text: 'Hello', source: 'mic' });
      checkpoint.addSegment({ id: 'seg-1', text: 'Hello', source: 'mic' });

      checkpoint.forceCheckpoint();
      expect(databaseManager.updateNote).toHaveBeenCalledTimes(1);

      // Second forceCheckpoint with no new segments — no duplicate write
      checkpoint.forceCheckpoint();
      expect(databaseManager.updateNote).toHaveBeenCalledTimes(1);
    });

    it('successive checkpoints only include segments added since the last save', () => {
      checkpoint.start('note-1');

      checkpoint.addSegment({ id: 'seg-1', text: 'A', source: 'mic' });
      checkpoint.forceCheckpoint();

      checkpoint.addSegment({ id: 'seg-2', text: 'B', source: 'mic' });
      checkpoint.forceCheckpoint();

      // Second call writes full transcript including both
      expect(databaseManager.updateNote).toHaveBeenCalledTimes(2);
      expect(databaseManager.updateNote.mock.calls[1][1].content).toBe('A\nB');
    });
  });

  // ---------------------------------------------------------------
  // 7. Cannot start when already started
  // ---------------------------------------------------------------
  describe('cannot start when already started', () => {
    it('ignores a second start() call while already active', () => {
      checkpoint.start('note-1');
      checkpoint.addSegment({ id: 'seg-1', text: 'first session', source: 'mic' });

      // Attempt to start again with a different noteId
      checkpoint.start('note-2');

      // Should still be tracking note-1
      checkpoint.forceCheckpoint();
      expect(databaseManager.updateNote.mock.calls[0][0]).toBe('note-1');
    });

    it('remains active with the original noteId', () => {
      checkpoint.start('note-1');
      checkpoint.start('note-2');

      expect(checkpoint.isActive).toBe(true);
      // Verify original note id persists by stopping
      const result = checkpoint.stop();
      expect(result.noteId).toBe('note-1');
    });
  });

  // ---------------------------------------------------------------
  // 8. Adding segments when not started is a no-op
  // ---------------------------------------------------------------
  describe('addSegment when not started', () => {
    it('silently discards segments added before start()', () => {
      checkpoint.addSegment({ id: 'seg-1', text: 'lost', source: 'mic' });

      checkpoint.start('note-1');
      checkpoint.forceCheckpoint();

      // No segments to save, so updateNote should not be called
      expect(databaseManager.updateNote).not.toHaveBeenCalled();
    });

    it('silently discards segments added after stop()', () => {
      checkpoint.start('note-1');
      checkpoint.stop();

      checkpoint.addSegment({ id: 'seg-1', text: 'lost', source: 'mic' });

      // Cannot force checkpoint either — not active
      checkpoint.forceCheckpoint();
      expect(databaseManager.updateNote).toHaveBeenCalledTimes(0);
    });
  });

  // ---------------------------------------------------------------
  // 9. Database errors are caught and logged (not thrown)
  // ---------------------------------------------------------------
  describe('database error handling', () => {
    it('catches database errors during periodic checkpoint without throwing', () => {
      databaseManager.updateNote.mockImplementation(() => {
        throw new Error('disk full');
      });

      checkpoint.start('note-1');
      checkpoint.addSegment({ id: 'seg-1', text: 'boom', source: 'mic' });

      // Should not throw
      expect(() => vi.advanceTimersByTime(60_000)).not.toThrow();
      expect(databaseManager.updateNote).toHaveBeenCalledTimes(1);
    });

    it('catches database errors during forceCheckpoint without throwing', () => {
      databaseManager.updateNote.mockImplementation(() => {
        throw new Error('connection lost');
      });

      checkpoint.start('note-1');
      checkpoint.addSegment({ id: 'seg-1', text: 'boom', source: 'mic' });

      expect(() => checkpoint.forceCheckpoint()).not.toThrow();
    });

    it('catches database errors during stop() final checkpoint without throwing', () => {
      databaseManager.updateNote.mockImplementation(() => {
        throw new Error('read only');
      });

      checkpoint.start('note-1');
      checkpoint.addSegment({ id: 'seg-1', text: 'boom', source: 'mic' });

      expect(() => checkpoint.stop()).not.toThrow();
    });

    it('does not update the checkpoint index when a save fails, allowing retry', () => {
      let callCount = 0;
      databaseManager.updateNote.mockImplementation(() => {
        callCount += 1;
        if (callCount === 1) {
          throw new Error('transient failure');
        }
      });

      checkpoint.start('note-1');
      checkpoint.addSegment({ id: 'seg-1', text: 'retry me', source: 'mic' });

      // First checkpoint fails
      vi.advanceTimersByTime(60_000);
      expect(databaseManager.updateNote).toHaveBeenCalledTimes(1);

      // Second checkpoint should retry (same segment is still "new")
      vi.advanceTimersByTime(60_000);
      expect(databaseManager.updateNote).toHaveBeenCalledTimes(2);
      expect(databaseManager.updateNote.mock.calls[1][1].content).toBe('retry me');
    });
  });

  // ---------------------------------------------------------------
  // Metadata shape
  // ---------------------------------------------------------------
  describe('metadata', () => {
    it('includes segmentCount, lastSegmentTimestamp, checkpointedAt, and audioBufferDir', () => {
      vi.setSystemTime(new Date('2026-02-01T12:00:00Z'));
      checkpoint.start('note-1', { audioBufferDir: '/tmp/buffers' });
      checkpoint.addSegment({ id: 'seg-1', text: 'check metadata', source: 'mic', timestamp: 99999 });

      checkpoint.forceCheckpoint();

      const metadata = JSON.parse(databaseManager.updateNote.mock.calls[0][1].metadata);
      expect(metadata.segmentCount).toBe(1);
      expect(metadata.lastSegmentTimestamp).toBe(99999);
      expect(metadata.checkpointedAt).toBe(new Date('2026-02-01T12:00:00Z').getTime());
      expect(metadata.audioBufferDir).toBe('/tmp/buffers');
    });
  });
});
