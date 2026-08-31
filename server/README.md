# External nightly pinger

The daily-post workflow's most reliable trigger is an outside clock telling
GitHub to run it — GitHub's own cron scheduler drifts by hours or skips nights
entirely. Anything that can make one HTTPS request per day can be that clock.

The request is a GitHub `repository_dispatch` call. It's idempotent: the
workflow's `posts/<date>.posted` marker means duplicate or overlapping
triggers can never double-post, so it's safe to run this alongside any other
trigger.

Three ways to run it, in order of preference.

## Option A — Railway cron service (recommended)

Uses `server/fire-nightly.mjs` (Node 18+, no dependencies). Railway cron
schedules are UTC, which would drift an hour at DST, so the service is
scheduled hourly across the candidate window and the script itself only fires
when it is actually 7pm in America/Los_Angeles. DST handles itself.

1. Railway → New → **Deploy from GitHub repo** → `sealevel-social-scheduler`.
2. Settings → **Start Command**: `node server/fire-nightly.mjs`
3. Settings → **Cron Schedule**: `0 2-4 * * *`
4. Variables → add `GH_DISPATCH_TOKEN` = the fine-grained PAT (see below).
5. Deploy. To test immediately, add `FORCE=1`, redeploy, check the logs for
   `dispatched nightly-post OK`, then remove `FORCE`.

Optional variables: `FIRE_AT_HOUR` (default `19`), `FIRE_TZ` (default
`America/Los_Angeles`), `GH_REPO`.

## Option B — any Linux box (cron)

```bash
git clone --depth 1 https://github.com/petestewart/sealevel-social-scheduler /opt/sealevel
mkdir -p ~/.config/sealevel
printf '%s\n' 'github_pat_XXXX' > ~/.config/sealevel/gh-token
chmod 600 ~/.config/sealevel/gh-token
/opt/sealevel/server/fire-nightly.sh   # test — expect "dispatched nightly-post OK"

# crontab -e
CRON_TZ=America/Los_Angeles
0 19 * * * /opt/sealevel/server/fire-nightly.sh >> ~/.config/sealevel/fire.log 2>&1
```

`CRON_TZ` keeps it at 7pm Pacific across DST (cronie/vixie-cron). On systems
without it, use a systemd timer with `Timezone=America/Los_Angeles`.

## Option C — cron-job.org (hosted, free, no infrastructure)

Only worth it if there's nowhere to host. It means storing a GitHub token on
a third-party service, so scope the token tightly and rotate it if you stop
using them.

- **URL:** `https://api.github.com/repos/petestewart/sealevel-social-scheduler/dispatches`
- **Schedule:** daily 19:00, timezone `America/Los_Angeles`
- **Method:** `POST` — **Body:** `{"event_type":"nightly-post"}`
- **Headers:** `Authorization: Bearer github_pat_XXXX`,
  `Accept: application/vnd.github+json`,
  `X-GitHub-Api-Version: 2022-11-28`
- Success on "Test run" is HTTP **204** with an empty body.

## The token (needed by all three)

GitHub → Settings → Developer settings → **Fine-grained personal access
tokens** → Generate new token:

- Repository access: **Only select repositories** → `sealevel-social-scheduler`
- Permissions → Repository permissions → **Contents: Read and write**

That single permission is all `repository_dispatch` needs. The token can't
touch any other repo, can't read secrets, and can't change settings. Never
commit it — it goes in a Railway variable, a `chmod 600` file, or a request
header.

## How the triggers fit together

| Trigger | Role |
| --- | --- |
| External pinger (`repository_dispatch`) | Primary clock once set up |
| Claude session push to `trigger/fire` | Current clock; drops to verify-only after |
| 5 GitHub `schedule` crons | Best-effort backup (often late or skipped) |
| `workflow_dispatch` | Manual runs from the Actions tab |

All funnel into the same guard: the first trigger each evening posts and
commits `posts/<date>.posted`; every later one that day is a no-op.
