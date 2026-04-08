# Findings: Meeting & Agent Engineering Review

## Date: 2026-04-07

---

## Meeting Feature — Architecture Overview

The meeting system has **three independent subsystems** that are poorly coordinated:

1. **Detection System** — `meetingDetectionEngine.js` orchestrates `meetingProcessDetector.js` (watches for Zoom/Teams/Webex/FaceTime) + `audioActivityDetector.js` (monitors mic usage). Shows notification overlay when meeting detected.

2. **Streaming Transcription System** — `useMeetingTranscription.ts` hook in renderer captures mic audio via AudioWorklet + `audioTapManager.js` captures system audio via native macOS binary. Both streams sent to OpenAI Realtime API via WebSocket for real-time transcription.

3. **WhisperWoof Bridge** — `meeting-bridge.js` accumulates transcript segments in memory. **This appears to be dead code** — the streaming system sends segments directly to the renderer via IPC, bypassing this bridge entirely.

### Critical Finding: No Local Audio Persistence

Audio chunks from both mic and system audio are streamed **directly to OpenAI** with zero local buffering. If the WebSocket disconnects (network drop, OpenAI outage, session timeout ~30min), audio is **permanently lost**. No WAV file, no PCM buffer, no fallback. For a meeting recording tool, this is the #1 risk.

### Critical Finding: No Auto-Start

The detection engine shows a notification prompt but **requires user to click "Start Recording"**. The user reported "window got created, but recording doesn't start automatically." This is by design (process detection is "context-only", not auto-trigger) but doesn't match user expectations.

### Critical Finding: OpenAI Session Timeout

OpenAI Realtime API has session limits (~30min). No reconnection or session rotation logic exists. Long meetings will silently lose transcription mid-stream.

### Memory Growth (Medium)

Multiple unbounded accumulation points for long meetings:
- `segments` React state array (no limit)
- `transcript` string concatenation (unbounded)
- DOM nodes in `MeetingTranscriptChat.tsx` (no virtualization)
- `activeMeeting.segments` in bridge (if used)

### Bug: Stale "Now" Indicator

`UpcomingMeetings.tsx` computes `now = useMemo(() => new Date(), [])` which never updates. Meetings starting after mount never show "Now" indicator.

### Bug: Win32 Audio Detection

`audioActivityDetector.js` `_checkWin32()` checks for running meeting processes instead of actual microphone activity. Semantically wrong.

### Design Issue: Two Parallel Meeting Systems

The `whisperwoof-meeting-*` IPC handlers and `meeting-transcription-*` IPC handlers are completely independent. Unclear which is authoritative. The bridge's `endMeeting()` polishes transcript with Ollama and saves to DB, but it's unclear if this path is ever triggered during real-time streaming.

---

## Agent Feature — Architecture Overview

The agent is a voice-driven conversational AI running in a separate frameless Electron BrowserWindow. User presses hotkey -> overlay appears -> recording starts -> STT -> LLM streaming response -> chat UI.

A separate "agentic actions" subsystem exists for MCP plugin-based command routing (calendar, Slack, Todoist, Notion, email) but is **completely disconnected from the UI**.

### Critical Finding: Agentic Actions are Dead Code

`agentic-actions.js` has 5 action types with intent detection and LLM parameter extraction. IPC handlers are registered (`whisperwoof-detect-action-intent`, `whisperwoof-prepare-action`). But **no UI code ever calls them**. The entire MCP action routing system is unused.

### Critical Finding: Tests Don't Test Production Code

`agentic-actions.test.ts` **duplicates** the `ACTION_PATTERNS` array and `detectActionIntent` function inline instead of importing from the source. The duplicated patterns already diverge (test has 2 todoist patterns, source has 3; test has 1 email pattern, source has 2). Tests provide false confidence.

### Bug: Race Condition in Conversation Creation

`AgentOverlay.tsx` lines 54-57: `createAgentConversation` is async. Rapid speech can trigger two calls both seeing `conversationIdRef.current === null`, creating duplicate conversations.

### Bug: No LLM Request Cancellation

Starting "New Chat" or closing overlay while streaming doesn't abort the in-flight LLM request. Response will try to update cleared/unmounted state.

### Bug: Forced Auto-Scroll

`AgentChat.tsx` scrolls to bottom on every message update regardless of user scroll position. User can't read history during streaming.

### Bug: Window Resize Issues

Custom resize handles (`handleResizeStart`) use `document.addEventListener("mousemove")` but frameless transparent windows lose mouse capture when cursor exits bounds. This causes the "random resize" behavior the user reported.

### Design Issue: No Conversation Switching UI

Conversations are persisted to SQLite but there's no UI to browse, load, or switch between saved conversations. Each "New Chat" starts fresh with no way to return to previous ones.

### Design Issue: Agent Name Confusion

`agentName.ts` manages the wake-word for dictation, NOT the agent chat. The naming overlap between "agent name" (wake word) and "agent mode" (chat overlay) is confusing.

---

## Summary: Priority Matrix

| Issue | Severity | Component |
|-------|----------|-----------|
| No local audio persistence (meeting) | CRITICAL | Meeting |
| No WebSocket reconnection for long meetings | CRITICAL | Meeting |
| Agentic actions dead code / disconnected | HIGH | Agent |
| Tests don't test production code | HIGH | Agent |
| Race condition in conversation creation | HIGH | Agent |
| No LLM request cancellation | HIGH | Agent |
| Recording doesn't auto-start | MEDIUM | Meeting |
| Window resize mouse capture loss | MEDIUM | Agent |
| Forced auto-scroll | MEDIUM | Agent |
| Memory growth for long meetings | MEDIUM | Meeting |
| Two parallel meeting systems | MEDIUM | Meeting |
| Stale "Now" indicator | LOW | Meeting |
| No conversation switching UI | LOW | Agent |
