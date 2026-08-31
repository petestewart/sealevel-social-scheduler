// Fire the nightly Sealevel schedule post via GitHub repository_dispatch.
//
// Designed to run as a Railway cron service (no dependencies, Node 18+ only).
// Railway cron schedules are UTC, which would drift an hour at DST, so this
// runs hourly across the candidate window and only fires when it is actually
// FIRE_AT_HOUR (default 19:00) in America/Los_Angeles.
//
// Env:
//   GH_DISPATCH_TOKEN  required — fine-grained PAT, this repo, Contents: RW
//   FIRE_AT_HOUR       optional — local hour to fire, default 19
//   FIRE_TZ            optional — timezone, default America/Los_Angeles
//   FORCE              optional — "1" to skip the hour check (manual test)

const token = process.env.GH_DISPATCH_TOKEN;
if (!token) {
  console.error("ERROR: GH_DISPATCH_TOKEN is not set.");
  process.exit(1);
}

const repo = process.env.GH_REPO || "petestewart/sealevel-social-scheduler";
const tz = process.env.FIRE_TZ || "America/Los_Angeles";
const fireAtHour = Number(process.env.FIRE_AT_HOUR ?? 19);

const localHour = Number(
  new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: false })
    .format(new Date())
    .replace(/\D/g, "")
);

if (process.env.FORCE !== "1" && localHour !== fireAtHour) {
  console.log(`It is ${localHour}:xx in ${tz}, not ${fireAtHour}:xx. Nothing to do.`);
  process.exit(0);
}

const res = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
  method: "POST",
  headers: {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "content-type": "application/json",
  },
  body: JSON.stringify({ event_type: "nightly-post" }),
});

if (res.status === 204) {
  console.log(`${new Date().toISOString()} dispatched nightly-post OK`);
} else {
  console.error(`ERROR: GitHub returned HTTP ${res.status}`);
  console.error(await res.text());
  process.exit(1);
}
