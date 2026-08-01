// Shared publishing layer: takes a publicly-reachable image URL + caption and
// posts it through whichever mode is configured (same precedence as always):
//   1. IG_LOGIN_TOKEN  — Instagram-login API (supports STORY and FEED)
//   2. MAKE_WEBHOOK_URL — Make.com webhook (payload includes media_type)
//   3. META_ACCESS_TOKEN — direct Meta Graph API (IG + Facebook Page)
// With none configured it logs what it would do (dry run).

/** Poll a URL until it responds OK — raw.githubusercontent takes a moment after push. */
export async function waitForUrl(url, attempts = 30, delayMs = 6000) {
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

/** raw.githubusercontent.com URL for a repo-relative path (must be committed + pushed). */
export function rawImageUrl(relPath) {
  const repo = process.env.GITHUB_REPOSITORY;
  const branch = process.env.GITHUB_REF_NAME || "main";
  if (!repo) throw new Error("GITHUB_REPOSITORY is not set — cannot build a public image URL.");
  return `https://raw.githubusercontent.com/${repo}/${branch}/${relPath}`;
}

async function igApiPublish({ base, userId, token, imageUrl, caption, asStory }) {
  const containerBody = { image_url: imageUrl, access_token: token };
  if (asStory) containerBody.media_type = "STORIES"; // captions are ignored on Stories
  else containerBody.caption = caption;

  const containerRes = await fetch(`${base}/${userId}/media`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(containerBody),
  });
  const container = await containerRes.json();
  if (!container.id) throw new Error(`IG container failed: ${JSON.stringify(container)}`);

  // Containers can take a moment to be ready before publishing.
  await new Promise((r) => setTimeout(r, 8000));

  const publishRes = await fetch(`${base}/${userId}/media_publish`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ creation_id: container.id, access_token: token }),
  });
  const publish = await publishRes.json();
  if (!publish.id) throw new Error(`IG publish failed: ${JSON.stringify(publish)}`);
  console.log(`Instagram ${asStory ? "story" : "post"} published: ${publish.id}`);
}

/**
 * Publish one image.
 * @param {object} opts
 * @param {string} opts.imageUrl publicly reachable image URL
 * @param {string} [opts.caption] caption (ignored by Instagram for stories)
 * @param {string} [opts.mediaType] "STORY" (default) or "FEED"
 * @param {string} [opts.date] optional label passed through to the Make webhook
 */
export async function publishImage({ imageUrl, caption = "", mediaType = "STORY", date }) {
  const asStory = String(mediaType).toUpperCase() !== "FEED";
  const igLoginToken = process.env.IG_LOGIN_TOKEN;
  const webhook = process.env.MAKE_WEBHOOK_URL;
  const metaToken = process.env.META_ACCESS_TOKEN;

  if (igLoginToken) {
    // ---- Instagram-login API mode (no Facebook involved) ----
    const igUserId = process.env.IG_LOGIN_USER_ID;
    if (!igUserId) throw new Error("IG_LOGIN_USER_ID is required alongside IG_LOGIN_TOKEN.");
    await igApiPublish({
      base: "https://graph.instagram.com/v21.0",
      userId: igUserId,
      token: igLoginToken,
      imageUrl,
      caption,
      asStory,
    });
  } else if (webhook) {
    // ---- Make.com mode ----
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        date,
        image_url: imageUrl,
        caption,
        media_type: asStory ? "STORY" : "FEED",
      }),
    });
    if (!res.ok) throw new Error(`Make webhook failed: ${res.status} ${await res.text()}`);
    console.log("Sent to Make.com webhook — Make handles Instagram + Facebook.");
  } else if (metaToken) {
    // ---- Direct Meta Graph API mode ----
    const pageId = process.env.META_PAGE_ID;
    const igUserId = process.env.META_IG_USER_ID;
    if (!pageId || !igUserId) throw new Error("META_PAGE_ID and META_IG_USER_ID are required in direct mode.");
    const G = "https://graph.facebook.com/v21.0";
    await igApiPublish({ base: G, userId: igUserId, token: metaToken, imageUrl, caption, asStory });

    if (!asStory) {
      const fbRes = await fetch(`${G}/${pageId}/photos`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: imageUrl, message: caption, access_token: metaToken }),
      });
      const fb = await fbRes.json();
      if (!fb.id && !fb.post_id) throw new Error(`Facebook post failed: ${JSON.stringify(fb)}`);
      console.log(`Facebook post published: ${fb.post_id ?? fb.id}`);
    }
  } else {
    console.log("DRY RUN — no IG_LOGIN_TOKEN, MAKE_WEBHOOK_URL, or META_ACCESS_TOKEN configured.");
    console.log(`Would post ${asStory ? "STORY" : "FEED"} image: ${imageUrl}`);
    if (caption) console.log(`Caption:\n${caption}`);
  }
}
