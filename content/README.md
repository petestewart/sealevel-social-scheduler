# Scheduled content

Everything in here is plain files — these manifests are the "database", and a
future UI only needs to write these files (directly or via the GitHub API) to
schedule content. The hourly **Content scheduler** workflow publishes whatever
is due and commits the updated state back.

All times are **studio time** (America/Los_Angeles), format `YYYY-MM-DD HH:MM`
for timestamps and `HH:MM` for daily slots.

## One-off posts — `scheduled/`

One JSON file per post, with its image next to it. Announcements of new
classes, teacher features, promos, trainings, retreats, etc.

```jsonc
// scheduled/2026-09-01-september-classes.json
{
  "publishAt": "2026-09-01 09:00",       // studio time
  "mediaType": "FEED",                   // "FEED" (default) or "STORY"
  "image": "september-classes.jpg",      // file in this same directory
  "caption": "New classes for September! ...\n\n#sealevelhotyoga"
}
```

Commit the JSON **and** the image, push to `main`, and you're scheduled.
When it posts, the workflow adds a `"postedAt"` field (the file doubles as the
record of what went out). If a slot is missed by more than 6 hours (override
with `"graceHours"`) the item is marked `"missed"` instead of posting stale —
delete the `missed` field and bump `publishAt` to re-schedule.

Captions are ignored by Instagram on stories.

## Story queue — `story-queue/`

Drop images in the directory and list them in `queue.json`. Each day, one
queued story is posted at each time in `slots`, in queue order:

```jsonc
{
  "slots": ["09:30", "13:00", "17:30"],  // 3 stories per day, studio time
  "items": [
    { "image": "community-shot-1.jpg" },
    { "image": "teacher-quote-amy.jpg" }
  ]
}
```

Posted items gain a `"postedAt"` and stay in the list as history; append new
items at the end (or anywhere before the first unposted item to jump the
queue). When the queue runs dry, slots simply go unfilled until it's refilled.
