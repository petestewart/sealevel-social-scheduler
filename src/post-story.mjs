// Post a single image from this repo as an Instagram Story.
// Usage: node src/post-story.mjs <repo-relative-image-path>
const rel = process.argv[2]?.trim();
if (!rel) {
  console.error("Usage: node src/post-story.mjs <repo-relative-image-path>");
  process.exit(1);
}

const token = process.env.IG_LOGIN_TOKEN;
const igUserId = process.env.IG_LOGIN_USER_ID;
if (!token || !igUserId) throw new Error("IG_LOGIN_TOKEN and IG_LOGIN_USER_ID are required.");

const repo = process.env.GITHUB_REPOSITORY;
const branch = process.env.GITHUB_REF_NAME || "main";
const imageUrl = `https://raw.githubusercontent.com/${repo}/${branch}/${rel}`;

for (let i = 0; i < 30; i++) {
  try {
    const res = await fetch(imageUrl, { method: "HEAD" });
    if (res.ok) break;
  } catch {}
  if (i === 29) throw new Error(`Image never became reachable: ${imageUrl}`);
  console.log(`Image not reachable yet (${i + 1}/30), waiting...`);
  await new Promise((r) => setTimeout(r, 6000));
}
console.log(`Image is live: ${imageUrl}`);

const G = "https://graph.instagram.com/v21.0";
const containerRes = await fetch(`${G}/${igUserId}/media`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ image_url: imageUrl, media_type: "STORIES", access_token: token }),
});
const container = await containerRes.json();
if (!container.id) throw new Error(`IG container failed: ${JSON.stringify(container)}`);

await new Promise((r) => setTimeout(r, 8000));

const publishRes = await fetch(`${G}/${igUserId}/media_publish`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ creation_id: container.id, access_token: token }),
});
const publish = await publishRes.json();
if (!publish.id) throw new Error(`IG publish failed: ${JSON.stringify(publish)}`);
console.log(`Instagram Story published: ${publish.id}`);
