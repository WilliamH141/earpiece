import { Type } from "@google/genai";
import { SOURCE_IDS } from "./corpus";

export const GROUNDS = ["none", "sex", "marital_status", "religious_belief", "ethical_belief", "race_colour",
  "ethnic_national_origin", "disability", "age", "political_opinion", "employment_status", "family_status",
  "sexual_orientation"] as const;
export const VERDICTS = ["ok", "caution", "flag"] as const;

export type Check = {
  is_interviewer_question: boolean;
  ground: (typeof GROUNDS)[number];
  why: string;
  verdict: (typeof VERDICTS)[number];
  rephrase: string;
  source_id: string;
  checklist_hits: string[];
};

const FIELDS = ["is_interviewer_question", "ground", "why", "verdict", "rephrase", "source_id", "checklist_hits"];

export function buildSchema(checklistIds: string[]) {
  return {
    type: Type.OBJECT,
    properties: {
      is_interviewer_question: { type: Type.BOOLEAN },
      ground: { type: Type.STRING, enum: [...GROUNDS] },
      why: { type: Type.STRING },
      verdict: { type: Type.STRING, enum: [...VERDICTS] },
      rephrase: { type: Type.STRING },
      source_id: { type: Type.STRING, enum: ["none", ...SOURCE_IDS] },
      checklist_hits: {
        type: Type.ARRAY,
        items: checklistIds.length ? { type: Type.STRING, enum: checklistIds } : { type: Type.STRING },
      },
    },
    required: FIELDS,
    propertyOrdering: FIELDS,
  };
}

// Bad-output path (Strict shapes): anything off-schema returns null; the caller retries, then shows "couldn't check".
export function validate(raw: string | undefined, checklistIds: string[]): Check | null {
  let o: any;
  try { o = JSON.parse(raw ?? ""); } catch { return null; }
  if (!o || typeof o !== "object") return null;
  if (!(VERDICTS as readonly string[]).includes(o.verdict)) return null;
  if (!(GROUNDS as readonly string[]).includes(o.ground)) return null;
  if (typeof o.why !== "string" || typeof o.rephrase !== "string") return null;
  if (o.verdict !== "ok" && !(SOURCE_IDS as string[]).includes(o.source_id)) return null; // a flag must cite a real source
  return {
    is_interviewer_question: Boolean(o.is_interviewer_question),
    ground: o.ground,
    why: o.why.slice(0, 160),
    verdict: o.verdict,
    rephrase: o.rephrase.slice(0, 200),
    source_id: o.source_id,
    checklist_hits: Array.isArray(o.checklist_hits)
      ? o.checklist_hits.filter((id: unknown) => typeof id === "string" && checklistIds.includes(id))
      : [],
  };
}
