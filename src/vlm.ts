/**
 * Vision-LM call. Sends a base64 PNG + a prompt to Anthropic's vision API,
 * returns the text response.
 *
 * Anthropic is the default; future: add OpenAI / Ollama llava providers
 * via env var ANCHOR_SCREEN_VLM_PROVIDER.
 */
import Anthropic from "@anthropic-ai/sdk";

const MODEL = process.env.ANCHOR_SCREEN_VLM_MODEL ?? "claude-sonnet-4-6";
const MAX_TOKENS = parseInt(process.env.ANCHOR_SCREEN_VLM_MAX_TOKENS ?? "1024", 10);

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

export async function describeImage(base64Png: string, prompt: string): Promise<{ ok: boolean; text?: string; error?: string; modelId?: string; tokensUsed?: { input: number; output: number } }> {
  if (!anthropic) {
    return { ok: false, error: "ANTHROPIC_API_KEY not set — anchor-screen-mcp needs a vision LLM key. Set it in env when launching the server." };
  }
  try {
    const r = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/png", data: base64Png } },
          { type: "text", text: prompt },
        ],
      }],
    });
    const text = r.content
      .filter(b => b.type === "text")
      .map(b => (b as any).text)
      .join("");
    return {
      ok: true, text,
      modelId: MODEL,
      tokensUsed: { input: r.usage.input_tokens, output: r.usage.output_tokens },
    };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}

export function vlmStatus(): { ready: boolean; provider: string; model: string; reason?: string } {
  if (!anthropic) return { ready: false, provider: "anthropic", model: MODEL, reason: "ANTHROPIC_API_KEY not set" };
  return { ready: true, provider: "anthropic", model: MODEL };
}
