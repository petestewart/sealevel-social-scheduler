// Content scheduler: runs hourly in CI and publishes whatever is due.
//
// Two sources of content, both plain files in the repo (a future UI just
// needs to write these files — the manifests ARE the API):
//
//   content/scheduled/*.json   One-off posts (feed or story) with a publish
//                              time: class announcements, teacher features,
//                              promos, trainings, retreats...
//   content/story-queue/queue.json
//                              An ordered queue of story images drained at a
//                              set of daily time slots.
//
// State lives in the same files: each item gains a `postedAt` (or a `missed`
// status) when handled, and CI commits the change. Runs are idempotent — an
// item with `postedAt` is never posted again — so overlapping or delayed
// cron fires are safe.
//
// Usage: node src/scheduler.mjs [--dry-run]
//   --dry-run  report what would be posted, publish nothing, write nothing

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ROOT, nowInStudioTz } from "./lib.mjs";
import { publishImage, rawImageUrl, waitForUrl } from "./publish.mjs";

const SCHEDULED_DIR = path.join(ROOT, "content", "scheduled");
const QUEUE_DIR = path.join(ROOT, "content", "story-queue");
const QUEUE_FILE = path.join(QUEUE_DIR, "queue.json");

// A one-off whose slot was missed by more than this (workflow outage, repo
// disabled...) is marked "missed" instead of posted stale — announcing a
// "starts tomorrow" promo two days late is worse than not posting it.
const DEFAULT_GRACE_HOURS = 6;

const dryRun = process.argv.includes("--dry-run");
const now = nowInStudioTz();
const nowStamp = `${now.iso}T${now.hhmm}`; // studio-local "YYYY-MM-DDTHH:MM"

console.log(`Content scheduler @ ${nowStamp} (studio time)${dryRun ? " [dry run]" : ""}`);

/** Normalize "2026-09-01 09:00" / "2026-09-01T09:00" -> "2026-09-01T09:00". */
function normalizeStamp(s) {
  const m = String(s).trim().replace(" ", "T").match(/^(\d{4}-\d{2}-\d{2})T(\d{1,2}):(\d{2})/);
  if (!m) throw new Error(`Bad timestamp "${s}" — expected "YYYY-MM-DD HH:MM" (studio time)`);
  return `${m[1]}T${m[2].padStart(2, "0")}:${m[3]}`;
}

/** Hours between two studio-local stamps (b - a). Both are the same tz, so plain math works. */
function hoursBetween(a, b) {
  return (Date.parse(`${b}:00Z`) - Date.parse(`${a}:00Z`)) / 3600000;
}

async function publishRepoImage({ relPath, caption, mediaType, label }) {
  const imageUrl = rawImageUrl(relPath.split(path.sep).join("/"));
  console.log(`Publishing ${mediaType} "${label}": ${imageUrl}`);
  if (dryRun) return;
  await waitForUrl(imageUrl, 5, 5000); // already committed, so this should be instant
  await publishImage({ imageUrl, caption, mediaType, date: now.iso });
}

// ---------------------------------------------------------------- one-offs

async function runScheduled() {
  let files;
  try {
    files = (await readdir(SCHEDULED_DIR)).filter((f) => f.endsWith(".json")).sort();
  } catch {
    return; // no content/scheduled dir yet
  }

  for (const file of files) {
    const filePath = path.join(SCHEDULED_DIR, file);
    const item = JSON.parse(await readFile(filePath, "utf8"));
    if (item.postedAt || item.missed) continue;

    const due = normalizeStamp(item.publishAt);
    if (due > nowStamp) continue;

    const late = hoursBetween(due, nowStamp);
    const grace = item.graceHours ?? DEFAULT_GRACE_HOURS;
    if (late > grace) {
      console.log(`SKIP ${file}: was due ${due}, ${late.toFixed(1)}h ago (> ${grace}h grace) — marking missed.`);
      if (!dryRun) {
        item.missed = nowStamp;
        await writeFile(filePath, JSON.stringify(item, null, 2) + "\n");
      }
      continue;
    }

    if (!item.image) throw new Error(`${file}: "image" is required`);
    await publishRepoImage({
      relPath: path.join("content", "scheduled", item.image),
      caption: item.caption ?? "",
      mediaType: (item.mediaType ?? "FEED").toUpperCase() === "STORY" ? "STORY" : "FEED",
      label: file,
    });
    if (!dryRun) {
      item.postedAt = nowStamp;
      await writeFile(filePath, JSON.stringify(item, null, 2) + "\n");
    }
  }
}

// ------------------------------------------------------------- story queue

async function runStoryQueue() {
  let queue;
  try {
    queue = JSON.parse(await readFile(QUEUE_FILE, "utf8"));
  } catch {
    return; // no queue configured
  }

  const slots = (queue.slots ?? []).map((s) => normalizeStamp(`${now.iso} ${s}`));
  const dueSlots = slots.filter((s) => s <= nowStamp).length;
  const postedToday = (queue.items ?? []).filter(
    (i) => i.postedAt && i.postedAt.startsWith(now.iso),
  ).length;
  const pending = (queue.items ?? []).filter((i) => !i.postedAt);
  const toPost = Math.min(Math.max(dueSlots - postedToday, 0), pending.length);

  console.log(
    `Story queue: ${dueSlots}/${slots.length} slots elapsed today, ${postedToday} posted, ` +
      `${pending.length} waiting → posting ${toPost}.`,
  );

  for (const item of pending.slice(0, toPost)) {
    await publishRepoImage({
      relPath: path.join("content", "story-queue", item.image),
      caption: item.caption ?? "",
      mediaType: "STORY",
      label: item.image,
    });
    if (!dryRun) item.postedAt = nowStamp;
  }

  if (!dryRun && toPost > 0) {
    await mkdir(QUEUE_DIR, { recursive: true });
    await writeFile(QUEUE_FILE, JSON.stringify(queue, null, 2) + "\n");
  }
}

await runScheduled();
await runStoryQueue();
console.log("Scheduler done.");
