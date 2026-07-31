import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { POSTS_DIR, pickTemplate, tomorrowIso } from "./lib.mjs";
import { fetchSchedule, fixtureSchedule } from "./fetch-schedule.mjs";
import { renderPost } from "./render.mjs";
import { buildCaption } from "./caption.mjs";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const date = opt("date") ?? tomorrowIso();
const useFixture = flag("fixture");

console.log(`Rendering schedule post for ${date}${useFixture ? " (fixture data)" : ""}`);

const classes = useFixture ? await fixtureSchedule() : await fetchSchedule(date);

if (classes.length === 0) {
  console.log("No classes scheduled — nothing to post. Exiting cleanly.");
  process.exit(0);
}
console.log(`${classes.length} classes:`);
for (const c of classes) console.log(`  ${c.startTime} ${c.classType} — ${c.teacher}`);

const templateFile = opt("template") ?? (await pickTemplate(date));
console.log(`Template: ${templateFile}`);

await mkdir(POSTS_DIR, { recursive: true });
const outFile = path.join(POSTS_DIR, `${date}.png`);
await renderPost({ date, classes, templateFile, outFile });
console.log(`Image: ${outFile}`);

const caption = buildCaption({ date, classes });
await writeFile(path.join(POSTS_DIR, `${date}.txt`), caption);
console.log(`Caption:\n${caption}`);
