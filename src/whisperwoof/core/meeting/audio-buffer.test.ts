import fs from "fs";
import path from "path";
import os from "os";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock electron before importing the module under test
vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => os.tmpdir()),
  },
}));

// Mock debugLogger to suppress output and allow assertions
vi.mock("../../../helpers/debugLogger", () => ({
  log: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
}));

const { default: MeetingAudioBuffer } = await import(
  "../../../helpers/meetingAudioBuffer"
).then((m) => ({ default: m.default ?? m }));

// WAV constants matching the source
const SAMPLE_RATE = 24000;
const BITS_PER_SAMPLE = 16;
const NUM_CHANNELS = 1;
const BYTES_PER_SAMPLE = BITS_PER_SAMPLE / 8;
const WAV_HEADER_SIZE = 44;
const SEGMENT_DURATION_MS = 5 * 60 * 1000;

function parseWavHeader(buf: Buffer) {
  return {
    riffTag: buf.toString("ascii", 0, 4),
    fileSize: buf.readUInt32LE(4),
    waveTag: buf.toString("ascii", 8, 12),
    fmtTag: buf.toString("ascii", 12, 16),
    fmtChunkSize: buf.readUInt32LE(16),
    audioFormat: buf.readUInt16LE(20),
    numChannels: buf.readUInt16LE(22),
    sampleRate: buf.readUInt32LE(24),
    byteRate: buf.readUInt32LE(28),
    blockAlign: buf.readUInt16LE(32),
    bitsPerSample: buf.readUInt16LE(34),
    dataTag: buf.toString("ascii", 36, 40),
    dataSize: buf.readUInt32LE(40),
  };
}

function makePcmChunk(byteLength: number) {
  const buf = Buffer.alloc(byteLength);
  for (let i = 0; i < byteLength; i++) {
    buf[i] = i % 256;
  }
  return buf;
}

