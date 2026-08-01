import { readFile } from "node:fs/promises";
import path from "node:path";
import { POSTS_DIR, tomorrowIso } from "./lib.mjs";
import { publishImage, waitForUrl } from "./publish.mjs";

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const date = opt("date") ?? tomorrowIso();
const caption = await readFile(path.join(POSTS_DIR, `${date}.txt`), "utf8");

// The image must be publicly reachable before Instagram will accept it.
// CI commits posts/<date>.jpg and pushes, then this script waits for the
// raw.githubusercontent.com URL to go live before publishing.
const repo = process.env.GITHUB_REPOSITORY; // e.g. petestewart/sealevel-social
const branch = process.env.GITHUB_REF_NAME || "main";
const imageUrl =
  opt("image-url") ?? `https://raw.githubusercontent.com/${repo}/${branch}/posts/${date}.jpg`;

if (!opt("image-url") && !repo) {
  console.error("GITHUB_REPOSITORY is not set and no --image-url given.");
  process.exit(1);
}

await waitForUrl(imageUrl);
console.log(`Image is live: ${imageUrl}`);

// Default is a Story (24h, full-screen). Set IG_MEDIA_TYPE=FEED for a grid post.
const mediaType = (process.env.IG_MEDIA_TYPE || "STORIES").toUpperCase() === "FEED" ? "FEED" : "STORY";
await publishImage({ imageUrl, caption, mediaType, date });
