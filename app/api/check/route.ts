import { check } from "@/lib/check";

const hits = new Map<string, { n: number; t: number }>(); // crude per-IP limit, protects the shared key

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now - h.t > 60_000) hits.set(ip, { n: 1, t: now });
  else if (++h.n > 40) return Response.json({ verdict: "error", reason: "rate_limited" }, { status: 429 });

  const b = await req.json().catch(() => null);
  const utterance = String(b?.utterance ?? "").trim().slice(0, 300);
  if (!utterance) return Response.json({ verdict: "error", reason: "empty" }, { status: 400 });

  const result = await check({
    utterance,
    previous: String(b?.previous ?? "").slice(0, 300),
    role: {
      title: String(b?.role?.title ?? "").slice(0, 80),
      requirements: (Array.isArray(b?.role?.requirements) ? b.role.requirements : []).slice(0, 8).map((r: unknown) => String(r).slice(0, 120)),
    },
    checklist: (Array.isArray(b?.checklist) ? b.checklist : []).slice(0, 8)
      .map((c: any) => ({ id: String(c?.id).slice(0, 20), text: String(c?.text).slice(0, 80) })),
  });
  return Response.json(result);
}
