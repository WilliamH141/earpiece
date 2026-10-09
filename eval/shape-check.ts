import { validate } from "../lib/schema";

const cases: [string, string][] = [
  ["not json", "not json"],
  ["empty string", ""],
  ["bad verdict", JSON.stringify({ verdict: "maybe" })],
  [
    "flag with made-up source",
    JSON.stringify({
      is_interviewer_question: true,
      ground: "family_status",
      why: "Asks about children.",
      verdict: "flag",
      rephrase: "Can you work weekend shifts?",
      source_id: "made_up",
      checklist_hits: [],
    }),
  ],
];

let bad = 0;
for (const [name, raw] of cases) {
  const out = validate(raw, ["q1"]);
  if (out !== null) bad++;
  console.log(`${out === null ? "ok  " : "FAIL"}  ${name.padEnd(26)} -> ${out === null ? "null (UI shows \"Couldn't check that one\")" : JSON.stringify(out)}`);
}
process.exit(bad ? 1 : 0);
