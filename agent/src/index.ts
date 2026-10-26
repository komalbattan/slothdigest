import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

const MODEL = process.env.MODEL ?? "gemma3:1b";
const OLLAMA = process.env.OLLAMA_URL ?? "http://localhost:11434";
const INBOX = process.argv[2] ?? "../inbox";

const Task = z.object({
  text: z.string(),
  deadline: z
    .union([z.string(), z.number()])
    .nullish()
    .transform((v) => (v == null ? null : String(v))),
});

const Result = z.object({
  summary: z.string(),
  tasks: z.preprocess(
    (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === "object") : v),
    z.array(Task)
  ),
});
type Parsed = {
  summary: string;
  tasks: { text: string; deadline: string | null }[];
};

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const WORDS = ["today", "tomorrow", ...DAYS];

const SYSTEM = [
  "You read messy notes, chats and emails.",
  "Reply with ONLY a JSON object in this exact shape:",
  '{"summary": "one plain sentence saying what this text is about", "tasks": [{"text": "what to do", "deadline": "day or date, or null"}]}',
  "The summary must be a sentence, not a title.",
  "Every task must be an object with a text key and a deadline key. Never use a plain string as a task.",
  "Use null for deadline when there is none. Never invent a deadline.",
  "If one sentence asks for two different things, list them as two separate tasks, each with its own deadline.",
  "Only list real action items someone must do. Skip chatter, jokes and invitations.",
  "Never add extra text outside the JSON.",
].join("\n");

function fallback(text: string): Parsed {
  return { summary: text.split("\n")[0].slice(0, 100), tasks: [] };
}

function dayIn(s: string): string | null {
  const l = s.toLowerCase();
  return WORDS.find((w) => l.includes(w)) ?? null;
}

function ground(r: Parsed, text: string): Parsed {
  const lines = text.toLowerCase().split("\n");
  const sig = (s: string) =>
    s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3);
  const nearLine = (task: string) => {
    const tw = sig(task);
    let best = "";
    let bestScore = 0;
    for (const line of lines) {
      const lw = sig(line);
      const score = tw.filter((w) => lw.includes(w)).length;
      if (score > bestScore) {
        bestScore = score;
        best = line;
      }
    }
    return best;
  };
  const tasks = r.tasks.map((t) => {
    const own = dayIn(t.text);
    if (own) return { text: t.text, deadline: own };
    if (!t.deadline) return { text: t.text, deadline: null };
    const d = t.deadline.toLowerCase();
    const named = WORDS.filter((w) => d.includes(w));
    if (named.length === 0) return { text: t.text, deadline: t.deadline };
    const near = nearLine(t.text);
    const ok = named.every((w) => near.includes(w));
    return { text: t.text, deadline: ok ? t.deadline : null };
  });
  return { summary: r.summary, tasks };
}

async function ask(text: string): Promise<Parsed> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(OLLAMA + "/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: MODEL,
          stream: false,
          format: "json",
          messages: [
            { role: "system", content: SYSTEM },
            { role: "user", content: text },
          ],
        }),
      });
      if (!res.ok) {
        throw new Error("Ollama error " + res.status + ": " + (await res.text()));
      }
      const data = await res.json();
      const parsed = Result.parse(JSON.parse(data.message.content)) as Parsed;
      return ground(parsed, text);
    } catch (err) {
      console.log("Attempt " + attempt + " failed: " + String(err).slice(0, 120));
    }
  }
  console.log("Using fallback for this file.");
  return fallback(text);
}

function daysUntil(deadline: string | null): number {
  if (!deadline) return 99;
  const d = deadline.toLowerCase();
  if (d.includes("today")) return 0;
  if (d.includes("tomorrow")) return 1;
  const i = DAYS.findIndex((x) => d.includes(x));
  if (i === -1) return 50;
  return (i - new Date().getDay() + 7) % 7;
}

const started = Date.now();
const files = (await readdir(INBOX)).filter(
  (f) => f.endsWith(".txt") || f.endsWith(".md")
);

const sources: { file: string; chars: number; summary: string; tasks: Parsed["tasks"] }[] = [];
for (const f of files) {
  const text = await readFile(join(INBOX, f), "utf8");
  const r = await ask(text.slice(0, 6000));
  sources.push({ file: f, chars: text.length, ...r });
}

const seen = new Set<string>();
const tasks = sources
  .flatMap((s) => s.tasks.map((t) => ({ ...t, source: s.file })))
  .filter((t) => {
    const key = t.text.toLowerCase().trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  })
  .sort((a, b) => daysUntil(a.deadline) - daysUntil(b.deadline));

const top = tasks.slice(0, 3);
const seconds = Math.round((Date.now() - started) / 1000);
const totalChars = sources.reduce((n, s) => n + s.chars, 0);

const brief = {
  date: new Date().toISOString().slice(0, 10),
  model: MODEL,
  priorities: top,
  sources: sources.map((s) => ({ file: s.file, summary: s.summary })),
  stats: { files: files.length, characters: totalChars, seconds },
};
await writeFile("../brief.json", JSON.stringify(brief, null, 2));

console.log("\nMORNING BRIEF - " + brief.date);
console.log("\nTop priorities:");
top.forEach((t, i) =>
  console.log(
    (i + 1) + ". " + t.text + (t.deadline ? " (by " + t.deadline + ")" : "") + "  [" + t.source + "]"
  )
);
console.log("\nSummaries:");
sources.forEach((s) => console.log("- " + s.file + ": " + s.summary));
console.log(
  "\n" + files.length + " files, " + totalChars + " characters -> " + top.length + " priorities in " + seconds + "s"
);