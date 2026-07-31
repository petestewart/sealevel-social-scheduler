import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";
import { POSTS_DIR, ROOT, chromePath } from "./lib.mjs";

// Same Mindbody "Branded web tools" Schedules widget the website embeds.
const WIDGET_ID = "a2567440024";

const EMBED_HTML = `<!DOCTYPE html><html><body>
<div class="mindbody-widget" data-widget-type="Schedules" data-widget-id="${WIDGET_ID}"></div>
<script src="https://brandedweb.mindbodyonline.com/embed/widget.js" async></script>
</body></html>`;

/**
 * Scrape the rendered widget DOM. Mindbody branded widgets use bw-* class names;
 * we try those first and fall back to generic text parsing. If nothing parses,
 * the raw widget HTML is dumped to posts/tmp/widget-debug.html so the selectors
 * can be fixed without re-running blind.
 *
 * @param {string} dateIso the date to keep classes for (YYYY-MM-DD)
 * @returns {Promise<Array<{startTime,classType,teacher}>>}
 */
export async function fetchSchedule(dateIso) {
  const browser = await chromium.launch({
    executablePath: chromePath(),
    args: ["--no-sandbox"],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 2000 } });
    await page.setContent(EMBED_HTML, { waitUntil: "domcontentloaded" });

    // The widget script injects its content asynchronously; poll for real content.
    await page
      .waitForFunction(
        () => {
          const w = document.querySelector(".mindbody-widget");
          return w && (w.childElementCount > 0 || w.textContent.trim().length > 50);
        },
        { timeout: 45000 },
      )
      .catch(() => {});
    // Give it a moment to finish painting sessions after first paint.
    await page.waitForTimeout(4000);

    const scraped = await page.evaluate(() => {
      const sessions = [];
      const sessionEls = document.querySelectorAll(
        '.bw-session, [class*="bw-session "], [class*="session-item"], [class*="ClassTime"]',
      );
      for (const el of sessionEls) {
        const q = (sel) => el.querySelector(sel)?.textContent?.trim() ?? "";
        sessions.push({
          time:
            q('[class*="time"]') ||
            (el.textContent.match(/\b\d{1,2}:\d{2}\s*(?:am|pm|AM|PM)\b/) || [""])[0],
          name: q('[class*="name"], [class*="title"], h3, h4'),
          staff: q('[class*="staff"], [class*="teacher"], [class*="instructor"]'),
          // Nearest preceding day header, if the widget groups by day.
          day: (() => {
            let n = el;
            while (n) {
              const header = n.previousElementSibling
                ? null
                : n.parentElement?.querySelector('[class*="day"], [class*="date"], h2');
              if (header) return header.textContent.trim();
              n = n.parentElement;
              if (n && /widget/.test(n.className)) break;
            }
            const container = el.closest('[class*="day"], [data-date]');
            return (
              container?.getAttribute?.("data-date") ||
              container?.querySelector('[class*="header"], h2, h3')?.textContent?.trim() ||
              ""
            );
          })(),
        });
      }
      return {
        sessions,
        html: document.querySelector(".mindbody-widget")?.outerHTML ?? document.body.innerHTML,
      };
    });

    const classes = normalize(scraped.sessions, dateIso);
    if (classes.length === 0) {
      const dbgDir = path.join(POSTS_DIR, "tmp");
      await mkdir(dbgDir, { recursive: true });
      const dbg = path.join(dbgDir, "widget-debug.html");
      await writeFile(dbg, scraped.html);
      throw new Error(
        `Could not parse any classes for ${dateIso} from the Mindbody widget. ` +
          `Raw widget HTML saved to ${path.relative(ROOT, dbg)} — inspect it and adjust the selectors in src/fetch-schedule.mjs.`,
      );
    }
    return classes;
  } finally {
    await browser.close();
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
    // Keep sessions whose day header mentions the target day-of-month (or has no day info,
    // which happens when the widget is set to single-day view).
    if (s.day && !new RegExp(`\\b${targetDay}\\b`).test(s.day)) continue;
    let h = Number(t[0]) % 12;
    if (/pm/i.test(t[2])) h += 12;
    out.push({
      startTime: `${String(h).padStart(2, "0")}:${t[1]}`,
      classType: s.name || "Hot Yoga",
      teacher: (s.staff || "").replace(/^with\s+/i, ""),
    });
  }
  // De-dupe (widgets sometimes render sessions twice for responsive layouts).
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
