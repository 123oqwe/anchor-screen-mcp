#!/usr/bin/env node
/**
 * anchor-screen-mcp — Littlebird-style screen capture + VLM understanding
 * as MCP server.
 *
 * Speaks MCP 2025-06-18 over stdio. Per-OS screencapture + Anthropic vision
 * API. The "fallback for any app anchor doesn't have a per-app integration
 * for" — if you can see it on screen, anchor can read it.
 *
 * Tools (4):
 *   screen_describe       — capture + ask VLM "what's on screen?" (general)
 *   screen_extract_text   — capture + extract verbatim text (OCR-ish)
 *   screen_ask            — capture + custom prompt (user provides question)
 *   screen_status         — capture tool detected + VLM ready
 *
 * Privacy WARNING: screen frames contain everything visible — passwords,
 * private messages, banking. Use only when you understand what you're
 * sending to the VLM. Caller (anchor-backend) is responsible for gating.
 */
import { captureScreen, screenshotToBase64, cleanupScreenshot, statusProbe } from "./screenshot.js";
import { describeImage, vlmStatus } from "./vlm.js";

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "anchor-screen-mcp", version: "0.1.0" };

interface JsonRpcRequest { jsonrpc: "2.0"; id?: number | string; method: string; params?: any }
interface JsonRpcResponse { jsonrpc: "2.0"; id: number | string; result?: any; error?: { code: number; message: string } }

const TOOLS = [
  {
    name: "screen_describe",
    description: "Take a screenshot and ask a vision LLM what's on screen. Returns a short natural-language description. Use when the agent needs to know the user's current visual context for any app.",
    inputSchema: {
      type: "object",
      properties: {
        focus: { type: "string", description: "Optional hint, e.g. 'focus on the active window' or 'list any visible names'" },
      },
    },
  },
  {
    name: "screen_extract_text",
    description: "Take a screenshot and extract all visible text verbatim (OCR-style via vision LLM). Useful when the agent needs to read text from any app — including PDFs, native apps, images.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "screen_ask",
    description: "Take a screenshot and ask the vision LLM a specific question about it. Use for grounded queries: 'is there a notification on screen', 'what's the price shown', 'where is the Submit button'.",
    inputSchema: {
      type: "object",
      properties: { question: { type: "string", description: "Question about the current screen content" } },
      required: ["question"],
    },
  },
  {
    name: "screen_status",
    description: "Platform + screenshot tool detected + VLM ready (API key set).",
    inputSchema: { type: "object", properties: {} },
  },
];

async function captureAndAsk(prompt: string): Promise<string> {
  const cap = captureScreen();
  if (!cap.ok || !cap.path) throw new Error(`screenshot failed: ${cap.error}`);
  try {
    const base64 = screenshotToBase64(cap.path);
    const r = await describeImage(base64, prompt);
    if (!r.ok) throw new Error(`VLM failed: ${r.error}`);
    return JSON.stringify({ ok: true, text: r.text, modelId: r.modelId, tokensUsed: r.tokensUsed, screenshotBytes: cap.sizeBytes }, null, 2);
  } finally {
    cleanupScreenshot(cap.path);
  }
}

async function callTool(name: string, args: Record<string, any>): Promise<string> {
  switch (name) {
    case "screen_describe": {
      const focus = args.focus ? ` Focus: ${args.focus}.` : "";
      const prompt = `Describe what's on this screen in 2-4 sentences. Mention the app/window if identifiable, the main content, and any obvious user state (input field focused, modal open, etc).${focus}`;
      return await captureAndAsk(prompt);
    }
    case "screen_extract_text": {
      const prompt = "Extract all visible text on this screen verbatim. Preserve order and approximate layout. Do not describe — only transcribe.";
      return await captureAndAsk(prompt);
    }
    case "screen_ask": {
      if (!args.question) throw new Error("question required");
      return await captureAndAsk(`Question about the current screen: ${args.question}\n\nAnswer concisely based only on what you can see.`);
    }
    case "screen_status":
      return JSON.stringify({ capture: statusProbe(), vlm: vlmStatus() }, null, 2);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function handleRequest(req: JsonRpcRequest): Promise<JsonRpcResponse | null> {
  const id = req.id ?? 0;
  if (req.method === "initialize") {
    return { jsonrpc: "2.0", id, result: { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: SERVER_INFO } };
  }
  if (req.method === "notifications/initialized") return null;
  if (req.method === "tools/list") return { jsonrpc: "2.0", id, result: { tools: TOOLS } };
  if (req.method === "tools/call") {
    const { name, arguments: args } = req.params ?? {};
    try {
      const text = await callTool(name, args ?? {});
      return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text }] } };
    } catch (err: any) {
      return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: `Error: ${err?.message ?? String(err)}` }], isError: true } };
    }
  }
  return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${req.method}` } };
}

let buffer = "";
process.stdin.setEncoding("utf-8");
process.stdin.on("data", async chunk => {
  buffer += chunk;
  let nl: number;
  while ((nl = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    try {
      const req: JsonRpcRequest = JSON.parse(line);
      const res = await handleRequest(req);
      if (res) process.stdout.write(JSON.stringify(res) + "\n");
    } catch (err: any) {
      process.stderr.write(`[parse-error] ${err?.message ?? err}\n`);
    }
  }
});
process.stdin.on("end", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));

process.stderr.write(`[anchor-screen-mcp] ready on stdio (platform=${process.platform})\n`);
