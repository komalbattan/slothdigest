import { readFile, writeFile } from "node:fs/promises";

const b = JSON.parse(await readFile("../brief.json", "utf8"));
const esc = (s: string) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const items = b.priorities
  .map(
    (t: any) =>
      "<li><b>" + esc(t.text) + "</b>" +
      (t.deadline ? " <span>by " + esc(t.deadline) + "</span>" : "") +
      " <small>" + esc(t.source) + "</small></li>"
  )
  .join("");

const sums = b.sources
  .map((s: any) => "<li><b>" + esc(s.file) + "</b>: " + esc(s.summary) + "</li>")
  .join("");

const html =
  "<!doctype html><meta charset=utf-8>" +
  "<meta name=viewport content='width=device-width,initial-scale=1'>" +
  "<title>SlothDigest</title>" +
  "<style>body{font-family:system-ui,sans-serif;max-width:640px;margin:2rem auto;padding:0 1rem;line-height:1.5}li{margin:.5rem 0}span{color:#b45309}small{color:#666}.stat{margin-top:2rem;color:#555}</style>" +
  "<h1>Morning brief - " + b.date + "</h1>" +
  "<h2>Top 3 priorities</h2><ol>" + items + "</ol>" +
  "<h2>Summaries</h2><ul>" + sums + "</ul>" +
  "<p class=stat>" + b.stats.files + " files, " + b.stats.characters +
  " characters, " + b.stats.seconds + " seconds, model " + esc(b.model) + "</p>";

await writeFile("../brief.html", html);
console.log("Wrote ../brief.html");