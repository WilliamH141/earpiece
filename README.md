# Earpiece

Earpiece helps small-business hirers run fair, lawful interviews by catching questions that touch NZ's prohibited grounds as they're asked and suggesting a job-related way to ask instead.

**The one feature:** the interviewer says a question out loud. Within ~2s a card shows the ground, a one-line why, a rephrase tied to the role's real requirements, and a source link. Job-related questions stay clear.

A live interview coach for NZ small-business hirers. It catches questions that touch prohibited grounds under the Human Rights Act 1993 and suggests a job-related rephrase, with the source. It never scores the candidate.

## Links

- Video: https://www.loom.com/share/17970cacec1a42579da870023e8f9e5f
- Live: https://earpiece-rho.vercel.app (use Chrome and allow the mic, or use the type box)

## Run it

Needs Node 20+.

```bash
npm i
# .env.local
# GEMINI_API_KEY=your key
# GEMINI_MODEL=gemini-flash-lite-latest
npm run dev
```

Open http://localhost:3000 in Chrome.

```bash
npm run eval        # keyword baseline vs naive prompt vs full prompt
npm run eval:shape  # feeds bad model output to validate()
```

If `GEMINI_MODEL` or `GEMINI_API_KEY` is already exported in your shell, it overrides `.env.local`. Unset it first.

## How it's built

Chrome Web Speech → `/api/check` → Gemini Flash-Lite with a strict JSON schema → card + checklist.

| File | What it does |
| --- | --- |
| `app/page.tsx` | Setup panel and live view (client component) |
| `app/api/check/route.ts` | The only endpoint. Trims input, rate-limits per IP |
| `lib/corpus.ts` | Fixed source list: id → title, url, summary |
| `lib/prompt.ts` | System prompt and user prompt builder |
| `lib/schema.ts` | Response schema and `validate()` |
| `lib/check.ts` | Gemini call, retries, fallback model |
| `lib/speech.ts` | Chrome Web Speech wrapper |
| `eval/` | Labelled cases, eval runner, shape check |

### The prompt

It judges intent and job-relatedness, not keywords. The role's requirements are in the prompt, so a rephrase can point at the real job need. There is a caution tier for questions that could be job-related but invite protected information, so the tool doesn't cry wolf.

### The schema

`ground`, `verdict` and `source_id` are enums, so the model can't invent a link. Output that doesn't validate is retried, then on a fallback model, then shown as "Couldn't check that one".

### Sources

A fixed list. Source IDs are mapped to URLs in code, and the summaries are our own paraphrase.

### Privacy

Nothing is stored. No recordings, no transcripts, no accounts, no localStorage. The candidate is never assessed. The Gemini key stays on the server.

### Latency

Full Flash measured at about 40s per check on the shared key. Flash-Lite measured about 1.6s, so I switched.

### Eval results

30 labelled utterances (20 should be caught, 10 should pass), written the way Chrome transcribes speech. Run on Flash-Lite.

| Variant | Pass | Caught (of 20) | False alarms (of 10) | Right ground | Median ms |
| --- | --- | --- | --- | --- | --- |
| Keyword regex | 24/30 | 17 | 3 | n/a | n/a |
| Naive prompt | 25/30 | 20 | 3 | 18/20 | 1199 |
| Full prompt v1 | 28/30 | 20 | 2 | 20/20 | 1100 |
| Full prompt v2 | 29/30 | 20 | 1 | 20/20 | 1166 |
| Full prompt v3 | 30/30 | 20 | 0 | 20/20 | 1115 |

v1 to v2: one rule saying skills, training and rostered availability are ok. That fixed two false alarms and broke one case. v2 to v3: one rule saying a statement that asks nothing is ok. That fixed it.

Caveat: v2 and v3 were written after seeing failures on these same 30 cases, so 30/30 is not a held-out score. Full history in `eval/results.md`.

### Trade-offs and cuts

No Gemini Live, no speaker separation, no accounts or history, no candidate scoring.

## Bonus claims

Video timestamps are approximate (from my script). Files are in this repo.

| Claim | Where |
| --- | --- |
| No hands | Video, whole demo ~0:25 to 1:45, voice only, hands in shot |
| Built for hiring | Video ~0:00 to 0:25 (who and why) and ~0:45 (the moment it saves them time) |
| Live | Video ~0:30 to 1:40, real-time speech in Chrome (not the Gemini Live API) |
| Prove it works | Video ~1:45 to 2:35. `eval/cases.json` (30 cases), `eval/run.ts`, scores in `eval/results.md` and the README table |
| Break it fix it | Video ~1:22, prompt injection still flagged. Also eval case e20 |
| Ship it | https://earpiece-rho.vercel.app, no login |
| Strict shapes | `lib/schema.ts` and the bad-output path in `eval/shape-check.ts` |

## What I didn't write

The Next.js + Tailwind scaffold, `@google/genai`, and Chrome's Web Speech API. Most code was generated with Claude Code from my spec and reviewed by me. First drafts of the system prompt, source summaries and eval cases came from Claude; I edited and checked them.

## Disclaimer

Not legal advice. Sources: HRC A-Z Pre-Employment Guide, Employment NZ "Discrimination when hiring", Human Rights Act 1993.

William Huang, pack 63.
