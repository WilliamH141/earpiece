import { GoogleGenAI } from "@google/genai";
import { SYSTEM_PROMPT, buildUserPrompt, type CheckInput } from "./prompt";
import { buildSchema, validate, type Check } from "./schema";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const PRIMARY = process.env.GEMINI_MODEL ?? "gemini-flash-latest";
const FALLBACK = "gemini-flash-lite-latest"; // used after 2 failed attempts

// Lowest thinking = lowest latency. Gemini 3.x takes thinkingLevel, 2.5 takes thinkingBudget: 0.
// If the model rejects a setting with a 400 that mentions thinking, step to the next one.
const THINKING: (Record<string, unknown> | undefined)[] = [
  { thinkingLevel: "MINIMAL" }, { thinkingLevel: "LOW" }, { thinkingBudget: 0 }, undefined,
];
let t = 0;

export type CheckResult = (Check & { ms: number; model?: string }) | { verdict: "error"; reason: string };

export async function check(input: CheckInput, opts: { system?: string; user?: string } = {}): Promise<CheckResult> {
  const ids = input.checklist.map((c) => c.id);
  const schema = buildSchema(ids);
  let reason = "unknown";
  for (let attempt = 0; attempt < 4; attempt++) {
    const model = attempt < 2 ? PRIMARY : FALLBACK;
    const t0 = Date.now();
    try {
      const res = await ai.models.generateContent({
        model,
        contents: opts.user ?? buildUserPrompt(input),
        config: {
          systemInstruction: opts.system ?? SYSTEM_PROMPT,
          responseMimeType: "application/json",
          responseSchema: schema,
          temperature: 0,
          ...(THINKING[t] ? { thinkingConfig: THINKING[t] as any } : {}),
        },
      });
      const out = validate(res.text, ids);
      if (out) return { ...out, ms: Date.now() - t0, model: res.modelVersion };
      reason = "bad_shape";
    } catch (e: any) {
      const status = e?.status;
      reason = String(status ?? e?.message ?? e);
      if (status === 400 && t < THINKING.length - 1 && /think/i.test(String(e?.message))) { t++; attempt--; continue; }
      if (status === 429 || (status >= 500 && status < 600)) {
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt + Math.random() * 250));
        continue;
      }
      break;
    }
  }
  return { verdict: "error", reason };
}
