#!/usr/bin/env node
/**
 * Replace hardcoded light-theme hex Tailwind classes with semantic tokens
 * so dark mode stays readable. Run from repo root: node scripts/fix-theme-tokens.mjs
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(process.cwd(), "apps/web/src");

const SKIP_FILES = new Set([
  "TopBar.tsx",
  "AppLayout.tsx",
  "NavRail.tsx",
]);

/** @type {Array<[RegExp, string]>} */
const REPLACEMENTS = [
  [/text-\[#0F172A\]/g, "text-foreground"],
  [/text-\[#334155\]/g, "text-muted-foreground"],
  [/text-\[#475569\]/g, "text-muted-foreground"],
  [/text-\[#64748B\]/g, "text-muted-foreground"],
  [/border-\[#E2E8F0\]/g, "border-border"],
  [/border-\[#D6E0EA\]/g, "border-border"],
  [/border-\[#CBD5E1\]/g, "border-input"],
  [/bg-\[#F8FAFC\]/g, "bg-muted/30"],
  [/bg-\[#F1F5F9\]/g, "bg-muted/40"],
  [/hover:text-\[#B45309\]/g, "hover:text-primary"],
  [/text-\[#B45309\]/g, "text-primary"],
  [/focus:border-\[#E87722\]/g, "focus:border-primary"],
  [/focus:ring-\[#E87722\]\/25/g, "focus:ring-ring/40"],
  [/focus:ring-\[#E87722\]/g, "focus:ring-ring"],
  [/ring-\[#E87722\]/g, "ring-ring"],
  [/bg-\[#E87722\]/g, "bg-primary"],
  [/hover:bg-\[#D46B1B\]/g, "hover:bg-primary/90"],
  [/text-\[#9A3412\]/g, "text-primary"],
  [/text-\[#92400E\]/g, "text-amber-800 dark:text-amber-200"],
  [/text-\[#166534\]/g, "text-green-700 dark:text-green-400"],
  [/text-\[#9D174D\]/g, "text-rose-700 dark:text-rose-300"],
  [/text-\[#9F1239\]/g, "text-rose-700 dark:text-rose-300"],
  [/border-\[#FCD34D\]/g, "border-amber-400/50"],
  [/border-\[#FDBA74\]/g, "border-orange-300/50"],
  [/border-\[#FDE68A\]/g, "border-amber-300/50"],
  [/border-\[#BBF7D0\]/g, "border-emerald-400/40"],
  [/border-\[#FBCFE8\]/g, "border-pink-300/50"],
  [/bg-\[#FFF1E6\]/g, "bg-primary/15"],
  [/bg-\[#FFF7ED\]/g, "bg-primary/10"],
  [/bg-\[#FFFBEB\]/g, "bg-amber-500/10"],
  [/bg-\[#F0FDF4\]/g, "bg-emerald-500/10"],
  [/bg-\[#FFF1F2\]/g, "bg-rose-500/10"],
  [/bg-\[#FDF2F8\]/g, "bg-pink-500/10"],
  [/hover:bg-\[#FFF1E6\]/g, "hover:bg-primary/15"],
  [/hover:bg-\[#FFFBEB\]/g, "hover:bg-amber-500/15"],
  [/hover:bg-\[#F0FDF4\]/g, "hover:bg-emerald-500/15"],
  [/hover:bg-\[#FDF2F8\]/g, "hover:bg-pink-500/15"],
  [/hover:bg-\[#FFF7ED\]/g, "hover:bg-primary/10"],
  [/text-\[#B91C1C\]/g, "text-destructive"],
];

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, name.name);
    if (name.isDirectory()) walk(p, out);
    else if (name.isFile() && (p.endsWith(".tsx") || p.endsWith(".ts"))) out.push(p);
  }
  return out;
}

let filesChanged = 0;
for (const file of walk(ROOT)) {
  const base = path.basename(file);
  if (SKIP_FILES.has(base)) continue;

  let text = fs.readFileSync(file, "utf8");
  const original = text;

  for (const [re, rep] of REPLACEMENTS) {
    text = text.replace(re, rep);
  }

  // Whole-token bg-white -> bg-card (not bg-white/10 etc.)
  text = text.replace(new RegExp(String.raw`\bbg-white\b(?!/)`, "g"), "bg-card");

  if (text !== original) {
    fs.writeFileSync(file, text);
    filesChanged += 1;
    console.log(file.replace(process.cwd() + "/", ""));
  }
}

console.log(`Done. Updated ${filesChanged} files.`);
