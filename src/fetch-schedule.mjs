import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";
import { POSTS_DIR, ROOT, chromePath } from "./lib.mjs";

// The Mindbody widget embedded on the studio site is just an iframe pointing at
// this standalone schedule page — load it directly and parse its rendered text.
const WIDGET_ID = process.env.MINDBODY_WIDGET_ID || "a2567440024";
const WIDGET_URL = `https://go.mindbodyonline.com/book/widgets/schedules/view/${WIDGET_ID}/schedule`;

const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7,
  august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9,
  oct: 10, nov: 11, dec: 12,
};
const MONTH_RE = new RegExp(`\\b(${Object.keys(MONTHS).join("|")})\\.?\\s+(\\d{1,2})\\b`, "i");
const TIME_RE = /^(\d{1,2}):(\d{2})\s*(am|pm)/i;
const SKIP_RE = /^(book|reserve|waitlist|sign\s?up|sold out|full|free|cancel|\$|\d+\s*(min|minutes)$|filter|today|powered by|mindbody)/i;

/**
 * @param {string} dateIso the date to keep classes for (YYYY-MM-DD)
 * @returns {Promise<Array<{startTime,classType,teacher}>>}
 */
export async function fetchSchedule(dateIso) {
  const browser = await chromium.launch({
    executablePath: chromePath(),
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 3000 },
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    });
    await page.goto(WIDGET_URL, { waitUntil: "domcontentloaded", timeout: 45000 });

    // Wait for the day view to paint (either class times or the empty-day notice).
    await page
      .waitForFunction(
        () => /\d{1,2}:\d{2}\s*(am|pm)|no available classes/i.test(document.body.innerText),
        { timeout: 60000 },
      )
      .catch(() => {});
    await page.waitForTimeout(2000);

    // The widget shows ONE day at a time, defaulting to today. Click the
    // day-strip tab for the target date (tomorrow is always within the strip).
    const targetDay = Number(dateIso.split("-")[2]);
    const clicked = await page.evaluate((day) => {
      const els = Array.from(document.querySelectorAll('button, a, [role="tab"], [role="button"], div, span'));
      // Prefer an explicit "Go to <date>" link if the current day is empty.
      const goTo = els.find((e) => {
        const t = e.textContent.replace(/\s+/g, " ").trim();
        return /^go to /i.test(t) && new RegExp(`\\b${day}\\b`).test(t) && t.length < 40;
      });
      if (goTo) {
        (goTo.closest("button, a") ?? goTo).click();
        return "go-to-link";
      }
      // Otherwise the day tab: compact element like "Fri 31" / "31".
      const tab = els.find((e) => {
        const t = e.textContent.replace(/\s+/g, " ").trim();
        const m = t.match(/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun|Today)?\s*(\d{1,2})$/i);
        return m && Number(m[1]) === day;
      });
      if (tab) {
        (tab.closest('button, a, [role="tab"]') ?? tab).click();
        return "day-tab";
      }
      return false;
    }, targetDay);
    console.log(`Day navigation: ${clicked || "no clickable day element found"}`);

    // Wait for the target day's content to render.
    await page
      .waitForFunction(
        () => /\d{1,2}:\d{2}\s*(am|pm)/i.test(document.body.innerText),
        { timeout: 30000 },
      )
      .catch(() => {});
    await page.waitForTimeout(3000);

    const text = await page.evaluate(() => document.body.innerText);
    const { classes, datesSeen, total } = parseScheduleText(text, dateIso);

    if (classes.length === 0) {
      const dbgDir = path.join(POSTS_DIR, "tmp");
      await mkdir(dbgDir, { recursive: true });
      const dbg = path.join(dbgDir, "widget-debug.html");
      await writeFile(dbg, `<!-- ${WIDGET_URL}; sessions parsed: ${total}; dates seen: ${datesSeen.join(", ") || "none"} -->\n<pre>\n${text}\n</pre>`);
      throw new Error(
        total > 0
          ? `Parsed ${total} sessions from the widget but none dated ${dateIso} (dates seen: ${datesSeen.join(", ")}). Widget text saved to ${path.relative(ROOT, dbg)}.`
          : `Could not parse any classes from ${WIDGET_URL}. Widget text saved to ${path.relative(ROOT, dbg)} — adjust the parser in src/fetch-schedule.mjs.`,
      );
    }
    return classes;
  } finally {
    await browser.close();
  }
}

/**
 * Parse the widget's rendered text. Structure: day headers containing a month
 * name + day number, followed by session blocks of [time range, class name,
 * teacher]. Exposed for testing.
 */
export function parseScheduleText(text, dateIso) {
  const [, tm, td] = dateIso.split("-").map(Number);
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

  const all = [];
  const datesSeen = [];
  let onTargetDate = false;
  let sawAnyDate = false;
  let totalSessions = 0;
  let cur = null;

  const push = () => {
    if (cur && cur.classType) all.push(cur);
    cur = null;
  };

  for (const line of lines) {
    const dm = line.match(MONTH_RE);
    if (dm && !TIME_RE.test(line)) {
      push();
      sawAnyDate = true;
      const label = `${dm[1]} ${dm[2]}`;
      if (!datesSeen.includes(label)) datesSeen.push(label);
      onTargetDate = MONTHS[dm[1].toLowerCase().replace(".", "")] === tm && Number(dm[2]) === td;
      continue;
    }

    const t = line.match(TIME_RE);
    if (t) {
      push();
      totalSessions++;
      // If the widget has no date headers at all, accept every session.
      if (onTargetDate || !sawAnyDate) {
        let h = Number(t[1]) % 12;
        if (/pm/i.test(t[3])) h += 12;
        cur = { startTime: `${String(h).padStart(2, "0")}:${t[2]}`, matchesDate: onTargetDate || !sawAnyDate };
      }
      continue;
    }

    if (!cur || SKIP_RE.test(line)) continue;
    if (!cur.classType) {
      cur.classType = line;
    } else if (!cur.teacher && /^[a-z .'-]+$/i.test(line) && line.length < 40) {
      cur.teacher = line.replace(/^with\s+/i, "");
      push();
    }
  }
  push();

  const seen = new Set();
  const classes = all
    .map(({ startTime, classType, teacher }) => ({ startTime, classType, teacher: teacher ?? "" }))
    .filter((c) => {
      const k = `${c.startTime}|${c.classType}|${c.teacher}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => a.startTime.localeCompare(b.startTime));

  return { classes, datesSeen, total: totalSessions };
}

/** Load the checked-in fixture instead of the live widget. */
export async function fixtureSchedule() {
  const raw = await readFile(path.join(ROOT, "fixtures", "schedule-sample.json"), "utf8");
  return JSON.parse(raw).classes;
}
