import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { check, type CheckResult } from "../lib/check";

type Case = { id: string; u: string; prev?: string; expect: string[]; grounds?: string[]; note?: string };
type Variant = "keyword" | "naive" | "full";
type Outcome = { verdict: string; ground?: string; ms?: number };

const cases: Case[] = JSON.parse(readFileSync(join(__dirname, "cases.json"), "utf8"));

const ROLE = {
  title: "Barista, weekend café",
  requirements: [
    "Saturday and Sunday shifts starting 6am",
    "Lifting 20kg milk crates",
    "Taking orders at a busy counter",
    "Must be entitled to work in New Zealand",
  ],
};
const CHECKLIST = [
  { id: "q1", text: "Barista experience" },
  { id: "q2", text: "Weekend 6am availability" },
  { id: "q3", text: "Handling a rush" },
  { id: "q4", text: "Physical requirements (20kg crates)" },
  { id: "q5", text: "Start date" },
];

const KEYWORD =
  /\b(kids?|children|pregnan\w*|family|married|husband|wife|partner|boyfriend|girlfriend|church|relig\w*|pray|old|age|born|from|accent|english|ethnic\w*|race|disab\w*|health|injur\w*|acc|benefit|vote|gay|straight)\b/i;
const NAIVE_SYSTEM =
  "Decide whether this job interview utterance is an unlawful question under New Zealand law. Fill in every field of the JSON.";

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const label = arg("label") ?? "";
const only = arg("only") as Variant | undefined;
const variants: Variant[] = only ? [only] : ["keyword", "naive", "full"];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fromResult = (r: CheckResult): Outcome =>
  r.verdict === "error"
    ? { verdict: `error:${r.reason}` }
    : { verdict: r.verdict, ground: r.ground, ms: r.ms };

async function run(v: Variant, c: Case): Promise<Outcome> {
  if (v === "keyword") return { verdict: KEYWORD.test(c.u) ? "flag" : "ok" };
  if (v === "naive") {
    const input = { utterance: c.u, role: { title: "", requirements: [] }, checklist: [] };
    return fromResult(await check(input, { system: NAIVE_SYSTEM, user: c.u }));
  }
  return fromResult(await check({ utterance: c.u, previous: c.prev ?? "", role: ROLE, checklist: CHECKLIST }));
}

const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const shouldCatch = (c: Case) => !c.expect.includes("ok");
const rows: string[] = [];

async function main() {
for (const v of variants) {
  const failures: string[] = [];
  const times: number[] = [];
  let passed = 0, caught = 0, falseAlarms = 0, rightGround = 0, groundChecked = 0;
  const nCatch = cases.filter(shouldCatch).length;
  const nOk = cases.length - nCatch;

  for (const c of cases) {
    const o = await run(v, c);
    if (o.ms != null) times.push(o.ms);
    const isNotOk = o.verdict === "flag" || o.verdict === "caution";
    if (shouldCatch(c) && isNotOk) caught++;
    if (!shouldCatch(c) && isNotOk) falseAlarms++;

    let pass = c.expect.includes(o.verdict);
    if (pass && isNotOk && c.grounds && v !== "keyword") {
      groundChecked++;
      if (c.grounds.includes(o.ground ?? "")) rightGround++;
      else pass = false;
    }
    if (pass) passed++;
    else failures.push(`  ${c.id}  "${c.u}"  expected ${c.expect.join("/")}${c.grounds ? ` (${c.grounds.join("/")})` : ""}  got ${o.verdict}${o.ground ? ` (${o.ground})` : ""}`);
    await sleep(300);
  }

  const med = median(times);
  const pct = (n: number, d: number) => `${n}/${d}`;
  console.log(`\n== ${v}${label ? `  [${label}]` : ""} ==`);
  console.log(`pass rate:     ${pct(passed, cases.length)}`);
  console.log(`caught:        ${pct(caught, nCatch)}`);
  console.log(`false alarms:  ${pct(falseAlarms, nOk)}`);
  console.log(`right ground:  ${v === "keyword" ? "n/a" : pct(rightGround, groundChecked)}`);
  console.log(`median ms:     ${Number.isNaN(med) ? "n/a" : Math.round(med)}`);
  if (failures.length) console.log(`failures:\n${failures.join("\n")}`);

  rows.push(
    `| ${new Date().toISOString().slice(0, 16).replace("T", " ")} | ${label} | ${v} | ${pct(passed, cases.length)} | ${pct(caught, nCatch)} | ${pct(falseAlarms, nOk)} | ${v === "keyword" ? "n/a" : pct(rightGround, groundChecked)} | ${Number.isNaN(med) ? "n/a" : Math.round(med)} |`,
  );
}

const out = join(__dirname, "results.md");
if (!existsSync(out)) {
  writeFileSync(
    out,
    "# Eval results\n\n| time | label | variant | pass | caught | false alarms | right ground | median ms |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n",
  );
}
appendFileSync(out, rows.join("\n") + "\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
