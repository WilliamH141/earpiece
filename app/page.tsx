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

  return (
    <main className="mx-auto flex w-full max-w-[1440px] flex-col gap-3 px-4 py-3 md:h-screen md:overflow-hidden sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <div>
          <h1 className="text-2xl font-semibold leading-tight tracking-tight text-indigo-600">Earpiece</h1>
          <p className="text-sm text-neutral-600">
            Coaches the interviewer. Never scores the candidate. Nothing is saved.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {mode === "standby" && micOn && (
            <p className="flex items-center gap-2 text-lg font-medium">
              <span className="h-3 w-3 animate-pulse rounded-full bg-indigo-500" />
              Say “Start the interview”
            </p>
          )}
          {mode === "live" && (
            <p className="flex items-center gap-2 text-lg font-medium">
              <span className="h-3 w-3 animate-pulse rounded-full bg-red-500" />
              Live. Say “End the interview” to finish
            </p>
          )}
          {mode === "ended" && (
            <p className="text-lg font-medium">Interview ended. Say “Start over” to reset</p>
          )}
          {!micOn && !unsupported && (
            <button
              type="button"
              onClick={startMic}
              className="rounded-full bg-indigo-600 px-5 py-2 font-medium text-white hover:bg-indigo-700"
            >
              Enable mic
            </button>
          )}
          {speechMsg && <p className="text-sm text-neutral-600">{speechMsg}</p>}

          {mode === "standby" && (
            <button
              type="button"
              onClick={startInterview}
              className="rounded-full border border-neutral-300 px-5 py-2 font-medium hover:bg-neutral-50"
            >
              Start interview
            </button>
          )}
          {mode === "live" && (
            <button
              type="button"
              onClick={endInterview}
              className="rounded-full bg-neutral-800 px-5 py-2 font-medium text-white hover:bg-neutral-900"
            >
              End interview
            </button>
          )}
          {mode === "ended" && (
            <button
              type="button"
              onClick={resetAll}
              className="rounded-full bg-indigo-600 px-5 py-2 font-medium text-white hover:bg-indigo-700"
            >
              Reset
            </button>
          )}
        </div>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-neutral-600">
        <p>Before we start: I use a tool that checks my questions are fair. It doesn&apos;t record you.</p>
        <button
          type="button"
          onClick={() => setSetupOpen((o) => !o)}
          className="rounded-lg border border-neutral-200 px-3 py-1 hover:bg-neutral-50"
          aria-expanded={setupOpen}
        >
          Setup: {roleTitle || "Untitled role"} · {setupOpen ? "Hide" : "Show"}
        </button>
      </div>

      {setupOpen && (
        <section className="grid gap-3 rounded-xl border border-neutral-200 p-3 sm:grid-cols-3">
          <label className="block text-sm font-medium">
            Role title
            <input
              value={roleTitle}
              onChange={(e) => setRoleTitle(e.target.value)}
              className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-1.5 font-normal"
            />
          </label>
          <label className="block text-sm font-medium">
            Requirements (one per line)
            <textarea
              value={reqText}
              onChange={(e) => setReqText(e.target.value)}
              rows={4}
              className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-1.5 font-normal"
            />
          </label>
          <label className="block text-sm font-medium">
            Core questions (one per line)
            <textarea
              value={qText}
              onChange={(e) => setQText(e.target.value)}
              rows={4}
              className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-1.5 font-normal"
            />
          </label>
        </section>
      )}

      <div className="grid min-h-0 flex-1 gap-6 md:grid-cols-2">
        <section aria-label="Transcript" className="flex min-h-0 flex-col">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">Transcript</h2>
          <div className="min-h-[200px] flex-1 overflow-y-auto md:min-h-0">
            <ul className="space-y-2">
              {lines.map((l) => (
                <li key={l.id} className="flex items-start gap-3 text-lg">
                  <span className={`mt-2.5 h-3 w-3 shrink-0 rounded-full ${DOT[l.status]}`} />
                  <span className="flex-1">
                    {l.text}
                    {l.status === "error" && (
                      <span className="ml-2 inline-block rounded-full bg-neutral-100 px-3 py-0.5 align-middle text-sm text-neutral-500">
                        Couldn&apos;t check that one
                      </span>
                    )}
                  </span>
                  {l.ms != null && <span className="mt-1.5 text-xs text-neutral-400">{l.ms} ms</span>}
                </li>
              ))}
            </ul>
            {interim && (
              <p className="mt-2 text-lg italic text-neutral-400">
                {mode === "standby" ? "Heard: " : ""}
                {interim}
              </p>
            )}
            <div ref={transcriptEnd} />
          </div>
          <p className="mt-2 truncate font-mono text-xs text-neutral-400" aria-label="Command debug">
            {debug ? `last command: ${debug.outcome}: "${debug.text}"` : "last command: none yet"}
          </p>
          <p className="mt-1 truncate font-mono text-xs text-neutral-400" aria-label="Mic debug">
            {`mic: ${micEvents.length ? micEvents.join(" > ") : "no events yet"}`}
          </p>
          <form onSubmit={submitTyped} className="mt-2 flex gap-2">
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="Type a line to test"
              className="flex-1 rounded-lg border border-neutral-300 px-3 py-2"
            />
            <button
              type="submit"
              className="rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-700"
            >
              Send
            </button>
          </form>
        </section>

        <section aria-label="Coaching" className="flex min-h-0 flex-col gap-3">
          {mode === "ended" && (
            <div aria-label="Summary" className="rounded-xl border border-neutral-200 p-3">
              <h2 className="text-lg font-semibold">Interview summary</h2>
              <p className="mt-1 text-lg">
                <span className="font-semibold text-red-600">{flagCount}</span> flagged ·{" "}
                <span className="font-semibold text-amber-600">{cautionCount}</span> caution
              </p>
              <p>
                Core questions: {checklist.length - missed.length} of {checklist.length}
              </p>
              {missed.length > 0 && (
                <p className="text-sm text-neutral-600">Missed: {missed.map((c) => c.text).join(", ")}</p>
              )}
              <p className="mt-1 text-sm text-neutral-500">Nothing was saved.</p>
            </div>
          )}

          <div className="flex min-h-[160px] flex-1 flex-col md:min-h-0">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">Coaching</h2>
            <ul ref={cardsBox} className="min-h-0 flex-1 space-y-3 overflow-y-auto">
              {cards.map((l) => {
                const r = l.result!;
                const src = SOURCES[r.source_id as SourceId];
                return (
                  <li
                    key={l.id}
                    className={`rounded-xl border-2 p-4 ${r.verdict === "flag" ? "border-red-500" : "border-amber-500"}`}
                  >
                    <p
                      className={`text-sm font-semibold uppercase tracking-wide ${
                        r.verdict === "flag" ? "text-red-600" : "text-amber-600"
                      }`}
                    >
                      {GROUND_LABELS[r.ground] ?? r.ground}
                    </p>
                    <p className="mt-1 text-neutral-500">&ldquo;{l.text}&rdquo;</p>
                    <p className="mt-1">{r.why}</p>
                    {r.rephrase && (
                      <p className="mt-2 text-sm font-medium text-neutral-500">
                        Try instead:
                        <span className="mt-1 block text-2xl font-semibold leading-snug text-neutral-900">
                          {r.rephrase}
                        </span>
                      </p>
                    )}
                    {src && (
                      <a
                        href={src.url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-2 inline-block text-sm text-indigo-600 underline"
                      >
                        {src.title}
                      </a>
                    )}
                    {src && expandedId === l.id && (
                      <div className="mt-2 rounded-lg bg-neutral-50 p-3 text-sm text-neutral-700">
                        <p className="font-medium">{src.title}</p>
                        <p className="mt-1">{src.summary}</p>
                        <p className="mt-1 break-all text-neutral-500">{src.url}</p>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>

          <div>
            <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-neutral-500">Core questions</h2>
            <ul className="space-y-1">
              {checklist.map((c) => (
                <li key={c.id} className="flex items-center gap-2">
                  <span
                    className={`flex h-5 w-5 items-center justify-center rounded border text-xs ${
                      hit.has(c.id) ? "border-indigo-600 bg-indigo-600 text-white" : "border-neutral-300"
                    }`}
                  >
                    {hit.has(c.id) ? "✓" : ""}
                  </span>
                  <span className={hit.has(c.id) ? "text-neutral-400 line-through" : ""}>{c.text}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>

      <footer className="border-t border-neutral-200 pt-2 text-sm text-neutral-500">
        Not legal advice. Sources: HRC A-Z Pre-Employment Guide, Employment NZ.
      </footer>

      {toast && (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-neutral-900 px-5 py-2 text-white shadow-lg"
        >
          {toast}
        </div>
      )}
    </main>
  );
}
