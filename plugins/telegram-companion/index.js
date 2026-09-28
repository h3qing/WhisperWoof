#!/usr/bin/env node

/**
 * @whisperwoof/telegram-companion — MCP server + Telegram bot for mobile voice capture
 *
 * Runs a Telegram bot that receives voice messages on mobile, transcribes them
 * via OpenAI Whisper API, and syncs them to WhisperWoof's desktop inbox.
 *
 * Architecture:
 *   Mobile → Telegram voice msg → Bot → Whisper API → inbox.json → Desktop import
 *
 * Environment:
 *   TELEGRAM_BOT_TOKEN (required) — from @BotFather
 *   OPENAI_API_KEY (required) — for Whisper transcription
 *   TELEGRAM_ALLOWED_CHAT_IDS (required) — comma-separated chat ids allowed to use the bot.
 *     Bot names are public: anyone can message it. Messages from other chats are
 *     ignored (they're only told their own chat id, which is how you find yours).
 *   WHISPERWOOF_INBOX (optional) — path to inbox file, defaults to ~/.config/WhisperWoof/telegram-inbox.json
 *
 * The desktop app polls the inbox file and imports new entries into bf_entries.
 *
 * MCP tools:
 *   - start_bot: Start the Telegram bot listener
 *   - stop_bot: Stop the bot
 *   - get_inbox: Read pending entries from the inbox
 *   - clear_inbox: Clear imported entries
 *   - bot_status: Check if bot is running
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "fs";
import path from "path";
import os from "os";

// --- Config ---

const INBOX_PATH = process.env.WHISPERWOOF_INBOX ||
  path.join(os.homedir(), ".config", "WhisperWoof", "telegram-inbox.json");

function getBotToken() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN environment variable is required");
  return token;
}

/** Chats allowed to use the bot (TELEGRAM_ALLOWED_CHAT_IDS); empty means nobody yet. */
function allowedChatIds() {
  return new Set(
    (process.env.TELEGRAM_ALLOWED_CHAT_IDS || "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)
  );
}

// Voice notes longer or bigger than this aren't transcribed (they cost the owner's API credits).
const MAX_AUDIO_SECONDS = 10 * 60;
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;

function getOpenAIKey() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY environment variable is required");
  return key;
}

// --- Inbox (shared JSON file) ---

function readInbox() {
  try {
    if (fs.existsSync(INBOX_PATH)) {
      return JSON.parse(fs.readFileSync(INBOX_PATH, "utf-8"));
    }
  } catch { /* empty */ }
  return [];
}

function writeInbox(entries) {
  const dir = path.dirname(INBOX_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(INBOX_PATH, JSON.stringify(entries, null, 2), "utf-8");
}

function appendToInbox(entry) {
  const entries = readInbox();
  entries.push(entry);
  writeInbox(entries);
}

// --- Whisper transcription ---

async function transcribeAudio(audioBuffer, filename) {
  const key = getOpenAIKey();

  // Build multipart form data manually
  const boundary = `----WhisperWoof${Date.now()}`;
  const parts = [];

  // File part
  parts.push(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
    `Content-Type: audio/ogg\r\n\r\n`
  );
  parts.push(audioBuffer);
  parts.push("\r\n");

  // Model part
  parts.push(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="model"\r\n\r\n` +
    `whisper-1\r\n`
  );

  // Response format
  parts.push(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="response_format"\r\n\r\n` +
    `json\r\n`
  );

  parts.push(`--${boundary}--\r\n`);

  // Combine into single buffer
  const bodyParts = parts.map(p => typeof p === "string" ? Buffer.from(p) : p);
  const body = Buffer.concat(bodyParts);

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${key}`,
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    },
    body,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Whisper API error: ${response.status} ${text.slice(0, 200)}`);
  }

  const data = await response.json();
  return data.text || "";
}

// --- Telegram Bot (long polling) ---

