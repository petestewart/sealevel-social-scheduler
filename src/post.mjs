import { readFile } from "node:fs/promises";
import path from "node:path";
import { POSTS_DIR, tomorrowIso } from "./lib.mjs";

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const date = opt("date") ?? tomorrowIso();
const caption = await readFile(path.join(POSTS_DIR, `${date}.txt`), "utf8");

// The PNG must be publicly reachable before Instagram will accept it.
// CI commits posts/<date>.png and pushes, then this script waits for the
// raw.githubusercontent.com URL to go live before calling the webhook.
const repo = process.env.GITHUB_REPOSITORY; // e.g. petestewart/sealevel-social
const branch = process.env.GITHUB_REF_NAME || "main";
const imageUrl =
  opt("image-url") ?? `https://raw.githubusercontent.com/${repo}/${branch}/posts/${date}.png`;

if (!opt("image-url") && !repo) {
  console.error("GITHUB_REPOSITORY is not set and no --image-url given.");
  process.exit(1);
}

async function waitForUrl(url, attempts = 30, delayMs = 6000) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { method: "HEAD" });
      if (res.ok) return;
    } catch {}
    console.log(`Image not reachable yet (${i + 1}/${attempts}), waiting...`);
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(`Image never became reachable: ${url}`);
}

await waitForUrl(imageUrl);
console.log(`Image is live: ${imageUrl}`);

const webhook = process.env.MAKE_WEBHOOK_URL;
const metaToken = process.env.META_ACCESS_TOKEN;

if (webhook) {
  // ---- Make.com mode (default) ----
  const res = await fetch(webhook, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ date, image_url: imageUrl, caption }),
  });
  if (!res.ok) throw new Error(`Make webhook failed: ${res.status} ${await res.text()}`);
  console.log("Sent to Make.com webhook — Make handles Instagram + Facebook.");
} else if (metaToken) {
  // ---- Direct Meta Graph API mode (set META_* secrets and remove MAKE_WEBHOOK_URL) ----
  const pageId = process.env.META_PAGE_ID;
  const igUserId = process.env.META_IG_USER_ID;
  if (!pageId || !igUserId) throw new Error("META_PAGE_ID and META_IG_USER_ID are required in direct mode.");
  const G = "https://graph.facebook.com/v21.0";

  const containerRes = await fetch(`${G}/${igUserId}/media`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ image_url: imageUrl, caption, access_token: metaToken }),
  });
  const container = await containerRes.json();
  if (!container.id) throw new Error(`IG container failed: ${JSON.stringify(container)}`);
  const publishRes = await fetch(`${G}/${igUserId}/media_publish`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ creation_id: container.id, access_token: metaToken }),
  });
  const publish = await publishRes.json();
  if (!publish.id) throw new Error(`IG publish failed: ${JSON.stringify(publish)}`);
  console.log(`Instagram post published: ${publish.id}`);

  const fbRes = await fetch(`${G}/${pageId}/photos`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: imageUrl, message: caption, access_token: metaToken }),
  });
  const fb = await fbRes.json();
  if (!fb.id && !fb.post_id) throw new Error(`Facebook post failed: ${JSON.stringify(fb)}`);
  console.log(`Facebook post published: ${fb.post_id ?? fb.id}`);
} else {
  console.log("DRY RUN — no MAKE_WEBHOOK_URL or META_ACCESS_TOKEN configured.");
  console.log(`Would post image: ${imageUrl}`);
  console.log(`Caption:\n${caption}`);
}
