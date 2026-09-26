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
const MEETING_SOURCES = ["mic", "system"];

/**
 * The streams to rotate now: none while no meeting is streaming or a rotation
 * is under way; otherwise each stream whose session went live maxAgeMs ago or
 * more, except one mid-reconnect (a reconnect opens a fresh session anyway).
 *
 * Age is per session (connectedAt), not per meeting: meeting mode pre-warms
 * sessions before recording starts, and a stream that reconnected is younger.
 * @returns {string[]} "mic" | "system"
 */
function sourcesToRotate({
  active,
  now,
  rotating,
  streams,
  reconnecting = {},
  maxAgeMs = SESSION_MAX_AGE_MS,
}) {
  if (!active || rotating) return [];
  return MEETING_SOURCES.filter((source) => {
    const connectedAt = streams[source]?.connectedAt;
    return connectedAt != null && now - connectedAt >= maxAgeMs && !reconnecting[source];
  });
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
 * connect, drops before the swap, or the meeting ended meanwhile (isCurrent()
 * false), the fresh sessions are closed and the old ones stay.
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
  let fresh;
  try {
    const tokens = await fetchTokens(sources.length);
    fresh = sources.map((source, i) => ({
      source,
      token: tokens[i],
      streaming: createStreaming(),
    }));
  } catch (error) {
    return { rotated: false, error };
  }

  const results = await Promise.allSettled(
    fresh.map(({ streaming, token }) => streaming.connect({ apiKey: token, ...connectOptions }))
  );
  const failure = results.find((r) => r.status === "rejected");
  if (failure || !isCurrent() || fresh.some(({ streaming }) => !streaming.isConnected)) {
    await closeAll(fresh.map(({ streaming }) => streaming));
    return failure ? { rotated: false, error: failure.reason } : { rotated: false };
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
  sourcesToRotate,
  meetingConnectOptions,
  rotateMeetingStreams,
  meetingTranscriptText,
};
