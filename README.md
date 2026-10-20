# Earpiece

🏆 One of 5 winners at the ZEIL AI Hackathon (Oct 2026). Solo build.

A live coach for job interviews. It listens as you interview, flags questions that touch a prohibited ground under NZ's Human Rights Act, and suggests a job-related way to ask instead, with the source. It coaches the interviewer and never scores the candidate.

<img width="1280" height="715" alt="demo" src="https://github.com/user-attachments/assets/75d6ea1b-748b-4b7f-a437-dac438292527" />

**Live:** https://earpiece-rho.vercel.app (Chrome, allow the mic, or use the type box)

## Why

Small business owners hire without HR. Interviews happen between orders, and it's easy to ask "got kids?" or "where are you from?" as small talk without realising it's a question about family status or national origin. Guidance exists, but nobody reads a PDF mid-interview. Earpiece puts it on the screen at the moment it matters.

## How it works

1. Chrome's speech recognition turns the interview into text as you talk.
2. Each line goes to `/api/check`, which asks Gemini Flash-Lite whether the interviewer is asking about a prohibited ground. The response must match a strict JSON schema.
3. If it is, a card shows the ground, a one-line reason, a better question tied to the role's real requirements, and a link to the source.
4. A checklist ticks off the core questions as you ask them, so every candidate gets the same interview.

It also runs hands-free: "Earpiece, start the interview", "Earpiece, show source", "Earpiece, end interview".

<img width="710" height="638" alt="image" src="https://github.com/user-attachments/assets/6e31f79d-55e5-4477-8e50-742905bc8467" />

## Design decisions

**Coach the interviewer, never score the candidate.** Scoring people from speech is where AI hiring tools run into bias and consent problems. Earpiece ignores what the candidate says and stores nothing.

**Browser speech-to-text over the Gemini Live API.** The event ran on a shared quota with a few hours to build, and streaming audio was the riskiest part. Chrome handles transcription, and Gemini does the part that needs judgement. The cost is 1-2s of lag and no speaker separation.

**Flash-Lite over Flash.** I measured full Flash at about 40s per check on the event's shared key and Flash-Lite at about 1.6s. A live coach at 40s is useless.

**Enums for ground, verdict and source.** The model picks a source ID from a fixed list and the code maps it to a URL, so it can't invent a law or a link. Output that fails validation is retried, then sent to a fallback model, then shown as "Couldn't check that one" instead of crashing.

**A caution tier.** Some questions could be job-related but are worded in a way that invites protected information. Those get amber, not red. A coach that cries wolf gets ignored.

**Role requirements in the prompt.** The model judges job-relatedness, not keywords, so "can you lift 20kg crates?" passes for a role that involves lifting, while "any health problems?" gets flagged.

## Eval

30 labelled utterances (20 should be caught, 10 should pass), written the way Chrome transcribes speech: lowercase, no punctuation. Run on Flash-Lite.

| Variant | Pass | Caught (of 20) | False alarms (of 10) | Right ground | Median ms |
|---|---|---|---|---|---|
| Keyword regex | 24/30 | 17 | 3 | n/a | n/a |
| Naive prompt | 25/30 | 20 | 3 | 18/20 | 1199 |
| Full prompt v1 | 28/30 | 20 | 2 | 20/20 | 1100 |
| Full prompt v2 | 29/30 | 20 | 1 | 20/20 | 1166 |
| Full prompt v3 | 30/30 | 20 | 0 | 20/20 | 1115 |

v1 to v2 added a rule that questions about skills, training and rostered availability are ok. That fixed two false alarms and broke a different case. v2 to v3 added a rule that a statement asking nothing is ok, which fixed it. Without the eval I wouldn't have noticed the regression.

v2 and v3 were written after seeing failures on these same 30 cases, so 30/30 is a tuning score, not a held-out one.

<!-- If you run a held-out set, add here: "On 10 cases written afterwards without looking at the prompt: X/10." -->

Full history in `eval/results.md`.

## Run it

Needs Node 20+ and Chrome.

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

| File | What it does |
|---|---|
| `app/page.tsx` | Setup panel and live view |
| `app/api/check/route.ts` | The only endpoint. Trims input, rate-limits per IP |
| `lib/prompt.ts` | System prompt and user prompt builder |
| `lib/schema.ts` | Response schema and `validate()` |
| `lib/check.ts` | Gemini call, retries, fallback model |
| `lib/corpus.ts` | Fixed source list: id → title, url, summary |
| `lib/speech.ts` | Chrome Web Speech wrapper and voice commands |
| `eval/` | Labelled cases, eval runner, shape check |

## What I'd do next

- Separate the two voices so only the interviewer is analysed. Headphones on a video call already does this; in person it needs diarisation.
- A larger held-out eval, reviewed by an employment lawyer.
- Generate the core-question checklist from the job ad.
- Run it as an interview mode inside a hiring app, on a phone.

## How I built it

I designed it, wrote the spec, built the eval, and made the calls on scope and prompts. Claude Code wrote most of the code from that spec ([docs/build-brief.md](docs/build-brief.md)) and I reviewed it. First drafts of the system prompt, source summaries and eval cases came from Claude; I edited and checked them. Built on Next.js, Tailwind, `@google/genai` and Chrome's Web Speech API.

## Disclaimer

Not legal advice. Sources: HRC A-Z Pre-Employment Guide, Employment NZ "Discrimination when hiring", Human Rights Act 1993.

William Huang
