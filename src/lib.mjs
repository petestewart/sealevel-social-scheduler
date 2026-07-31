import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const TEMPLATES_DIR = path.join(ROOT, "templates");
export const ASSETS_DIR = path.join(ROOT, "assets");
export const POSTS_DIR = path.join(ROOT, "posts");

export const TIMEZONE = "America/Los_Angeles";

/** Today's date parts in the studio timezone. */
export function nowInStudioTz() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return { iso: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) };
}

/** ISO date string for tomorrow in the studio timezone. */
export function tomorrowIso() {
  const { iso } = nowInStudioTz();
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "2026-07-31" -> { dayName: "Friday", monthDay: "July 31" } */
export function dateLabels(iso) {
  const d = new Date(`${iso}T12:00:00Z`);
  return {
    dayName: DAY_NAMES[d.getUTCDay()],
    monthDay: `${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCDate()}`,
  };
}

export function dayOfYear(iso) {
  const d = new Date(`${iso}T12:00:00Z`);
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.floor((d.getTime() - start) / 86400000) + 1;
}

/** "17:00" -> { time: "5:00", ampm: "pm" } */
export function formatTime(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  const ampm = h >= 12 ? "pm" : "am";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return { time: `${hour12}:${String(m).padStart(2, "0")}`, ampm };
}

/** "Hot 26 & 2 (90 min)" -> { name: "Hot 26 & 2", duration: "90 min" } */
export function splitClassType(classType) {
  const m = classType.match(/^(.*?)\s*\((.+?)\)\s*$/);
  if (m) return { name: m[1].trim(), duration: m[2].trim() };
  return { name: classType.trim(), duration: "" };
}

const COUNT_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven"];
export function countWord(n) {
  return COUNT_WORDS[n] ?? String(n);
}

/** Sorted list of template files, e.g. ["template-a.html", ...] */
export async function listTemplates() {
  const files = await readdir(TEMPLATES_DIR);
  return files.filter((f) => f.endsWith(".html")).sort();
}

/** Deterministic round-robin: same date always picks the same template. */
export async function pickTemplate(iso) {
  const templates = await listTemplates();
  if (templates.length === 0) throw new Error("No templates found in templates/");
  return templates[dayOfYear(iso) % templates.length];
}

export function chromePath() {
  const p = process.env.CHROME_PATH;
  if (!p) {
    throw new Error(
      "CHROME_PATH is not set. Point it at a Chromium/Chrome binary (in CI, browser-actions/setup-chrome provides one).",
    );
  }
  return p;
}
