/**
 * Meeting session rotation. OpenAI Realtime sessions end after ~30 minutes,
 * so a long meeting swaps each stream for a fresh session before then. The
 * fresh session connects first and takes over only once it is live, so audio
 * always has somewhere to go; the old one is then committed (its last words
 * still arrive) and closed.
 *
 * Rotation can't lean on the reconnect path: disconnect() never fires
 * onSessionEnd, which is only for unexpected drops.
 */

const SESSION_MAX_AGE_MS = 25 * 60 * 1000; // 5min before OpenAI's ~30min limit
// Due sessions wait for a quiet moment (no turn in flight) until this age.
const SESSION_HARD_MAX_AGE_MS = 28 * 60 * 1000;
// A session that drops sooner than this after opening doesn't reconnect at once.
const MIN_SESSION_LIFE_MS = 60 * 1000;
const MEETING_SOURCES = ["mic", "system"];

/**
 * The streams to rotate now: none while no meeting is streaming or a rotation
 * is under way; otherwise each stream whose session is gone (its reconnect
 * gave up), or went live SESSION_MAX_AGE_MS ago and is between turns, or went
 * live SESSION_HARD_MAX_AGE_MS ago. A stream mid-reconnect is left alone (a
 * reconnect opens a fresh session anyway).
 *
 * Age is per session (connectedAt), not per meeting: meeting mode pre-warms
 * sessions before recording starts, and a stream that reconnected is younger.
 * Waiting for a gap between turns (speechStartedAt is set from speech start
 * until that turn's transcript arrives) keeps a sentence from being cut in
 * half across two sessions.
 * @returns {string[]} "mic" | "system"
 */
function sourcesToRotate({ active, now, rotating, streams, reconnecting = {} }) {
  if (!active || rotating) return [];
  return MEETING_SOURCES.filter((source) => {
    const stream = streams[source];
    if (!stream || reconnecting[source]) return false;
    if (!stream.isConnected && !stream.isConnecting) return true;
    if (stream.connectedAt == null) return false;
    const age = now - stream.connectedAt;
    const midTurn = stream.speechStartedAt != null;
    return age >= SESSION_HARD_MAX_AGE_MS || (age >= SESSION_MAX_AGE_MS && !midTurn);
  });
}

/**
 * Whether a session that ended unexpectedly should reconnect right away. One
 * that dropped within a minute of opening (a server accepting and closing
 * sessions, e.g. over a limit) is left to the 30s rotation check instead, so
 * reconnects can't turn into a tight loop.
 */
function reconnectsRightAway(stream, now) {
  return stream.connectedAt != null && now - stream.connectedAt >= MIN_SESSION_LIFE_MS;
}

/** OpenAIRealtimeStreaming.connect() options for a meeting, minus the token. */
function meetingConnectOptions(options) {
  return {
    model: options.model,
    language: options.language,
    preconfigured: options.mode !== "byok",
  };
}

const closeAll = (streams) =>
  Promise.all(streams.filter(Boolean).map((s) => s.disconnect().catch(() => {})));

/**
 * Open a fresh session per source, then swap them all in. If any fails to
 * connect or drops before the swap, the fresh sessions are closed and the old
 * ones stay; if the meeting ended meanwhile (isCurrent() false), nothing is
 * opened or swapped.
 *
 * Handlers go on at the swap, so a failed attempt doesn't report errors to
 * the meeting while its old session is still transcribing.
 *
 * @param {Object} deps
 * @param {string[]} deps.sources
 * @param {(count: number) => Promise<string[]>} deps.fetchTokens - one per source
 * @param {() => Object} deps.createStreaming
 * @param {(streaming: Object, source: string) => void} deps.attachHandlers
 * @param {Object} deps.connectOptions
 * @param {() => boolean} deps.isCurrent
 * @param {(source: string, streaming: Object) => Object|null} deps.swapIn - returns the stream it replaced
 * @returns {Promise<{ rotated: boolean, error?: Error }>}
 */
async function rotateMeetingStreams({
  sources,
  fetchTokens,
  createStreaming,
  attachHandlers,
  connectOptions,
  isCurrent,
  swapIn,
}) {
  let tokens;
  try {
    tokens = await fetchTokens(sources.length);
  } catch (error) {
    return { rotated: false, error };
  }
  if (!isCurrent()) return { rotated: false };

  const fresh = sources.map((source, i) => ({
    source,
    token: tokens[i],
    streaming: createStreaming(),
  }));
  const results = await Promise.allSettled(
    fresh.map(({ streaming, token }) => streaming.connect({ apiKey: token, ...connectOptions }))
  );
  const failure = results.find((r) => r.status === "rejected");
  const dropped = fresh.some(({ streaming }) => !streaming.isConnected);
  if (failure || dropped || !isCurrent()) {
    await closeAll(fresh.map(({ streaming }) => streaming));
    if (!isCurrent()) return { rotated: false };
    const error = failure ? failure.reason : new Error("A new session closed before it took over");
    return { rotated: false, error };
  }

  const replaced = fresh.map(({ source, streaming }) => {
    attachHandlers(streaming, source);
    return swapIn(source, streaming);
  });
  await closeAll(replaced);
  return { rotated: true };
}

/**
 * The transcript meeting-transcription-stop returns: per source, the sessions
 * rotated out or lost earlier in the meeting, then the one open at the end.
 * @param {{ mic: Object[], system: Object[] }} retired
 * @param {Array<{ text?: string }>} results - [mic, system] disconnect results
 */
function meetingTranscriptText(retired, results) {
  return MEETING_SOURCES.flatMap((source, i) => [
    ...retired[source].map((streaming) => streaming.getFullTranscript()),
    results[i]?.text,
  ])
    .filter(Boolean)
    .join(" ");
}

module.exports = {
  SESSION_MAX_AGE_MS,
  SESSION_HARD_MAX_AGE_MS,
  sourcesToRotate,
  reconnectsRightAway,
  meetingConnectOptions,
  rotateMeetingStreams,
  meetingTranscriptText,
};
