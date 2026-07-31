import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";
import {
  ASSETS_DIR,
  POSTS_DIR,
  TEMPLATES_DIR,
  chromePath,
  countWord,
  dateLabels,
  formatTime,
  splitClassType,
} from "./lib.mjs";

const ROW_RE = /<!--ROW-->([\s\S]*?)<!--\/ROW-->/;

function fillTokens(text, tokens) {
  return text.replace(/\{\{(\w+)\}\}/g, (match, key) =>
    key in tokens ? tokens[key] : match,
  );
}

/**
 * Render one schedule post image.
 * @param {object} opts
 * @param {string} opts.date ISO date the post is about (tomorrow)
 * @param {Array} opts.classes [{startTime, classType, teacher}]
 * @param {string} opts.templateFile e.g. "template-c.html"
 * @param {string} opts.outFile absolute path for the PNG
 */
export async function renderPost({ date, classes, templateFile, outFile }) {
  const raw = await readFile(path.join(TEMPLATES_DIR, templateFile), "utf8");

  const rowMatch = raw.match(ROW_RE);
  if (!rowMatch) throw new Error(`${templateFile} has no <!--ROW-->...<!--/ROW--> block`);
  const rowTemplate = rowMatch[1];

  const rowsHtml = classes
    .map((c) => {
      const { time, ampm } = formatTime(c.startTime);
      const { name, duration } = splitClassType(c.classType);
      return fillTokens(rowTemplate, {
        TIME: time,
        AMPM: ampm,
        CLASS_NAME: name,
        DURATION: duration,
        TEACHER: c.teacher,
      });
    })
    .join("\n");

  const { dayName, monthDay } = dateLabels(date);
  const html = fillTokens(raw.replace(ROW_RE, rowsHtml), {
    DAY_NAME: dayName,
    MONTH_DAY: monthDay,
    CLASS_COUNT_WORD: countWord(classes.length),
    ASSETS: `file://${ASSETS_DIR}`,
  });

  const tmpDir = path.join(POSTS_DIR, "tmp");
  await mkdir(tmpDir, { recursive: true });
  const tmpHtml = path.join(tmpDir, `${path.basename(outFile, ".jpg")}.html`);
  await writeFile(tmpHtml, html);

  const browser = await chromium.launch({
    executablePath: chromePath(),
    args: ["--no-sandbox", "--allow-file-access-from-files"],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
    await page.goto(`file://${tmpHtml}`);
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: outFile, type: "jpeg", quality: 92 });
  } finally {
    await browser.close();
    await rm(tmpHtml, { force: true });
  }
  return outFile;
}
