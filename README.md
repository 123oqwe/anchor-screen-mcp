# anchor-screen-mcp

Cross-platform screen capture + **vision LLM** understanding as an MCP server. The "if it's on screen, the agent can read it" fallback. Inspired by the way [Littlebird](https://littlebird.ai) builds always-on context — anchor exposes the same capability as a separate, swappable MCP server.

Built as part of the [anchor](https://github.com/123oqwe/anchor-backend) personal-AI ecosystem.

## Tools

| Tool | Description |
|------|------|
| `screen_describe` | Capture + ask VLM "what's on screen?" — short natural-language description |
| `screen_extract_text` | Capture + extract all visible text verbatim (OCR via VLM) |
| `screen_ask` | Capture + ask a custom question about the screen |
| `screen_status` | Capture tool detected + VLM ready (API key set) |

## Install

```bash
npx -y @anchor/screen-mcp
```

## Configuration

| Env var | Default | Meaning |
|---------|---------|------|
| `ANTHROPIC_API_KEY` | (required) | Anthropic API key for vision calls |
| `ANCHOR_SCREEN_VLM_MODEL` | `claude-sonnet-4-6` | Vision model |
| `ANCHOR_SCREEN_VLM_MAX_TOKENS` | `1024` | Max output tokens |

Future: OpenAI GPT-4 Vision and Ollama llava providers via `ANCHOR_SCREEN_VLM_PROVIDER`.

## Per-platform screen capture

|             | Implementation |
|-------------|----------------|
| **macOS**   | `screencapture -x` (built-in) |
| **Linux**   | `scrot` / `gnome-screenshot` / `maim` (whichever installed) |
| **Windows** | PowerShell + `System.Drawing.Bitmap` |

## Use with anchor-backend

```bash
ANTHROPIC_API_KEY=sk-... anchor-screen-mcp   # standalone test
```

Or register in backend (it inherits the env when MCP_ENABLED):
```bash
curl -X POST http://localhost:3001/api/mcp/servers -H "Content-Type: application/json" -d '{
  "name": "anchor-screen",
  "command": "npx",
  "args": ["-y", "@anchor/screen-mcp"],
  "env": {"ANTHROPIC_API_KEY": "sk-..."}
}'
```

4 tools auto-register as `mcp_anchor_screen_*`.

## Use with Claude Desktop

```json
{
  "mcpServers": {
    "anchor-screen": {
      "command": "npx",
      "args": ["-y", "@anchor/screen-mcp"],
      "env": { "ANTHROPIC_API_KEY": "sk-..." }
    }
  }
}
```

## Privacy WARNING

Screen captures contain **everything visible on screen** — passwords, banking, private messages. Each `screen_describe` / `screen_extract_text` / `screen_ask` call:

1. Takes a screenshot
2. Sends the **entire image** (base64-encoded) to the configured vision LLM
3. Returns the text response
4. Deletes the local PNG

You are sending pixel data to a 3rd-party API. Use only when:
- You trust the LLM provider with the visible content
- The agent calling this tool is gated by user approval (anchor-backend's L6 gate covers this when `actionClass=send_external`)
- You aren't on a screen with passwords / financial / medical data visible

## Cost

Each call uses one VLM API request. Anthropic prices vary by model:
- Claude Sonnet 4.6: ~$3/M input + $15/M output. A typical 1080p screenshot is ~1500 input tokens, plus ~200 output tokens → ~$0.007 per call.
- For continuous monitoring, batch screenshots or use a cheaper model.

## License

MIT
