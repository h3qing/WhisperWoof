import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../../helpers/debugLogger", () => ({
  log: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
}));

// We don't need to mock openaiRealtimeStreaming since we inject via StreamingClass
const MeetingSessionManager =
  (await import("../../../helpers/meetingSessionManager")).default ??
  (await import("../../../helpers/meetingSessionManager"));

const SESSION_MAX_AGE_MS = 25 * 60 * 1000;
const ROTATION_CHECK_INTERVAL_MS = 30_000;

function createMockStreaming() {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue({ text: "test transcript" }),
    sendAudio: vi.fn().mockReturnValue(true),
    isConnected: true,
    getFullTranscript: vi.fn().mockReturnValue("test transcript"),
    onPartialTranscript: null as ((text: string) => void) | null,
    onFinalTranscript: null as ((text: string, ts: number) => void) | null,
    onError: null as ((err: Error) => void) | null,
    onSessionEnd: null as ((data: unknown) => void) | null,
  };
}

describe("MeetingSessionManager", () => {
  let manager: InstanceType<typeof MeetingSessionManager>;
  let fetchToken: ReturnType<typeof vi.fn>;
  let onSegment: ReturnType<typeof vi.fn>;
  let onError: ReturnType<typeof vi.fn>;
  let onReconnecting: ReturnType<typeof vi.fn>;
  let onReconnected: ReturnType<typeof vi.fn>;
  let MockStreamingClass: any;
  let mockInstances: ReturnType<typeof createMockStreaming>[];

  beforeEach(() => {
    vi.useFakeTimers();
    fetchToken = vi.fn().mockResolvedValue("new-token");
    onSegment = vi.fn();
    onError = vi.fn();
    onReconnecting = vi.fn();
    onReconnected = vi.fn();
    mockInstances = [];

    MockStreamingClass = class {
      connect: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
      sendAudio: ReturnType<typeof vi.fn>;
      isConnected: boolean;
      getFullTranscript: ReturnType<typeof vi.fn>;
      onPartialTranscript: ((text: string) => void) | null;
      onFinalTranscript: ((text: string, ts: number) => void) | null;
      onError: ((err: Error) => void) | null;
      onSessionEnd: ((data: unknown) => void) | null;

      constructor() {
        this.connect = vi.fn().mockResolvedValue(undefined);
        this.disconnect = vi.fn().mockResolvedValue({ text: "test transcript" });
        this.sendAudio = vi.fn().mockReturnValue(true);
        this.isConnected = true;
        this.getFullTranscript = vi.fn().mockReturnValue("test transcript");
        this.onPartialTranscript = null;
        this.onFinalTranscript = null;
        this.onError = null;
        this.onSessionEnd = null;
        mockInstances.push(this as any);
      }
    };

    manager = new MeetingSessionManager({
      fetchToken,
      onSegment,
      onError,
      onReconnecting,
      onReconnected,
      connectOpts: { model: "gpt-4o-mini-transcribe", preconfigured: true },
      StreamingClass: MockStreamingClass,
    });
  });

  afterEach(async () => {
    vi.useRealTimers();
    if (manager.isActive) {
      await manager.disconnectAll();
    }
  });

  describe("connect()", () => {
    it("creates a new streaming instance and connects it", async () => {
      await manager.connect("mic", "test-token");

      expect(mockInstances).toHaveLength(1);
      expect(mockInstances[0]!.connect).toHaveBeenCalledWith({
        apiKey: "test-token",
        model: "gpt-4o-mini-transcribe",
        preconfigured: true,
      });
    });

    it("marks the manager as active after connecting", async () => {
      expect(manager.isActive).toBe(false);
      await manager.connect("mic", "test-token");
      expect(manager.isActive).toBe(true);
    });

    it("disconnects existing slot before reconnecting same source", async () => {
      await manager.connect("mic", "token-1");
      const firstInstance = mockInstances[0]!;

      await manager.connect("mic", "token-2");
      expect(firstInstance!.disconnect).toHaveBeenCalled();
      expect(mockInstances).toHaveLength(2);
    });

    it("attaches transcript handlers to the streaming instance", async () => {
      await manager.connect("mic", "test-token");
      const instance = mockInstances[0]!;

      expect(instance!.onPartialTranscript).toBeTypeOf("function");
      expect(instance!.onFinalTranscript).toBeTypeOf("function");
      expect(instance!.onError).toBeTypeOf("function");
      expect(instance!.onSessionEnd).toBeTypeOf("function");
    });

    it("partial transcript handler calls onSegment with correct shape", async () => {
      await manager.connect("mic", "test-token");
      const instance = mockInstances[0]!;

      instance!.onPartialTranscript!("hello");
      expect(onSegment).toHaveBeenCalledWith({
        text: "hello",
        source: "mic",
        type: "partial",
      });
    });

    it("final transcript handler calls onSegment with correct shape", async () => {
      await manager.connect("mic", "test-token");
      const instance = mockInstances[0]!;

      instance!.onFinalTranscript!("hello world", 12345);
      expect(onSegment).toHaveBeenCalledWith({
        text: "hello world",
        source: "mic",
        type: "final",
        timestamp: 12345,
      });
    });
  });

  describe("sendAudio()", () => {
    it("forwards the buffer to the correct streaming instance", async () => {
      await manager.connect("mic", "test-token");
      const buf = Buffer.from([1, 2, 3]);

      const result = manager.sendAudio(buf, "mic");
      expect(result).toBe(true);
      expect(mockInstances[0]!.sendAudio).toHaveBeenCalledWith(buf);
    });

    it("returns false when source is unknown", () => {
      const result = manager.sendAudio(Buffer.from([1]), "unknown");
      expect(result).toBe(false);
    });
  });

  describe("disconnectAll()", () => {
    it("disconnects all connected slots and returns transcripts", async () => {
      await manager.connect("mic", "mic-token");
      await manager.connect("system", "system-token");

      const { transcripts } = await manager.disconnectAll() as { transcripts: Record<string, string> };
      expect((transcripts as any).mic).toBe("test transcript");
      expect((transcripts as any).system).toBe("test transcript");
      expect(mockInstances[0]!.disconnect).toHaveBeenCalled();
      expect(mockInstances[1]!.disconnect).toHaveBeenCalled();
    });

    it("falls back to getFullTranscript when disconnect throws", async () => {
      await manager.connect("mic", "test-token");
      mockInstances[0]!.disconnect.mockRejectedValue(new Error("disconnect failed"));

      const { transcripts } = await manager.disconnectAll() as { transcripts: Record<string, string> };
      expect((transcripts as any).mic).toBe("test transcript");
    });

    it("clears state and marks as inactive", async () => {
      await manager.connect("mic", "test-token");
      await manager.disconnectAll();

      expect(manager.isActive).toBe(false);
      expect(manager.isConnected("mic")).toBe(false);
    });
  });

  describe("isConnected()", () => {
    it("returns true for a connected source", async () => {
      await manager.connect("mic", "test-token");
      expect(manager.isConnected("mic")).toBe(true);
    });

    it("returns false for an unknown source", () => {
      expect(manager.isConnected("unknown")).toBe(false);
    });

    it("returns false after disconnectAll()", async () => {
      await manager.connect("mic", "test-token");
      await manager.disconnectAll();
      expect(manager.isConnected("mic")).toBe(false);
    });

    it("isAnyConnected() returns true when at least one source is connected", async () => {
      expect(manager.isAnyConnected()).toBe(false);
      await manager.connect("mic", "test-token");
      expect(manager.isAnyConnected()).toBe(true);
    });
  });

  describe("session rotation", () => {
    it("rotates a session when it exceeds SESSION_MAX_AGE_MS", async () => {
      await manager.connect("mic", "test-token");
      expect(mockInstances).toHaveLength(1);

      // Advance time past the session max age + one rotation check interval
      await vi.advanceTimersByTimeAsync(SESSION_MAX_AGE_MS + ROTATION_CHECK_INTERVAL_MS + 100);

      expect(fetchToken).toHaveBeenCalledWith("mic");
      // A new streaming instance should have been created for rotation
      expect(mockInstances).toHaveLength(2);
    });

    it("does not rotate before SESSION_MAX_AGE_MS", async () => {
      await manager.connect("mic", "test-token");
      vi.advanceTimersByTime(SESSION_MAX_AGE_MS - 1000);

      expect(mockInstances).toHaveLength(1);
    });
  });

  describe("unexpected disconnect and reconnection", () => {
    it("triggers reconnection when onSessionEnd fires", async () => {
      await manager.connect("mic", "test-token");
      const instance = mockInstances[0]!;

      // Simulate unexpected disconnect
      instance!.onSessionEnd!({});

      // Wait for reconnection delay
      await vi.advanceTimersByTimeAsync(1000);

      expect(onReconnecting).toHaveBeenCalledWith("mic");
      expect(fetchToken).toHaveBeenCalledWith("mic");
    });

    it("calls onReconnected after successful reconnection", async () => {
      await manager.connect("mic", "test-token");
      mockInstances[0]!.onSessionEnd!({});

      await vi.advanceTimersByTimeAsync(1000);

      expect(onReconnected).toHaveBeenCalledWith("mic");
    });

    it("does not reconnect when stopping", async () => {
      await manager.connect("mic", "test-token");
      const instance = mockInstances[0]!;

      // Start disconnecting
      const disconnectPromise = manager.disconnectAll();
      instance!.onSessionEnd!({});

      await disconnectPromise;
      await vi.advanceTimersByTimeAsync(5000);

      expect(onReconnecting).not.toHaveBeenCalled();
    });
  });

  describe("multiple independent sources", () => {
    it("manages mic and system slots independently", async () => {
      await manager.connect("mic", "mic-token");
      await manager.connect("system", "system-token");

      expect(mockInstances).toHaveLength(2);
      expect(manager.isConnected("mic")).toBe(true);
      expect(manager.isConnected("system")).toBe(true);
    });

    it("sends audio to the correct source", async () => {
      await manager.connect("mic", "mic-token");
      await manager.connect("system", "system-token");

      manager.sendAudio(Buffer.from([1]), "mic");
      manager.sendAudio(Buffer.from([2]), "system");

      expect(mockInstances[0]!.sendAudio).toHaveBeenCalledWith(Buffer.from([1]));
      expect(mockInstances[1]!.sendAudio).toHaveBeenCalledWith(Buffer.from([2]));
    });
  });

  describe("getStreaming()", () => {
    it("returns the streaming instance for a connected source", async () => {
      await manager.connect("mic", "test-token");
      const streaming = manager.getStreaming("mic");
      expect(streaming).toBe(mockInstances[0]!);
    });

    it("returns null for an unknown source", () => {
      expect(manager.getStreaming("unknown")).toBeNull();
    });
  });
});
