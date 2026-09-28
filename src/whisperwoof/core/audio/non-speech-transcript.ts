/**
 * Text an engine returns for a capture that had no one talking in it.
 *
 * The speech gate (speech-gate.js) stops most silent captures before they
 * reach an engine, but whatever gets through, Whisper still answers with
 * something: a lone "…" or "♪", a "[BLANK_AUDIO]" tag, or a line it learned
 * from the end of subtitled videos ("字幕由Amara.org社区提供", "Thanks for
 * watching!"). None of that is what the user said, so it is never typed.
 *
 * Only whole transcripts are judged: the phrases below are dropped when they
 * are all there is, never cut out of real dictation.
 */

/** Credit lines from subtitled videos: nobody dictates these. */
const CREDIT_LINES = [
  "字幕由amaraorg社区提供",
  "字幕由amaraorg社群提供",
  "由amaraorg社区提供的字幕",
  "由amaraorg社群提供的字幕",
  "小编字幕由amaraorg社区提供",
  "小編字幕由amaraorg社區提供",
  "subtitlesbytheamaraorgcommunity",
  "请不吝点赞订阅转发打赏支持明镜与点点栏目",
  "請不吝點贊訂閱轉發打賞支持明鏡與點點欄目",
  "明镜与点点栏目",
  "優優獨播劇場yoyotelevisionseriesexclusive",
  "优优独播剧场yoyotelevisionseriesexclusive",
  "yoyotelevisionseriesexclusive",
  "中文字幕志愿者",
];

/** Video outros: dropped unless the capture held plenty of voice. */
const OUTRO_LINES = [
  "谢谢观看",
  "謝謝觀看",
  "感谢观看",
  "感謝觀看",
  "谢谢收看",
  "謝謝收看",
  "谢谢大家观看",
  "我们下期再见",
  "我們下期再見",
  "请订阅我的频道",
  "請訂閱我的頻道",
  "thanksforwatching",
  "thankyouforwatching",
  "thankyousomuchforwatching",
  "pleasesubscribe",
  "pleasesubscribetomychannel",
  "ご視聴ありがとうございました",
  "チャンネル登録お願いします",
  // Whisper's classic answer to an English silence.
  "you",
];

/** About two seconds of voice-like audio (speech-gate windows are 100ms). */
const PLENTY_OF_VOICE_WINDOWS = 20;

// [BLANK_AUDIO], (音乐), 【掌声】, *music*, ♪ … — short tags, not words.
const ANNOTATION = /\[[^\]]{0,24}\]|\([^)]{0,24}\)|（[^）]{0,24}）|【[^】]{0,24}】|\*[^*]{0,24}\*|[♪♫♬]/g;
const NOT_WORD = /[^\p{L}\p{N}]+/gu;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wholly = (lines: string[]) => new RegExp(`^(?:${lines.map(escape).join("|")})+$`, "u");
const ONLY_CREDITS = wholly(CREDIT_LINES);
const ONLY_OUTROS = wholly([...CREDIT_LINES, ...OUTRO_LINES]);

/**
 * @param voicedWindows voice-like 100ms windows the speech gate counted in
 *   the capture, or null when it couldn't measure (then only text that can
 *   never be speech is dropped).
 */
export function isNonSpeechTranscript(text: unknown, voicedWindows: number | null): boolean {
  if (typeof text !== "string") return false;
  const words = text.replace(ANNOTATION, " ").toLowerCase().replace(NOT_WORD, "");
  if (!words) return true;
  if (ONLY_CREDITS.test(words)) return true;
  const plentyOfVoice = voicedWindows === null || voicedWindows >= PLENTY_OF_VOICE_WINDOWS;
  return !plentyOfVoice && ONLY_OUTROS.test(words);
}
