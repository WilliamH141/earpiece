# Earpiece

Earpiece helps small-business hirers run fair, lawful interviews by catching questions that touch NZ's prohibited grounds as they're asked and suggesting a job-related way to ask instead.

**The one feature:** the interviewer says a question out loud. Within ~2s a card shows the ground, a one-line why, a rephrase tied to the role's real requirements, and a source link. Job-related questions stay clear.

A live interview coach for NZ small-business hirers. It catches questions that touch prohibited grounds under the Human Rights Act 1993 and suggests a job-related rephrase, with the source. It never scores the candidate.

## Links

- Video: [TODO]
- Live: [TODO] (use Chrome and allow the mic, or use the type box)

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

[TODO: numbers from `eval/results.md`]

### Trade-offs and cuts

No Gemini Live, no speaker separation, no accounts or history, no candidate scoring.

## Bonus claims

| Claim | Where |
| --- | --- |
| Built for hiring | [TODO timestamp or file] |
| Live | [TODO timestamp or file] |
| Prove it works | [TODO timestamp or file] |
| Ship it | [TODO timestamp or file] |
| Strict shapes | [TODO timestamp or file] |

## What I didn't write

The Next.js + Tailwind scaffold, `@google/genai`, and Chrome's Web Speech API. Most code was generated with Claude Code from my spec and reviewed by me. First drafts of the system prompt, source summaries and eval cases came from Claude; I edited and checked them.

## Disclaimer

Not legal advice. Sources: HRC A-Z Pre-Employment Guide, Employment NZ "Discrimination when hiring", Human Rights Act 1993.

William Huang, pack 63.
