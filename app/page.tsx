"use client";

import { useEffect, useRef, useState } from "react";
import { listen } from "@/lib/speech";
import { SOURCES, type SourceId } from "@/lib/corpus";

type Verdict = "ok" | "caution" | "flag";
type Status = "checking" | Verdict | "error";
type Mode = "standby" | "live" | "ended";
type Command = "start" | "end" | "source" | "reset" | null;
type Result = {
  ground: string;
  why: string;
  verdict: Verdict;
  rephrase: string;
  source_id: string;
  checklist_hits: string[];
  ms: number;
};
type Line = { id: number; text: string; status: Status; result?: Result; ms?: number };

const GROUND_LABELS: Record<string, string> = {
  family_status: "Family status",
  sex: "Sex or pregnancy",
  marital_status: "Marital status",
  age: "Age",
  ethnic_national_origin: "Ethnic or national origin",
  race_colour: "Race or colour",
  religious_belief: "Religious belief",
  ethical_belief: "Ethical belief",
  disability: "Disability or health",
  employment_status: "Employment status",
  political_opinion: "Political opinion",
  sexual_orientation: "Sexual orientation",
};

const DEFAULT_ROLE = "Barista, weekend café";
const DEFAULT_REQS = [
  "Saturday and Sunday shifts starting 6am",
  "Lifting 20kg milk crates",
  "Taking orders at a busy counter",
  "Must be entitled to work in New Zealand",
].join("\n");
const DEFAULT_QUESTIONS = [
  "Barista experience",
  "Weekend 6am availability",
  "Handling a rush",
  "Physical requirements (20kg crates)",
  "Start date",
].join("\n");

const DOT: Record<Status, string> = {
  checking: "bg-neutral-300 animate-pulse",
  ok: "bg-green-500",
  caution: "bg-amber-500",
  flag: "bg-red-500",
  error: "border border-neutral-400 bg-transparent",
};

// Chrome mishears the wake word, so this is deliberately loose. Matches one word ("earpiece", "airpiece") too.
const WAKE = /\b(ear|air|here|hear|a|her)\s?-?(piece|peace|peas|pease|pc)\b/i;

// Order matters: "start over" must win over "start".
function parseCommand(text: string): Command {
  const s = text.toLowerCase();
  if (/\b(reset|start over)\b/.test(s)) return "reset";
  if (/\b(end|stop|finish)\b/.test(s)) return "end";
  if (/\b(source|why)\b/.test(s)) return "source";
  if (/\b(start|begin)\b/.test(s)) return "start";
  return null;
}

// Wake-word-free commands. The WHOLE line must be the phrase, so normal sentences that
// happen to contain "end the interview" are never treated as commands.
const POLITE = "(?:(?:ok|okay|please|right|alright) )?";
const POLITE_END = "(?: please)?";
const bare = (core: string) => new RegExp(`^${POLITE}(?:${core})${POLITE_END}$`);
const BARE_COMMANDS: [Exclude<Command, null>, RegExp][] = [
  ["reset", bare("reset(?: the)? interview|start over")],
  ["end", bare("(?:end|stop|finish)(?: the)? interview")],
  ["start", bare("(?:start|begin)(?: the)? interview")],
  ["source", bare("show(?: the)? sources?")],
];

function parseBare(text: string): Command {
  const s = text.toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
  return BARE_COMMANDS.find(([, re]) => re.test(s))?.[0] ?? null;
}

const splitLines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

