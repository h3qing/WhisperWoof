/**
 * Test support: a stand-in for the `ws` WebSocket that OpenAIRealtimeStreaming
 * (helpers/openaiRealtimeStreaming.js) talks to, playing OpenAI's side of a
 * transcription session. The helpers are CommonJS, so tests put fakes in
 * require.cache with injectModule() before requiring them.
 */
import { EventEmitter } from "events";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

/** Every socket opened, oldest first. Tests reset it with `sockets.length = 0`. */
export const sockets: FakeWebSocket[] = [];

/** What the server transcribes when the client commits its remaining audio. */
export const COMMIT_TRANSCRIPT = "last words on commit";

export class FakeWebSocket extends EventEmitter {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  readyState = FakeWebSocket.CONNECTING;
  sent: Array<{ type: string }> = [];
  /** What the server does when the client commits its audio. */
  onCommit: "transcribe" | "drop" = "transcribe";
  /** The transcript it answers a commit with ("" for a commit of silence). */
  commitTranscript = COMMIT_TRANSCRIPT;

  constructor(
    public url: string,
    public opts: { headers: Record<string, string> }
  ) {
    super();
    sockets.push(this);
    setImmediate(() => {
      this.readyState = FakeWebSocket.OPEN;
      this.emit("open");
      this.serverSends({ type: "transcription_session.created" });
    });
  }

  serverSends(event: object) {
    this.emit("message", Buffer.from(JSON.stringify(event)));
  }

  /** The server finishes transcribing one turn. */
  transcribes(transcript: string) {
    this.serverSends({ type: "conversation.item.input_audio_transcription.completed", transcript });
  }

  send(data: string) {
    const msg = JSON.parse(data);
    this.sent.push(msg);
    if (msg.type === "transcription_session.update") {
      setImmediate(() => this.serverSends({ type: "transcription_session.updated" }));
    }
    if (msg.type === "input_audio_buffer.commit") {
      setImmediate(() =>
        this.onCommit === "drop" ? this.drop() : this.transcribes(this.commitTranscript)
      );
    }
  }

  // Like ws: the close event arrives later, after the closing handshake.
  close() {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    setImmediate(() => this.emit("close", 1000, Buffer.from("")));
  }

  /** The server ends the session (e.g. OpenAI's 30 minute limit). */
  drop() {
    this.readyState = FakeWebSocket.CLOSED;
    this.emit("close", 1006, Buffer.from(""));
  }

  get bearer() {
    return this.opts.headers.Authorization.replace("Bearer ", "");
  }
}

/** Make `require(request)` return `exports` for CommonJS modules loaded after this. */
export function injectModule(request: string, exports: unknown) {
  const resolved = require.resolve(request);
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports,
  } as NodeJS.Module;
}