describe("MeetingAudioBuffer", () => {
  let tmpDir: string;
  let buffer: InstanceType<typeof MeetingAudioBuffer>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "meeting-audio-test-"));
    buffer = new MeetingAudioBuffer(tmpDir);
  });

  afterEach(() => {
    if (buffer.isActive) {
      buffer.stop();
    }
    try {
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup errors in tests
    }
    vi.restoreAllMocks();
  });

  describe("start()", () => {
    it("creates a session directory and returns a valid session ID", () => {
      const sessionId = buffer.start();
      expect(sessionId).toBeDefined();
      expect(typeof sessionId).toBe("string");
      expect(sessionId.length).toBeGreaterThan(0);

      const sessionDir = buffer.getSessionDir();
      expect(sessionDir).toContain(`meeting-audio-${sessionId}`);
      expect(fs.existsSync(sessionDir)).toBe(true);
      expect(fs.statSync(sessionDir).isDirectory()).toBe(true);
    });

    it("sets isActive to true after starting", () => {
      expect(buffer.isActive).toBe(false);
      buffer.start();
      expect(buffer.isActive).toBe(true);
    });

    it("returns the same session ID if start() is called while already started", () => {
      const firstId = buffer.start();
      const secondId = buffer.start();
      expect(secondId).toBe(firstId);
      expect(buffer.isActive).toBe(true);
    });
  });

  describe("writeChunk()", () => {
    it("writes audio data to a WAV file on disk", () => {
      buffer.start();
      const pcm = makePcmChunk(4800);
      buffer.writeChunk(pcm, "mic");

      const result = buffer.stop({ keepFiles: true });
      expect(result.files).toHaveLength(1);

      const fileData = fs.readFileSync(result.files[0]);
      expect(fileData.length).toBe(WAV_HEADER_SIZE + 4800);
    });

    it("accumulates multiple chunks into the same segment file", () => {
      buffer.start();
      buffer.writeChunk(makePcmChunk(1000), "mic");
      buffer.writeChunk(makePcmChunk(2000), "mic");
      buffer.writeChunk(makePcmChunk(500), "mic");

      const result = buffer.stop({ keepFiles: true });
      expect(result.files).toHaveLength(1);

      const fileData = fs.readFileSync(result.files[0]);
      expect(fileData.length).toBe(WAV_HEADER_SIZE + 3500);
    });

    it("records totalBytes correctly across chunks", () => {
      buffer.start();
      buffer.writeChunk(makePcmChunk(100), "mic");
      buffer.writeChunk(makePcmChunk(200), "mic");

      const result = buffer.stop();
      expect(result.totalBytes.mic).toBe(300);
    });

    it("ignores empty buffers", () => {
      buffer.start();
      buffer.writeChunk(Buffer.alloc(0), "mic");

      const result = buffer.stop();
      expect(result.files).toHaveLength(0);
    });

    it("is a no-op when buffer has not been started", () => {
      buffer.writeChunk(makePcmChunk(100), "mic");
      expect(buffer.isActive).toBe(false);
    });

    it("is a no-op when buffer has been stopped", () => {
      buffer.start();
      buffer.stop();
      buffer.writeChunk(makePcmChunk(100), "mic");
      expect(buffer.isActive).toBe(false);
    });
  });

  describe("WAV header validation", () => {
    it("writes a valid WAV header with correct markers", () => {
      buffer.start();
      buffer.writeChunk(makePcmChunk(9600), "mic");

      const result = buffer.stop({ keepFiles: true });
      const fileData = fs.readFileSync(result.files[0]);
      const header = parseWavHeader(fileData);

      expect(header.riffTag).toBe("RIFF");
      expect(header.waveTag).toBe("WAVE");
      expect(header.fmtTag).toBe("fmt ");
      expect(header.dataTag).toBe("data");
    });

    it("sets correct audio format parameters", () => {
      buffer.start();
      buffer.writeChunk(makePcmChunk(4800), "mic");

      const result = buffer.stop({ keepFiles: true });
      const fileData = fs.readFileSync(result.files[0]);
      const header = parseWavHeader(fileData);

      expect(header.audioFormat).toBe(1); // PCM
      expect(header.numChannels).toBe(NUM_CHANNELS);
      expect(header.sampleRate).toBe(SAMPLE_RATE);
      expect(header.bitsPerSample).toBe(BITS_PER_SAMPLE);
      expect(header.byteRate).toBe(SAMPLE_RATE * NUM_CHANNELS * BYTES_PER_SAMPLE);
      expect(header.blockAlign).toBe(NUM_CHANNELS * BYTES_PER_SAMPLE);
    });

    it("patches the data size in header after segment close", () => {
      buffer.start();
      buffer.writeChunk(makePcmChunk(9600), "mic");

      const result = buffer.stop({ keepFiles: true });
      const fileData = fs.readFileSync(result.files[0]);
      const header = parseWavHeader(fileData);

      expect(header.dataSize).toBe(9600);
      expect(header.fileSize).toBe(36 + 9600);
    });

    it("produces PCM data that matches the written chunks", () => {
      buffer.start();
      const pcm = makePcmChunk(100);
      buffer.writeChunk(pcm, "mic");

      const result = buffer.stop({ keepFiles: true });
      const fileData = fs.readFileSync(result.files[0]);
      const pcmSection = fileData.subarray(WAV_HEADER_SIZE);

      expect(pcmSection.length).toBe(100);
      expect(Buffer.compare(pcmSection, pcm)).toBe(0);
    });
  });

  describe("segment rotation", () => {
    it("rotates to a new segment file after SEGMENT_DURATION_MS", () => {
      buffer.start();
      const now = Date.now();
      vi.spyOn(Date, "now").mockReturnValue(now);
      buffer.writeChunk(makePcmChunk(1000), "mic");

      (Date.now as ReturnType<typeof vi.fn>).mockReturnValue(now + SEGMENT_DURATION_MS + 1);
      buffer.writeChunk(makePcmChunk(2000), "mic");

      const result = buffer.stop({ keepFiles: true });
      expect(result.files).toHaveLength(2);
      expect(result.totalBytes.mic).toBe(3000);

      const file1 = fs.readFileSync(result.files[0]);
      expect(parseWavHeader(file1).dataSize).toBe(1000);

      const file2 = fs.readFileSync(result.files[1]);
      expect(parseWavHeader(file2).dataSize).toBe(2000);
    });

    it("creates correctly numbered segment files", () => {
      buffer.start();
      const now = Date.now();
      vi.spyOn(Date, "now").mockReturnValue(now);
      buffer.writeChunk(makePcmChunk(100), "mic");

      (Date.now as ReturnType<typeof vi.fn>).mockReturnValue(now + SEGMENT_DURATION_MS + 1);
      buffer.writeChunk(makePcmChunk(100), "mic");

      (Date.now as ReturnType<typeof vi.fn>).mockReturnValue(now + 2 * SEGMENT_DURATION_MS + 2);
      buffer.writeChunk(makePcmChunk(100), "mic");

      const result = buffer.stop({ keepFiles: true });
      expect(result.files).toHaveLength(3);
      expect(path.basename(result.files[0])).toBe("mic-0000.wav");
      expect(path.basename(result.files[1])).toBe("mic-0001.wav");
      expect(path.basename(result.files[2])).toBe("mic-0002.wav");
    });

    it("each rotated segment is a valid WAV file", () => {
      buffer.start();
      const now = Date.now();
      vi.spyOn(Date, "now").mockReturnValue(now);
      buffer.writeChunk(makePcmChunk(500), "mic");

      (Date.now as ReturnType<typeof vi.fn>).mockReturnValue(now + SEGMENT_DURATION_MS + 1);
      buffer.writeChunk(makePcmChunk(700), "mic");

      const result = buffer.stop({ keepFiles: true });
      for (const filePath of result.files) {
        const data = fs.readFileSync(filePath);
        const header = parseWavHeader(data);
        expect(header.riffTag).toBe("RIFF");
        expect(header.waveTag).toBe("WAVE");
        expect(header.audioFormat).toBe(1);
        expect(header.fileSize).toBe(36 + header.dataSize);
        expect(data.length).toBe(WAV_HEADER_SIZE + header.dataSize);
      }
    });
  });

  describe("stop()", () => {
    it("finalizes all open segments and returns file list", () => {
      buffer.start();
      buffer.writeChunk(makePcmChunk(1000), "mic");

      const result = buffer.stop({ keepFiles: true });
      expect(result.sessionId).toBeDefined();
      expect(result.files).toHaveLength(1);
      expect(result.totalBytes.mic).toBe(1000);
      expect(result.dir).toBeDefined();
    });

    it("resets state after stop", () => {
      buffer.start();
      buffer.writeChunk(makePcmChunk(100), "mic");
      buffer.stop();

      expect(buffer.isActive).toBe(false);
      expect(buffer.getSessionDir()).toBeNull();
    });

    it("returns empty result when not started", () => {
      const result = buffer.stop();
      expect(result.sessionId).toBeNull();
      expect(result.files).toEqual([]);
    });

    it("allows a new session after stop", () => {
      buffer.start();
      buffer.writeChunk(makePcmChunk(100), "mic");
      const result1 = buffer.stop({ keepFiles: true });

      buffer.start();
      buffer.writeChunk(makePcmChunk(200), "mic");
      const result2 = buffer.stop({ keepFiles: true });

      expect(result2.sessionId).not.toBe(result1.sessionId);
      expect(result2.files).toHaveLength(1);
      expect(result2.totalBytes.mic).toBe(200);
    });
  });

  describe("cleanupFiles()", () => {
    it("removes the session directory and all files", () => {
      buffer.start();
      buffer.writeChunk(makePcmChunk(500), "mic");
      buffer.writeChunk(makePcmChunk(500), "system");
      const sessionDir = buffer.getSessionDir();

      buffer.stop();
      expect(fs.existsSync(sessionDir)).toBe(true);

      buffer.cleanupFiles();
      expect(fs.existsSync(sessionDir)).toBe(false);
    });

    it("accepts an explicit directory path", () => {
      buffer.start();
      buffer.writeChunk(makePcmChunk(500), "mic");

      const result = buffer.stop({ keepFiles: true });
      expect(fs.existsSync(result.dir)).toBe(true);

      buffer.cleanupFiles(result.dir);
      expect(fs.existsSync(result.dir)).toBe(false);
    });

    it("is a no-op when there is nothing to clean up", () => {
      buffer.cleanupFiles(); // should not throw
    });
  });

  describe("multiple sources", () => {
    it("creates separate WAV files for mic and system", () => {
      buffer.start();
      buffer.writeChunk(makePcmChunk(1000), "mic");
      buffer.writeChunk(makePcmChunk(2000), "system");

      const result = buffer.stop({ keepFiles: true });
      expect(result.files).toHaveLength(2);
      expect(result.totalBytes.mic).toBe(1000);
      expect(result.totalBytes.system).toBe(2000);

      const micFile = result.files.find((f: string) => path.basename(f).startsWith("mic-"));
      const systemFile = result.files.find((f: string) => path.basename(f).startsWith("system-"));
      expect(micFile).toBeDefined();
      expect(systemFile).toBeDefined();
    });

    it("names files with correct source prefix", () => {
      buffer.start();
      buffer.writeChunk(makePcmChunk(100), "mic");
      buffer.writeChunk(makePcmChunk(100), "system");

      const result = buffer.stop({ keepFiles: true });
      const basenames = result.files.map((f: string) => path.basename(f));
      expect(basenames).toContain("mic-0000.wav");
      expect(basenames).toContain("system-0000.wav");
    });

    it("rotates each source independently", () => {
      buffer.start();
      const now = Date.now();
      vi.spyOn(Date, "now").mockReturnValue(now);

      buffer.writeChunk(makePcmChunk(100), "mic");
      buffer.writeChunk(makePcmChunk(100), "system");

      (Date.now as ReturnType<typeof vi.fn>).mockReturnValue(now + SEGMENT_DURATION_MS + 1);
      buffer.writeChunk(makePcmChunk(200), "mic");

      const result = buffer.stop({ keepFiles: true });
      const micFiles = result.files.filter((f: string) => path.basename(f).startsWith("mic-"));
      const systemFiles = result.files.filter((f: string) => path.basename(f).startsWith("system-"));

      expect(micFiles).toHaveLength(2);
      expect(systemFiles).toHaveLength(1);
    });
  });

  describe("getBufferedFiles()", () => {
    it("returns empty array when not started", () => {
      expect(buffer.getBufferedFiles()).toEqual([]);
    });

    it("returns completed files for a specific source", () => {
      buffer.start();
      const now = Date.now();
      vi.spyOn(Date, "now").mockReturnValue(now);
      buffer.writeChunk(makePcmChunk(100), "mic");

      (Date.now as ReturnType<typeof vi.fn>).mockReturnValue(now + SEGMENT_DURATION_MS + 1);
      buffer.writeChunk(makePcmChunk(100), "mic");

      const micFiles = buffer.getBufferedFiles("mic");
      expect(micFiles).toHaveLength(1);
      expect(path.basename(micFiles[0])).toBe("mic-0000.wav");
    });

    it("returns a copy, not the internal array", () => {
      buffer.start();
      const now = Date.now();
      vi.spyOn(Date, "now").mockReturnValue(now);
      buffer.writeChunk(makePcmChunk(100), "mic");

      (Date.now as ReturnType<typeof vi.fn>).mockReturnValue(now + SEGMENT_DURATION_MS + 1);
      buffer.writeChunk(makePcmChunk(100), "mic");

      const files1 = buffer.getBufferedFiles("mic");
      const files2 = buffer.getBufferedFiles("mic");
      expect(files1).toEqual(files2);
      expect(files1).not.toBe(files2);
    });
  });
});