export default function Home() {
  const [setupOpen, setSetupOpen] = useState(false);
  const [roleTitle, setRoleTitle] = useState(DEFAULT_ROLE);
  const [reqText, setReqText] = useState(DEFAULT_REQS);
  const [qText, setQText] = useState(DEFAULT_QUESTIONS);
  const [lines, setLines] = useState<Line[]>([]);
  const [typed, setTyped] = useState("");
  const [mode, setMode] = useState<Mode>("standby");
  const [micOn, setMicOn] = useState(false);
  const [interim, setInterim] = useState("");
  const [speechMsg, setSpeechMsg] = useState("");
  const [toast, setToast] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [micEvents, setMicEvents] = useState<string[]>([]);
  const [debug, setDebug] = useState<{ text: string; outcome: string } | null>(null);

  const nextId = useRef(1);
  const lastFinal = useRef("");
  const modeRef = useRef<Mode>("standby");
  const micToken = useRef(0);
  const stopListening = useRef<(() => void) | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finalHandler = useRef<(text: string, typed?: boolean) => void>(() => {});
  const transcriptEnd = useRef<HTMLDivElement>(null);
  const cardsBox = useRef<HTMLUListElement>(null);

  const checklist = splitLines(qText).map((text, i) => ({ id: `q${i + 1}`, text }));
  const hit = new Set(lines.flatMap((l) => l.result?.checklist_hits ?? []));
  const cards = lines.filter((l) => l.result && l.result.verdict !== "ok").reverse();
  const missed = checklist.filter((c) => !hit.has(c.id));
  const unsupported = speechMsg.startsWith("Live mode needs Chrome");

  function changeMode(m: Mode) {
    modeRef.current = m;
    setMode(m);
  }

  function showToast(msg: string) {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2500);
  }

  async function handleFinal(text: string) {
    const id = nextId.current++;
    const previous = lastFinal.current;
    lastFinal.current = text;
    setLines((ls) => [...ls, { id, text, status: "checking" }]);
    const patch = (p: Partial<Line>) =>
      setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...p } : l)));
    try {
      const res = await fetch("/api/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          utterance: text,
          previous,
          role: { title: roleTitle, requirements: splitLines(reqText) },
          checklist,
        }),
      });
      const data = await res.json();
      if (data.verdict === "ok" || data.verdict === "caution" || data.verdict === "flag") {
        patch({ status: data.verdict, result: data, ms: data.ms });
      } else {
        patch({ status: "error" });
      }
    } catch {
      patch({ status: "error" });
    }
  }

  function startInterview() {
    if (modeRef.current === "standby") {
      changeMode("live");
      showToast("Interview started");
    } else if (modeRef.current === "live") {
      showToast("Already live");
    } else {
      showToast("Say “start over” first");
    }
  }

  function endInterview() {
    if (modeRef.current === "live") {
      changeMode("ended");
      setInterim("");
      showToast("Interview ended");
    } else {
      showToast("No interview running");
    }
  }

  function showSource() {
    const newest = cards[0];
    if (!newest) {
      showToast("No card to show a source for");
      return;
    }
    setExpandedId(newest.id);
    showToast("Showing source");
  }

  function resetAll() {
    setLines([]);
    setTyped("");
    setExpandedId(null);
    setInterim("");
    lastFinal.current = "";
    changeMode("standby");
    showToast("Reset");
  }

  function runCommand(cmd: Command) {
    if (cmd === "start") startInterview();
    else if (cmd === "end") endInterview();
    else if (cmd === "source") showSource();
    else if (cmd === "reset") resetAll();
    else showToast("Command not recognised");
  }

  // Anything containing the wake word is a command and never reaches /api/check.
  function route(text: string, fromTypeBox = false) {
    if (WAKE.test(text)) {
      const cmd = parseCommand(text);
      setDebug({ text, outcome: cmd ? `matched (${cmd})` : "rejected (wake word, no command word)" });
      return runCommand(cmd);
    }
    const plain = parseBare(text);
    if (plain) {
      setDebug({ text, outcome: `matched (${plain}, no wake word)` });
      return runCommand(plain);
    }
    if (fromTypeBox || modeRef.current === "live") return handleFinal(text);
    setDebug({ text, outcome: "ignored (not a command)" });
  }

  useEffect(() => {
    finalHandler.current = route;
  });

  function startMic() {
    stopListening.current?.();
    const token = ++micToken.current;
    stopListening.current = listen(
      (t) => finalHandler.current(t),
      (t) => {
        if (token === micToken.current) setInterim(t);
      },
      (state, msg) => {
        if (token !== micToken.current) return;
        setMicOn(state === "on");
        if (state === "on") setSpeechMsg("");
        if (state === "error") {
          setSpeechMsg(
            msg === "not-allowed" || msg === "service-not-allowed"
              ? "Mic is blocked. Click Enable mic and allow access."
              : (msg ?? "Microphone problem."),
          );
        }
        if (state !== "on") setInterim("");
      },
      (name) => {
        if (token === micToken.current) setMicEvents((ev) => [...ev, name].slice(-8));
      },
    );
  }

  useEffect(() => {
    const token = micToken;
    startMic();
    return () => {
      token.current++;
      stopListening.current?.();
      stopListening.current = null;
    };
  }, []);

  useEffect(() => {
    transcriptEnd.current?.scrollIntoView({ block: "nearest" });
  }, [lines, interim]);

  useEffect(() => {
    cardsBox.current?.scrollTo({ top: 0 });
  }, [cards.length]);

  function submitTyped(e: React.FormEvent) {
    e.preventDefault();
    const t = typed.trim();
    if (!t) return;
    setTyped("");
    route(t, true);
  }

  const flagCount = lines.filter((l) => l.status === "flag").length;
  const cautionCount = lines.filter((l) => l.status === "caution").length;

  const modeTabs: [Mode, string][] = [
    ["standby", "Standby"],
    ["live", "Live"],
    ["ended", "Summary"],
  ];

  return (
    <div className="relative flex min-h-screen flex-col bg-white text-ink md:h-screen md:overflow-hidden">
      <div className="bg-[#f0f0f0]">
        <div className="mx-auto flex h-10 w-full max-w-[1440px] items-center justify-between px-4 text-sm sm:px-6">
          <nav className="flex items-center gap-5" aria-label="Interview state">
            {modeTabs.map(([m, label]) => (
              <span
                key={m}
                aria-current={mode === m ? "step" : undefined}
                className={
                  mode === m
                    ? "font-medium text-brand underline decoration-2 underline-offset-[6px]"
                    : "text-muted"
                }
              >
                {label}
              </span>
            ))}
          </nav>
          <button
            type="button"
            onClick={() => setSetupOpen((o) => !o)}
            aria-expanded={setupOpen}
            className="flex items-center gap-1.5 rounded-full px-3 py-1 font-medium hover:bg-black/5"
          >
            Role: {roleTitle || "Untitled"}
            <Icon name="chevron" className={`h-4 w-4 transition-transform ${setupOpen ? "rotate-180" : ""}`} />
          </button>
        </div>
      </div>

      {setupOpen && (
        <section
          aria-label="Setup"
          className="absolute right-4 top-11 z-30 grid w-[min(94vw,760px)] gap-4 rounded-3xl bg-white p-5 shadow-2xl ring-1 ring-black/5 sm:right-6 sm:grid-cols-3"
        >
          <label className="block text-sm font-semibold">
            Role title
            <input
              value={roleTitle}
              onChange={(e) => setRoleTitle(e.target.value)}
              className="mt-1.5 w-full rounded-2xl border border-hair bg-white px-4 py-2.5 font-normal outline-none focus:border-brand"
            />
          </label>
          <label className="block text-sm font-semibold">
            Requirements (one per line)
            <textarea
              value={reqText}
              onChange={(e) => setReqText(e.target.value)}
              rows={7}
              className="mt-1.5 w-full rounded-2xl border border-hair bg-white px-4 py-2.5 font-normal outline-none focus:border-brand"
            />
          </label>
          <label className="block text-sm font-semibold">
            Core questions (one per line)
            <textarea
              value={qText}
              onChange={(e) => setQText(e.target.value)}
              rows={7}
              className="mt-1.5 w-full rounded-2xl border border-hair bg-white px-4 py-2.5 font-normal outline-none focus:border-brand"
            />
          </label>
        </section>
      )}

      <header className="rounded-b-[2rem] bg-white shadow-[0_10px_28px_-14px_rgba(20,18,27,0.22)]">
        <div className="mx-auto grid w-full max-w-[1440px] items-center gap-2 px-4 py-4 sm:px-6 md:grid-cols-[1fr_auto_1fr]">
          <p className="max-w-[340px] text-sm leading-snug text-muted">
            Coaches the interviewer. Never scores the candidate. Nothing is saved.
          </p>
          <h1 className="text-5xl font-black leading-none tracking-tighter text-brand">Earpiece</h1>
          <p className="max-w-[340px] text-sm leading-snug text-muted md:justify-self-end md:text-right">
            Before we start: I use a tool that checks my questions are fair. It doesn&apos;t record you.
          </p>
        </div>
      </header>

      <div className="mx-auto flex min-h-0 w-full max-w-[1440px] flex-1 flex-col gap-4 px-4 pt-5 sm:px-6">
        <div
          role="status"
          className="flex flex-wrap items-center gap-4 rounded-full bg-white py-2 pl-3 pr-2 shadow-[0_2px_14px_rgba(20,18,27,0.10)] ring-1 ring-black/10"
        >
          <span
            className={`relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${
              mode === "live" ? "bg-flag/10 text-flag" : "bg-brand-soft text-brand"
            }`}
          >
            {micOn && mode !== "ended" && (
              <span
                className={`absolute inset-0 animate-ping rounded-full ${mode === "live" ? "bg-flag/20" : "bg-brand/20"}`}
              />
            )}
            <Icon name="mic" className="relative h-6 w-6" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xl font-semibold">
              {mode === "standby" && (micOn ? "Say “Start the interview”" : "Microphone is off")}
              {mode === "live" && "Live. Say “End the interview” to finish"}
              {mode === "ended" && "Interview ended. Say “Start over” to reset"}
            </p>
            {speechMsg && <p className="truncate text-sm text-muted">{speechMsg}</p>}
          </div>
          {!micOn && !unsupported && (
            <button
              type="button"
              onClick={startMic}
              className="rounded-full border-[1.5px] border-brand px-6 py-3 text-lg font-semibold text-brand hover:bg-brand-soft"
            >
              Enable mic
            </button>
          )}
          {mode === "standby" && (
            <button
              type="button"
              onClick={startInterview}
              className="rounded-full bg-brand px-7 py-3 text-lg font-semibold text-white hover:bg-brand-dark"
            >
              Start interview
            </button>
          )}
          {mode === "live" && (
            <button
              type="button"
              onClick={endInterview}
              className="rounded-full bg-ink px-7 py-3 text-lg font-semibold text-white hover:bg-black"
            >
              End interview
            </button>
          )}
          {mode === "ended" && (
            <button
              type="button"
              onClick={resetAll}
              className="rounded-full bg-brand px-7 py-3 text-lg font-semibold text-white hover:bg-brand-dark"
            >
              Reset
            </button>
          )}
        </div>

        <div className="flex items-center gap-3 overflow-x-auto pb-1" aria-label="Core questions">
          <span className="shrink-0 text-sm font-semibold uppercase tracking-wide text-muted">Core questions</span>
          {checklist.map((c) => {
            const done = hit.has(c.id);
            return (
              <span
                key={c.id}
                className={`flex shrink-0 items-center gap-2 rounded-full border-[1.5px] px-4 py-2 text-base font-medium ${
                  done ? "border-brand bg-brand text-white" : "border-[#525252] text-ink"
                }`}
              >
                {done ? (
                  <Icon name="check" className="h-4 w-4" />
                ) : (
                  <Icon name="circle" className="h-4 w-4 text-muted" />
                )}
                {c.text}
              </span>
            );
          })}
        </div>

        <div className="grid min-h-0 flex-1 gap-6 pb-4 md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
          <section
            aria-label="Transcript"
            className="flex min-h-[280px] flex-col rounded-[1.75rem] bg-white p-5 shadow-[0_6px_28px_-8px_rgba(20,18,27,0.18)] ring-1 ring-black/5 md:min-h-0"
          >
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-xl font-semibold">Transcript</h2>
              <span className="text-sm text-muted">
                {lines.length} {lines.length === 1 ? "line" : "lines"}
              </span>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
              <ul className="space-y-3">
                {lines.map((l) => (
                  <li key={l.id} className="flex items-start gap-3 text-xl leading-snug">
                    <span className={`mt-2 h-3.5 w-3.5 shrink-0 rounded-full ${DOT[l.status]}`} />
                    <span className="flex-1">
                      {l.text}
                      {l.status === "error" && (
                        <span className="ml-2 inline-block rounded-full bg-neutral-100 px-3 py-0.5 align-middle text-sm text-muted">
                          Couldn&apos;t check that one
                        </span>
                      )}
                    </span>
                    {l.ms != null && <span className="mt-1.5 text-xs text-muted/70">{l.ms} ms</span>}
                  </li>
                ))}
              </ul>
              {interim && (
                <p className="mt-3 text-xl italic text-muted/70">
                  {mode === "standby" ? "Heard: " : ""}
                  {interim}
                </p>
              )}
              <div ref={transcriptEnd} />
            </div>
            <p className="mt-3 truncate font-mono text-xs text-muted/70" aria-label="Command debug">
              {debug ? `last command: ${debug.outcome}: "${debug.text}"` : "last command: none yet"}
            </p>
            <p className="mt-0.5 truncate font-mono text-xs text-muted/70" aria-label="Mic debug">
              {`mic: ${micEvents.length ? micEvents.join(" > ") : "no events yet"}`}
            </p>
            <form
              onSubmit={submitTyped}
              className="mt-3 flex items-center gap-2 rounded-full bg-white py-1.5 pl-5 pr-1.5 ring-1 ring-black/15 focus-within:ring-2 focus-within:ring-brand"
            >
              <input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder="Type a line to test"
                className="min-w-0 flex-1 bg-transparent text-lg outline-none placeholder:text-muted/70"
              />
              <button
                type="submit"
                className="flex items-center gap-2 rounded-full bg-brand px-6 py-2.5 text-lg font-semibold text-white hover:bg-brand-dark"
              >
                Send
                <Icon name="arrow" className="h-5 w-5" />
              </button>
            </form>
          </section>

          <section
            aria-label="Coaching"
            className="flex min-h-[280px] flex-col rounded-[1.75rem] bg-white p-5 shadow-[0_6px_28px_-8px_rgba(20,18,27,0.18)] ring-1 ring-black/5 md:min-h-0"
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-xl font-semibold">Coaching</h2>
              <div className="flex items-center gap-2 text-sm font-medium">
                <span className="flex items-center gap-1.5 rounded-full border border-hair px-3 py-1">
                  <span className="h-2.5 w-2.5 rounded-full bg-flag" />
                  {flagCount} flagged
                </span>
                <span className="flex items-center gap-1.5 rounded-full border border-hair px-3 py-1">
                  <span className="h-2.5 w-2.5 rounded-full bg-caution" />
                  {cautionCount} caution
                </span>
              </div>
            </div>

            {mode === "ended" && (
              <div aria-label="Summary" className="mb-4 rounded-2xl bg-brand-soft p-5">
                <h3 className="text-lg font-semibold">Interview summary</h3>
                <div className="mt-2 grid grid-cols-3 gap-4">
                  <div>
                    <p className="text-4xl font-bold text-flag">{flagCount}</p>
                    <p className="text-sm text-muted">flagged</p>
                  </div>
                  <div>
                    <p className="text-4xl font-bold text-amber-600">{cautionCount}</p>
                    <p className="text-sm text-muted">caution</p>
                  </div>
                  <div>
                    <p className="text-4xl font-bold text-brand">
                      {checklist.length - missed.length}
                      <span className="text-2xl text-muted"> of {checklist.length}</span>
                    </p>
                    <p className="text-sm text-muted">Core questions</p>
                  </div>
                </div>
                {missed.length > 0 && (
                  <p className="mt-3 text-sm text-muted">
                    Missed: {missed.map((c) => c.text).join(", ")}
                  </p>
                )}
                <p className="mt-1 text-sm font-medium text-muted">Nothing was saved.</p>
              </div>
            )}

            {cards.length === 0 && mode !== "ended" && (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center text-muted">
                <Icon name="shield" className="h-12 w-12 text-brand/50" />
                <p className="max-w-xs text-lg">
                  Questions that touch a protected ground will show up here, with a better way to ask.
                </p>
              </div>
            )}

            <ul ref={cardsBox} className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
              {cards.map((l) => {
                const r = l.result!;
                const flag = r.verdict === "flag";
                const src = SOURCES[r.source_id as SourceId];
                return (
                  <li
                    key={l.id}
                    className={`rounded-2xl border-2 p-5 ${flag ? "border-flag bg-[#fff6f7]" : "border-caution bg-[#fffaf0]"}`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span
                        className={`rounded-full px-4 py-1 text-sm font-semibold text-white ${flag ? "bg-flag" : "bg-caution"}`}
                      >
                        {GROUND_LABELS[r.ground] ?? r.ground}
                      </span>
                      <span className={`text-xs font-bold uppercase tracking-wider ${flag ? "text-flag" : "text-amber-600"}`}>
                        {flag ? "Flag" : "Caution"}
                      </span>
                    </div>
                    <p className="mt-3 text-lg italic text-muted">&ldquo;{l.text}&rdquo;</p>
                    <p className="mt-2 flex items-start gap-3 text-lg">
                      <Icon name="info" className="mt-1 h-5 w-5 shrink-0 text-muted" />
                      {r.why}
                    </p>
                    {r.rephrase && (
                      <div className="mt-4">
                        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted">
                          <Icon name="chat" className="h-4 w-4" />
                          Try instead
                        </p>
                        <p className="mt-1 text-3xl font-semibold leading-tight tracking-tight">{r.rephrase}</p>
                      </div>
                    )}
                    {src && (
                      <div className="mt-4 border-t border-hair pt-3">
                        <a
                          href={src.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-2 text-base font-medium text-brand underline underline-offset-4"
                        >
                          <Icon name="doc" className="h-5 w-5" />
                          {src.title}
                        </a>
                        {expandedId === l.id && (
                          <div className="mt-3 rounded-xl bg-brand-soft p-4 text-base">
                            <p className="font-semibold">{src.title}</p>
                            <p className="mt-1 text-muted">{src.summary}</p>
                            <p className="mt-1 break-all text-sm text-muted/80">{src.url}</p>
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      </div>

      <footer className="mx-auto w-full max-w-[1440px] border-t border-hair px-4 py-2 text-sm text-muted sm:px-6">
        Not legal advice. Sources: HRC A-Z Pre-Employment Guide, Employment NZ.
      </footer>

      {toast && (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-ink px-6 py-3 text-lg font-medium text-white shadow-2xl"
        >
          <Icon name="check" className="h-5 w-5 text-[#b9a4ff]" />
          {toast}
        </div>
      )}
    </div>
  );
}

const ICONS: Record<string, string> = {
  mic: "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z M19 11a7 7 0 0 1-14 0 M12 18v3",
  check: "M5 12.5l4.5 4.5L19 7",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z M12 11v5 M12 8h.01",
  chat: "M20 12a8 8 0 0 1-11.7 7.1L4 20l1-4.2A8 8 0 1 1 20 12Z",
  doc: "M7 3h7l5 5v13H7Z M14 3v5h5 M10 13h6 M10 17h4",
  arrow: "M5 12h14 M13 6l6 6-6 6",
  chevron: "M6 9l6 6 6-6",
  circle: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z",
  shield: "M12 3l8 3v6c0 4.5-3.2 7.8-8 9-4.8-1.2-8-4.5-8-9V6Z M9 12l2 2 4-4",
};

function Icon({ name, className = "h-5 w-5" }: { name: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d={ICONS[name]} />
    </svg>
  );
}
