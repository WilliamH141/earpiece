"use client";

import { useEffect, useRef, useState } from "react";
import { listen } from "@/lib/speech";
import { SOURCES, type SourceId } from "@/lib/corpus";

type Verdict = "ok" | "caution" | "flag";
type Status = "checking" | Verdict | "error";
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

const splitLines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

export default function Home() {
  const [setupOpen, setSetupOpen] = useState(true);
  const [roleTitle, setRoleTitle] = useState(DEFAULT_ROLE);
  const [reqText, setReqText] = useState(DEFAULT_REQS);
  const [qText, setQText] = useState(DEFAULT_QUESTIONS);
  const [lines, setLines] = useState<Line[]>([]);
  const [typed, setTyped] = useState("");
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [speechMsg, setSpeechMsg] = useState("");

  const nextId = useRef(1);
  const lastFinal = useRef("");
  const stopListening = useRef<(() => void) | null>(null);
  const finalHandler = useRef<(text: string) => void>(() => {});

  const checklist = splitLines(qText).map((text, i) => ({ id: `q${i + 1}`, text }));
  const hit = new Set(lines.flatMap((l) => l.result?.checklist_hits ?? []));

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

  useEffect(() => {
    finalHandler.current = handleFinal;
  });
  useEffect(() => () => stopListening.current?.(), []);

  function toggleListening() {
    if (listening) {
      stopListening.current?.();
      stopListening.current = null;
      setInterim("");
      return;
    }
    setSpeechMsg("");
    stopListening.current = listen(
      (t) => finalHandler.current(t),
      setInterim,
      (state, msg) => {
        setListening(state === "on");
        if (state === "error") setSpeechMsg(msg ?? "Microphone problem.");
        if (state !== "on") setInterim("");
      },
    );
  }

  function submitTyped(e: React.FormEvent) {
    e.preventDefault();
    const t = typed.trim();
    if (!t) return;
    setTyped("");
    handleFinal(t);
  }

  const cards = lines
    .filter((l) => l.result && l.result.verdict !== "ok")
    .reverse();

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <header className="mb-6">
        <h1 className="text-3xl font-semibold tracking-tight text-indigo-600">Earpiece</h1>
        <p className="text-neutral-600">
          Coaches the interviewer. Never scores the candidate. Nothing is saved.
        </p>
      </header>

      <section className="mb-6 rounded-xl border border-neutral-200">
        <button
          type="button"
          onClick={() => setSetupOpen((o) => !o)}
          className="flex w-full items-center justify-between px-4 py-3 text-left font-medium"
          aria-expanded={setupOpen}
        >
          Setup: {roleTitle || "Untitled role"}
          <span className="text-neutral-400">{setupOpen ? "Hide" : "Show"}</span>
        </button>
        {setupOpen && (
          <div className="grid gap-4 border-t border-neutral-200 p-4 sm:grid-cols-3">
            <label className="block text-sm font-medium">
              Role title
              <input
                value={roleTitle}
                onChange={(e) => setRoleTitle(e.target.value)}
                className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 font-normal"
              />
            </label>
            <label className="block text-sm font-medium">
              Requirements (one per line)
              <textarea
                value={reqText}
                onChange={(e) => setReqText(e.target.value)}
                rows={5}
                className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 font-normal"
              />
            </label>
            <label className="block text-sm font-medium">
              Core questions (one per line)
              <textarea
                value={qText}
                onChange={(e) => setQText(e.target.value)}
                rows={5}
                className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 font-normal"
              />
            </label>
          </div>
        )}
      </section>

      <p className="mb-3 text-sm text-neutral-600">
        Before we start: I use a tool that checks my questions are fair. It doesn&apos;t record you.
      </p>

      <div className="mb-6 flex items-center gap-4">
        <button
          type="button"
          onClick={toggleListening}
          className={`flex items-center gap-3 rounded-full px-6 py-3 text-lg font-medium text-white ${
            listening ? "bg-neutral-800 hover:bg-neutral-900" : "bg-indigo-600 hover:bg-indigo-700"
          }`}
        >
          {listening && <span className="h-3 w-3 animate-pulse rounded-full bg-red-500" />}
          {listening ? "Stop" : "Start"}
        </button>
        {speechMsg && <p className="text-sm text-neutral-600">{speechMsg}</p>}
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <section aria-label="Transcript">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">
            Transcript
          </h2>
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
          {interim && <p className="mt-2 text-lg italic text-neutral-400">{interim}</p>}
          <form onSubmit={submitTyped} className="mt-4 flex gap-2">
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

        <section aria-label="Coaching cards">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">
            Coaching
          </h2>
          <ul className="space-y-3">
            {cards.map((l) => {
              const r = l.result!;
              const src = SOURCES[r.source_id as SourceId];
              return (
                <li
                  key={l.id}
                  className={`rounded-xl border-2 p-4 ${
                    r.verdict === "flag" ? "border-red-500" : "border-amber-500"
                  }`}
                >
                  <p
                    className={`text-sm font-semibold uppercase tracking-wide ${
                      r.verdict === "flag" ? "text-red-600" : "text-amber-600"
                    }`}
                  >
                    {GROUND_LABELS[r.ground] ?? r.ground}
                  </p>
                  <p className="mt-1 text-neutral-500">&ldquo;{l.text}&rdquo;</p>
                  <p className="mt-2">{r.why}</p>
                  {r.rephrase && (
                    <p className="mt-3 text-sm font-medium text-neutral-500">
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
                      className="mt-3 inline-block text-sm text-indigo-600 underline"
                    >
                      {src.title}
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
          <h2 className="mb-2 mt-8 text-sm font-semibold uppercase tracking-wide text-neutral-500">
            Core questions
          </h2>
          <ul className="space-y-1">
            {checklist.map((c) => (
              <li key={c.id} className="flex items-center gap-2">
                <span
                  className={`flex h-5 w-5 items-center justify-center rounded border text-xs ${
                    hit.has(c.id)
                      ? "border-indigo-600 bg-indigo-600 text-white"
                      : "border-neutral-300"
                  }`}
                >
                  {hit.has(c.id) ? "✓" : ""}
                </span>
                <span className={hit.has(c.id) ? "text-neutral-400 line-through" : ""}>{c.text}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <footer className="mt-10 border-t border-neutral-200 pt-4 text-sm text-neutral-500">
        Not legal advice. Sources: HRC A-Z Pre-Employment Guide, Employment NZ.
      </footer>
    </main>
  );
}