let botRunning = false;
let pollTimeout = null;
let lastUpdateId = 0;

async function telegramAPI(method, body = null) {
  const token = getBotToken();
  const url = `https://api.telegram.org/bot${token}/${method}`;
  const options = body
    ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
    : { method: "GET" };

  const response = await fetch(url, options);
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Telegram API error: ${response.status} ${text.slice(0, 200)}`);
  }
  return response.json();
}

async function downloadFile(fileId) {
  const token = getBotToken();
  const fileInfo = await telegramAPI("getFile", { file_id: fileId });
  const filePath = fileInfo.result.file_path;
  const url = `https://api.telegram.org/file/bot${token}/${filePath}`;

  const response = await fetch(url);
  if (!response.ok) throw new Error(`File download failed: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function handleVoiceMessage(message) {
  const voice = message.voice || message.audio;
  if (!voice) return;

  const chatId = message.chat.id;
  const from = message.from?.first_name || "Unknown";

  if ((voice.duration || 0) > MAX_AUDIO_SECONDS || (voice.file_size || 0) > MAX_AUDIO_BYTES) {
    await telegramAPI("sendMessage", {
      chat_id: chatId,
      text: "❌ That's too long. Voice notes up to 10 minutes are transcribed.",
    }).catch(() => {});
    return;
  }

  try {
    // Notify user we're processing
    await telegramAPI("sendMessage", {
      chat_id: chatId,
      text: "🎙️ Transcribing...",
    });

    // Download voice file
    const audioBuffer = await downloadFile(voice.file_id);

    // Transcribe with Whisper
    const transcript = await transcribeAudio(audioBuffer, `voice_${Date.now()}.ogg`);

    if (!transcript.trim()) {
      await telegramAPI("sendMessage", {
        chat_id: chatId,
        text: "Could not transcribe audio. Try speaking louder or in a quieter environment.",
      });
      return;
    }

    // Save to inbox
    const entry = {
      id: `tg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      source: "telegram",
      rawText: transcript,
      polished: null,
      from,
      chatId,
      createdAt: new Date().toISOString(),
      durationSec: voice.duration || null,
      imported: false,
    };

    appendToInbox(entry);

    // Reply with transcript
    await telegramAPI("sendMessage", {
      chat_id: chatId,
      text: `✅ Captured:\n\n${transcript}\n\n📱 → 💻 Syncing to WhisperWoof...`,
    });
  } catch (err) {
    console.error("[WhisperWoof Telegram] Voice message failed:", err.message);
    await telegramAPI("sendMessage", {
      chat_id: chatId,
      text: "❌ Couldn't transcribe that. Try again in a moment.",
    }).catch(() => {});
  }
}

