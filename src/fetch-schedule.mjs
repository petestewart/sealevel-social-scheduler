import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";
import { POSTS_DIR, ROOT, chromePath } from "./lib.mjs";

// Where the Mindbody "Branded web tools" Schedules widget is embedded.
// Strategy 1 loads the studio's real schedule page (the widget refuses to
// initialize on pages without a proper http(s) origin, so a synthetic
// about:blank page does NOT work). Strategy 2 serves a minimal embed page
// on a faked origin via request interception, in case the site is down.
const SCHEDULE_PAGE_URL =
  process.env.SCHEDULE_PAGE_URL || "https://www.sealevelhotyoga.com/schedule";
const WIDGET_ID = process.env.MINDBODY_WIDGET_ID || "a2567440024";

const FAKE_EMBED_URL = new URL("/__schedule-embed", SCHEDULE_PAGE_URL).href;
const EMBED_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>
<div class="mindbody-widget" data-widget-type="Schedules" data-widget-id="${WIDGET_ID}"></div>
<script src="https://brandedweb.mindbodyonline.com/embed/widget.js" async></script>
</body></html>`;

const SESSION_SELECTOR =
  '.bw-session, [class*="bw-session"], [class*="session-item"], [class*="ClassTime"], [class*="hc_class"]';

/**
 * @param {string} dateIso the date to keep classes for (YYYY-MM-DD)
 * @returns {Promise<Array<{startTime,classType,teacher}>>}
 */
export async function fetchSchedule(dateIso) {
  const browser = await chromium.launch({
    executablePath: chromePath(),
    // Mindbody's CDN applies bot checks; look like a regular desktop Chrome.
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
  });
  try {
    const attempts = [];

    // Strategy 1: the studio's real schedule page.
    let result = await scrapePage(browser, dateIso, async (page) => {
      await page.goto(SCHEDULE_PAGE_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
    });
    attempts.push({ strategy: `real page ${SCHEDULE_PAGE_URL}`, ...result });

    // Strategy 2: minimal embed served on a faked same-site origin.
    if (result.classes.length === 0) {
      result = await scrapePage(browser, dateIso, async (page) => {
        await page.route(FAKE_EMBED_URL, (route) =>
          route.fulfill({ contentType: "text/html", body: EMBED_HTML }),
        );
        await page.goto(FAKE_EMBED_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
      });
      attempts.push({ strategy: "faked-origin embed", ...result });
    }

    if (result.classes.length === 0) {
      const dbgDir = path.join(POSTS_DIR, "tmp");
      await mkdir(dbgDir, { recursive: true });
      const dbg = path.join(dbgDir, "widget-debug.html");
      await writeFile(
        dbg,
        attempts
          .map((a) => `<!-- strategy: ${a.strategy}; sessions matched: ${a.rawCount} -->\n${a.html}`)
          .join("\n\n<!-- ================= -->\n\n"),
      );
      throw new Error(
        `Could not parse any classes for ${dateIso} from the Mindbody widget ` +
          `(tried: ${attempts.map((a) => a.strategy).join("; ")}). ` +
          `Raw HTML saved to ${path.relative(ROOT, dbg)} — inspect it and adjust src/fetch-schedule.mjs.`,
      );
    }
    return result.classes;
  } finally {
    await browser.close();
  }
}

async function scrapePage(browser, dateIso, navigate) {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 2400 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  });
  // Surface what the widget's network calls are doing — visible in CI logs.
  page.on("response", (res) => {
    const u = res.url();
    if (/mindbody|brandedweb|healcode/i.test(u)) {
      console.log(`  [net] ${res.status()} ${u.slice(0, 140)}`);
    }
  });
  page.on("pageerror", (err) => console.log(`  [pageerror] ${String(err).slice(0, 200)}`));
  try {
    await navigate(page);

    // The widget injects content asynchronously — wait for real session elements.
    await page.waitForSelector(SESSION_SELECTOR, { timeout: 60000 }).catch(() => {});
    // Let it finish painting the rest of the sessions.
    await page.waitForTimeout(5000);

    const scraped = await page.evaluate((sel) => {
      const sessions = [];
      for (const el of document.querySelectorAll(sel)) {
        // Skip container elements that themselves contain matched sessions.
        if (el.querySelector(sel)) continue;
        const q = (s) => el.querySelector(s)?.textContent?.trim() ?? "";
        const dayContainer = el.closest('[class*="day"], [data-date], [class*="Day"]');
        sessions.push({
          time:
            q('[class*="time"], [class*="Time"]') ||
            (el.textContent.match(/\b\d{1,2}:\d{2}\s*(?:am|pm)\b/i) || [""])[0],
          name: q('[class*="name"], [class*="title"], [class*="Name"], h3, h4'),
          staff: q('[class*="staff"], [class*="teacher"], [class*="instructor"], [class*="Staff"]'),
          day:
            dayContainer?.getAttribute?.("data-date") ||
            dayContainer?.querySelector('[class*="header"], [class*="date"], h2, h3')?.textContent?.trim() ||
            "",
        });
      }
      const widget =
        document.querySelector(".mindbody-widget") ||
        document.querySelector('[class*="bw-widget"]');
      return { sessions, html: widget?.outerHTML ?? document.body.innerHTML };
    }, SESSION_SELECTOR);

    return {
      classes: normalize(scraped.sessions, dateIso),
      rawCount: scraped.sessions.length,
      html: scraped.html,
    };
  } finally {
    await page.close();
  }
}

/** Map scraped rows to {startTime, classType, teacher}, filtered to dateIso. */
function normalize(sessions, dateIso) {
  const target = new Date(`${dateIso}T12:00:00Z`);
  const targetDay = target.getUTCDate();
  const out = [];
  for (const s of sessions) {
    const t = (s.time.match(/(\d{1,2}):(\d{2})\s*(am|pm)/i) || []).slice(1);
    if (t.length === 0) continue;
    // Keep sessions whose day header mentions the target day-of-month (or that have
    // no day info, which happens when the widget is set to single-day view).
    if (s.day && !new RegExp(`\\b${targetDay}\\b`).test(s.day)) continue;
    let h = Number(t[0]) % 12;
    if (/pm/i.test(t[2])) h += 12;
    out.push({
      startTime: `${String(h).padStart(2, "0")}:${t[1]}`,
      classType: s.name || "Hot Yoga",
      teacher: (s.staff || "").replace(/^with\s+/i, ""),
    });
  }
  // De-dupe (widgets often render duplicate session nodes for responsive layouts).
  const seen = new Set();
  return out
    .filter((c) => {
      const k = `${c.startTime}|${c.classType}|${c.teacher}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
}

/** Load the checked-in fixture instead of the live widget. */
export async function fixtureSchedule() {
  const raw = await readFile(path.join(ROOT, "fixtures", "schedule-sample.json"), "utf8");
  return JSON.parse(raw).classes;
}
