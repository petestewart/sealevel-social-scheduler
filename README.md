# sealevel-social

Automated daily class-schedule posts for **Sealevel Hot Yoga** (Fremont, Seattle).

Every evening at **7:00pm Pacific**, a GitHub Action:

1. Pulls **tomorrow's classes** from the same Mindbody schedule widget the website embeds
2. Picks the next design in a **round-robin of templates** (`templates/`)
3. Renders a 1080×1350 Instagram-ready PNG with headless Chrome
4. Commits it to `posts/YYYY-MM-DD.jpg` (which makes it publicly reachable)
5. Sends the image URL + generated caption to a **Make.com webhook**, which posts to Instagram and Facebook (and optionally emails a copy)

No paid services: GitHub Actions and Make's free tier cover a daily post with lots of headroom.

## One-time setup

### 1. Make.com scenario

1. Create a free account at [make.com](https://make.com) and a new **Scenario**.
2. Add a **Webhooks → Custom webhook** trigger. Copy its URL.
3. Add an **Instagram for Business → Create a Photo Post** module: connect the studio's Instagram (OAuth with the Facebook login that admins the Page — no Meta developer account needed). Map `image_url` → Photo URL and `caption` → Caption.
4. Add a **Facebook Pages → Create a Post** (photo) module: connect the Sealevel Hot Yoga Page, map `image_url` and `caption`.
5. Optional: add an **Email** module first to send yourself a copy of each post as it goes out.
6. Turn the scenario **ON** (immediate scheduling).

### 2. GitHub secret

Repo → Settings → Secrets and variables → Actions → new secret:

- `MAKE_WEBHOOK_URL` — the webhook URL from step 1.2

### 3. Test it

Actions → **Daily schedule post** → Run workflow:

- with **dry_run** checked: renders and commits the image but doesn't post — check `posts/` and the run log for the caption.
- with **fixture** checked: uses `fixtures/schedule-sample.json` instead of the live widget (useful for template work).
- unchecked: does the real thing, posting to IG + FB.

The first live run exercises the Mindbody widget scraper. If it fails, the run
uploads `posts/tmp/widget-debug.html` as an artifact — the raw widget markup —
so the selectors in `src/fetch-schedule.mjs` can be adjusted to match.

## Templates

Each `templates/template-*.html` is a self-contained 1080×1350 page using tokens:

| Token | Example |
|---|---|
| `{{DAY_NAME}}` | Friday |
| `{{MONTH_DAY}}` | July 31 |
| `{{CLASS_COUNT_WORD}}` | three |
| `{{ASSETS}}` | file:// URL of the `assets/` dir |

The repeated class row sits between `<!--ROW-->` and `<!--/ROW-->` markers and may use
`{{TIME}}` (6:00), `{{AMPM}}` (am), `{{CLASS_NAME}}` (Hot 26 & 2), `{{DURATION}}` (90 min), `{{TEACHER}}`.

The template for a given day is `dayOfYear % templateCount` — deterministic, and adding a
new template automatically joins the rotation. Layouts must tolerate 1–4 rows.

Preview any template locally (needs Chrome/Chromium):

```bash
npm install
CHROME_PATH=/path/to/chrome node src/run.mjs --fixture --template template-c.html --date 2026-07-31
open posts/2026-07-31.jpg
```

## Scheduled one-off posts & the story queue

Beyond the automated daily schedule post, the **Content scheduler** workflow
(hourly) publishes hand-made content from plain files in `content/`:

- **One-off scheduled posts** (`content/scheduled/`) — drop in an image + a
  small JSON manifest saying when to post it, as a feed post or story:
  September class announcements, teacher features, promos, trainings, retreats.
- **Story queue** (`content/story-queue/`) — an ordered pile of story images
  drained automatically at configurable times each day (default: 3/day).

Commit + push to `main` and the scheduler takes it from there, writing
`postedAt` back into the manifests as the record of what went out. The
manifests are the whole API, so a future UI just needs to write these files.
See [`content/README.md`](content/README.md) for the file formats.

Test locally or from Actions with a dry run:

```bash
npm run scheduler:dry   # prints what would post right now, publishes nothing
```

## Switching to the direct Meta Graph API later

Delete the `MAKE_WEBHOOK_URL` secret and add `META_ACCESS_TOKEN`, `META_PAGE_ID`,
`META_IG_USER_ID` (a never-expiring System User token needs a Meta developer app —
see `src/post.mjs` for the calls). Everything else stays the same.

## Notes

- The repo must stay **public**: Instagram fetches the image from
  `raw.githubusercontent.com`, which is only reachable for public repos.
- If the studio is closed (no classes tomorrow), the job exits cleanly without posting.
- Timezone handling: the workflow fires at 02:00 and 03:00 UTC and a guard step lets
  through only the run where it's 7pm in `America/Los_Angeles`, so DST just works.
