/**
 * Vision-LM call. Multi-provider — picks the first one configured.
 *
 * Order:
 *   1. Anthropic (claude-sonnet-4-6) if ANTHROPIC_API_KEY
 *   2. OpenAI (gpt-4o-mini) if OPENAI_API_KEY
 *   3. Ollama (llava) if OLLAMA_BASE_URL — local, no key needed
 *
 * Override with ANCHOR_SCREEN_VLM_PROVIDER=anthropic|openai|ollama.
 */
import Anthropic from "@anthropic-ai/sdk";

const MAX_TOKENS = parseInt(process.env.ANCHOR_SCREEN_VLM_MAX_TOKENS ?? "1024", 10);
const ANTHROPIC_MODEL = process.env.ANCHOR_SCREEN_VLM_MODEL ?? "claude-sonnet-4-6";
const OPENAI_MODEL = process.env.ANCHOR_SCREEN_OPENAI_MODEL ?? "gpt-4o-mini";
const OLLAMA_MODEL = process.env.ANCHOR_SCREEN_OLLAMA_MODEL ?? "llava";

type Provider = "anthropic" | "openai" | "ollama" | null;

function pickProvider(): Provider {
  const forced = process.env.ANCHOR_SCREEN_VLM_PROVIDER as Provider;
  if (forced === "anthropic" && process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (forced === "openai" && process.env.OPENAI_API_KEY) return "openai";
  if (forced === "ollama" && process.env.OLLAMA_BASE_URL) return "ollama";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.OLLAMA_BASE_URL) return "ollama";
  return null;
}

const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;

async function callAnthropic(base64: string, prompt: string) {
  if (!anthropic) throw new Error("anthropic not configured");
  const r = await anthropic.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: MAX_TOKENS,
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: "image/png", data: base64 } },
        { type: "text", text: prompt },
      ],
    }],
  });
  const text = r.content.filter(b => b.type === "text").map(b => (b as any).text).join("");
  return { text, modelId: ANTHROPIC_MODEL, tokensUsed: { input: r.usage.input_tokens, output: r.usage.output_tokens } };
}

async function callOpenAI(base64: string, prompt: string) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      max_tokens: MAX_TOKENS,
      messages: [{
        role: "user",
        content: [
          { type: "image_url", image_url: { url: `data:image/png;base64,${base64}` } },
          { type: "text", text: prompt },
        ],
      }],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}: ${await res.text().catch(() => "")}`);
  const j: any = await res.json();
  return { text: j.choices?.[0]?.message?.content ?? "", modelId: OPENAI_MODEL, tokensUsed: { input: j.usage?.prompt_tokens ?? 0, output: j.usage?.completion_tokens ?? 0 } };
}

async function callOllama(base64: string, prompt: string) {
  const url = `${process.env.OLLAMA_BASE_URL!.replace(/\/$/, "")}/api/generate`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: OLLAMA_MODEL, prompt, images: [base64], stream: false }),
  });
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
  const j: any = await res.json();
  return { text: j.response ?? "", modelId: OLLAMA_MODEL, tokensUsed: { input: 0, output: 0 } };
}

export async function describeImage(base64Png: string, prompt: string): Promise<{ ok: boolean; text?: string; error?: string; modelId?: string; tokensUsed?: { input: number; output: number } }> {
  const provider = pickProvider();
  if (!provider) return { ok: false, error: "No vision LLM configured. Set ANTHROPIC_API_KEY / OPENAI_API_KEY / OLLAMA_BASE_URL." };
  try {
    const r = provider === "anthropic" ? await callAnthropic(base64Png, prompt)
            : provider === "openai"    ? await callOpenAI(base64Png, prompt)
            :                             await callOllama(base64Png, prompt);
    return { ok: true, ...r };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}

export function vlmStatus(): { ready: boolean; provider: string; model: string; reason?: string } {
  const provider = pickProvider();
  if (!provider) return { ready: false, provider: "none", model: "-", reason: "Set ANTHROPIC_API_KEY / OPENAI_API_KEY / OLLAMA_BASE_URL" };
  const model = provider === "anthropic" ? ANTHROPIC_MODEL : provider === "openai" ? OPENAI_MODEL : OLLAMA_MODEL;
  return { ready: true, provider, model };
}