async function handleTextMessage(message) {
  const chatId = message.chat.id;
  const text = message.text || "";

  if (text === "/start") {
    await telegramAPI("sendMessage", {
      chat_id: chatId,
      text:
        "🐾 WhisperWoof Mobile Companion\n\n" +
        "Send me a voice message and I'll transcribe it and sync to your desktop.\n\n" +
        "Commands:\n" +
        "/status — Check bot status\n" +
        "/count — Number of pending entries\n" +
        "/start — This message",
    });
    return;
  }

  if (text === "/status") {
    const inbox = readInbox();
    const pending = inbox.filter((e) => !e.imported).length;
    await telegramAPI("sendMessage", {
      chat_id: chatId,
      text: `🟢 Bot running\n📬 ${pending} pending entries`,
    });
    return;
  }

  if (text === "/count") {
    const inbox = readInbox();
    const pending = inbox.filter((e) => !e.imported).length;
    await telegramAPI("sendMessage", {
      chat_id: chatId,
      text: `📬 ${pending} entries waiting to sync`,
    });
    return;
  }

  // Text messages also saved as entries
  if (text && !text.startsWith("/")) {
    const entry = {
      id: `tg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      source: "telegram",
      rawText: text,
      polished: null,
      from: message.from?.first_name || "Unknown",
      chatId,
      createdAt: new Date().toISOString(),
      durationSec: null,
      imported: false,
    };
    appendToInbox(entry);
    await telegramAPI("sendMessage", {
      chat_id: chatId,
      text: `📝 Captured text → syncing to WhisperWoof`,
    });
  }
}

async function pollUpdates() {
  if (!botRunning) return;

  try {
    const data = await telegramAPI("getUpdates", {
      offset: lastUpdateId + 1,
      timeout: 30,
      allowed_updates: ["message"],
    });

    const updates = data.result || [];
    for (const update of updates) {
      lastUpdateId = update.update_id;
      const message = update.message;
      if (!message) continue;

      const chatId = message.chat?.id;
      if (!allowedChatIds().has(String(chatId))) {
        console.error(`[WhisperWoof Telegram] Ignored a message from chat ${chatId} (not in TELEGRAM_ALLOWED_CHAT_IDS)`);
        await telegramAPI("sendMessage", {
          chat_id: chatId,
          text: `This bot is private. Your chat id is ${chatId}.`,
        }).catch(() => {});
        continue;
      }

      if (message.voice || message.audio) {
        await handleVoiceMessage(message);
      } else if (message.text) {
        await handleTextMessage(message);
      }
    }
  } catch (err) {
    // Log but don't crash the poll loop
    console.error("[WhisperWoof Telegram] Poll error:", err.message);
  }

  // Schedule next poll
  if (botRunning) {
    pollTimeout = setTimeout(pollUpdates, 1000);
  }
}

function startBot() {
  if (botRunning) return { success: true, message: "Bot already running" };
  getBotToken(); // Validate token exists
  getOpenAIKey(); // Validate key exists
  botRunning = true;
  lastUpdateId = 0;
  pollUpdates();
  return { success: true, message: "Telegram bot started" };
}

function stopBot() {
  botRunning = false;
  if (pollTimeout) {
    clearTimeout(pollTimeout);
    pollTimeout = null;
  }
  return { success: true, message: "Telegram bot stopped" };
}

// --- MCP Server ---

const server = new McpServer({
  name: "whisperwoof-telegram",
  version: "1.0.0",
});

server.tool(
  "start_bot",
  "Start the Telegram bot to receive voice messages on mobile",
  {},
  async () => {
    try {
      const result = startBot();
      return { content: [{ type: "text", text: result.message }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }] };
    }
  }
);

server.tool(
  "stop_bot",
  "Stop the Telegram bot",
  {},
  async () => {
    const result = stopBot();
    return { content: [{ type: "text", text: result.message }] };
  }
);

server.tool(
  "bot_status",
  "Check if the Telegram bot is running",
  {},
  async () => {
    const inbox = readInbox();
    const pending = inbox.filter((e) => !e.imported).length;
    return {
      content: [{
        type: "text",
        text: `Bot: ${botRunning ? "running" : "stopped"}\nPending entries: ${pending}\nInbox: ${INBOX_PATH}`,
      }],
    };
  }
);

server.tool(
  "get_inbox",
  "Read pending entries from the mobile inbox",
  {},
  async () => {
    const entries = readInbox().filter((e) => !e.imported);
    return {
      content: [{
        type: "text",
        text: entries.length > 0
          ? entries.map((e) => `[${e.createdAt}] ${e.from}: ${e.rawText}`).join("\n")
          : "No pending entries",
      }],
    };
  }
);

server.tool(
  "clear_inbox",
  "Mark all entries as imported (after desktop sync)",
  {},
  async () => {
    const entries = readInbox();
    const updated = entries.map((e) => ({ ...e, imported: true }));
    writeInbox(updated);
    return {
      content: [{ type: "text", text: `Marked ${entries.filter((e) => !e.imported).length} entries as imported` }],
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
