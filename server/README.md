# External nightly pinger

The daily-post workflow's most reliable trigger is an outside "clock" telling
GitHub to run it (GitHub's own cron scheduler drifts by hours or skips nights
entirely). Anything that can make one HTTPS request per day can be that clock.
This directory contains everything needed to run it from your own server, or
from a free hosted cron service.

The request is a GitHub `repository_dispatch` call. It's idempotent — the
workflow's `posts/<date>.posted` marker means duplicate or overlapping
triggers can never double-post, so it's fine (even good) to run this *in
addition to* any other trigger.

## Step 1 — create the token (one time)

1. GitHub → Settings → Developer settings → **Fine-grained personal access
   tokens** → Generate new token.
2. Repository access: **Only select repositories** → `sealevel-social-scheduler`.
3. Permissions → Repository permissions → **Contents: Read and write**.
   (That's the only permission `repository_dispatch` needs.)
4. Expiration: pick the longest you're comfortable with, and calendar a
   reminder to rotate it.

Never commit this token, paste it in chat, or put it in cron-job.org's URL —
it goes only in a header (hosted service) or a `chmod 600` file (own server).

## Option A — your own server (cron)

```bash
# 1. Get the script onto the server
git clone --depth 1 https://github.com/petestewart/sealevel-social-scheduler /opt/sealevel
chmod +x /opt/sealevel/server/fire-nightly.sh

# 2. Store the token (readable only by your user)
mkdir -p ~/.config/sealevel
printf '%s\n' 'github_pat_XXXX' > ~/.config/sealevel/gh-token
chmod 600 ~/.config/sealevel/gh-token

# 3. Test it once — you should see "dispatched nightly-post OK",
#    and a "Daily schedule post" run appear in the repo's Actions tab
/opt/sealevel/server/fire-nightly.sh

# 4. Schedule it: crontab -e, then add
CRON_TZ=America/Los_Angeles
0 19 * * * /opt/sealevel/server/fire-nightly.sh >> ~/.config/sealevel/fire.log 2>&1
```

`CRON_TZ` keeps it at 7:00pm Pacific across DST changes (supported by
cronie/vixie-cron on most Linux distros; on systems without it, use a systemd
timer with `Timezone=America/Los_Angeles`, or set the server's TZ).

## Option B — cron-job.org (free hosted, no server needed)

1. Create a job at https://cron-job.org:
   - **URL:** `https://api.github.com/repos/petestewart/sealevel-social-scheduler/dispatches`
   - **Schedule:** daily at 19:00, timezone `America/Los_Angeles` (they handle DST)
   - **Advanced → Request method:** `POST`
   - **Advanced → Request body:** `{"event_type":"nightly-post"}`
   - **Advanced → Headers:**
     - `Authorization: Bearer github_pat_XXXX`
     - `Accept: application/vnd.github+json`
     - `X-GitHub-Api-Version: 2022-11-28`
2. Use "Test run" — success is HTTP **204** (empty body), and a
   "Daily schedule post" run appears in the Actions tab within seconds.
3. Turn on failure notifications in the job settings so you get an email if
   the ping itself ever fails.

## How it fits with the other triggers

| Trigger | Role |
| --- | --- |
| This pinger (`repository_dispatch`) | Primary clock once set up |
| Claude session push to `trigger/fire` | Current nightly clock; can stand down to verify-only |
| 5 GitHub `schedule` crons | Best-effort backup (often late/skipped) |
| `workflow_dispatch` | Manual runs from the Actions tab |

All of them funnel into the same guard: first one to run each evening posts
and commits `posts/<date>.posted`; every later trigger that day is a no-op.
