# WhisperWoof MCP Plugins

First-party MCP server plugins for WhisperWoof. Each plugin is an MCP server that WhisperWoof connects to via stdio.

## Available Plugins

| Plugin | What it does | API Key |
|--------|-------------|---------|
| `todoist-mcp` | Create tasks in Todoist | `TODOIST_API_KEY` |
| `ticktick-mcp` | Create tasks in TickTick | `TICKTICK_ACCESS_TOKEN` |
| `notion-mcp` | Save notes to Notion pages | `NOTION_API_KEY` |
| `slack-mcp` | Send messages to Slack | `SLACK_BOT_TOKEN` |

Also in this directory: `telegram-companion` — a standalone Telegram bot (not an MCP server) that transcribes mobile voice messages and syncs them to WhisperWoof's desktop inbox. Requires `TELEGRAM_BOT_TOKEN` and `OPENAI_API_KEY`; see its file header for setup.

## Usage

1. Set the API key as an environment variable
2. Enable the plugin in WhisperWoof Settings → Plugins
3. Use Command Bar (Cmd+K) with `/todo`, `/note`, or `/slack` prefix

## Development

Each plugin is a standalone Node.js MCP server using `@modelcontextprotocol/sdk`.

```bash
cd plugins/todoist-mcp
npm install
TODOIST_API_KEY=your-key node index.js
```

## TickTick Setup

TickTick uses OAuth2 for authentication:

1. Go to [TickTick Developer Portal](https://developer.ticktick.com/manage)
2. Click "Create App" → fill in name and redirect URL (use `http://localhost:3000/callback`)
3. Note your **Client ID** and **Client Secret**
4. Get an access token via OAuth2 authorization code flow:
   - Open: `https://ticktick.com/oauth/authorize?scope=tasks:read%20tasks:write&client_id=YOUR_CLIENT_ID&state=state&redirect_uri=http://localhost:3000/callback&response_type=code`
   - After authorizing, exchange the code for a token: `curl -X POST https://ticktick.com/oauth/token -d "code=AUTH_CODE&grant_type=authorization_code&redirect_uri=http://localhost:3000/callback" -u "CLIENT_ID:CLIENT_SECRET"`
5. Set `TICKTICK_ACCESS_TOKEN=your_token` in your environment
6. Enable the plugin in WhisperWoof → Settings → Plugins

## Creating a Custom Plugin

Any MCP server works as a WhisperWoof plugin. See the [MCP documentation](https://modelcontextprotocol.io) for how to build one.
