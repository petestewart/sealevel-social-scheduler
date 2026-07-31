// Refresh the Instagram-login long-lived token (60-day lifetime) and store the
// new value back into the repo's IG_LOGIN_TOKEN secret so it never expires.
//
// Requires:
//   IG_LOGIN_TOKEN — current token (from repo secrets)
//   GH_PAT         — fine-grained personal access token with "Secrets: write"
//                    on this repo, so the refreshed token can be saved.
//   GITHUB_REPOSITORY — owner/repo (set automatically in Actions)

const token = process.env.IG_LOGIN_TOKEN;
const pat = process.env.GH_PAT;
const repo = process.env.GITHUB_REPOSITORY;

if (!token) {
  console.log("IG_LOGIN_TOKEN not set — nothing to refresh.");
  process.exit(0);
}

const res = await fetch(
  `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token)}`,
);
const data = await res.json();
if (!data.access_token) {
  throw new Error(
    `Token refresh failed: ${JSON.stringify(data)}. ` +
      "If the token is fully expired (>60 days old), generate a new one in the Meta app dashboard.",
  );
}
console.log(`Token refreshed; new expiry in ${Math.round(data.expires_in / 86400)} days.`);

if (!pat) {
  console.log("GH_PAT not set — cannot store the refreshed token automatically.");
  console.log("The current token keeps working, but set GH_PAT to make renewal permanent.");
  process.exit(0);
}

// Store back to the repo secret via the GitHub REST API (libsodium sealed box).
const api = `https://api.github.com/repos/${repo}/actions/secrets`;
const headers = {
  authorization: `Bearer ${pat}`,
  accept: "application/vnd.github+json",
};

const keyRes = await fetch(`${api}/public-key`, { headers });
const key = await keyRes.json();
if (!key.key) throw new Error(`Could not fetch repo public key: ${JSON.stringify(key)}`);

const sodium = (await import("libsodium-wrappers")).default;
await sodium.ready;
const sealed = sodium.crypto_box_seal(
  sodium.from_string(data.access_token),
  sodium.from_base64(key.key, sodium.base64_variants.ORIGINAL),
);
const encrypted = sodium.to_base64(sealed, sodium.base64_variants.ORIGINAL);

const putRes = await fetch(`${api}/IG_LOGIN_TOKEN`, {
  method: "PUT",
  headers: { ...headers, "content-type": "application/json" },
  body: JSON.stringify({ encrypted_value: encrypted, key_id: key.key_id }),
});
if (!putRes.ok) throw new Error(`Failed to update secret: ${putRes.status} ${await putRes.text()}`);
console.log("Refreshed token saved to the IG_LOGIN_TOKEN secret.");
