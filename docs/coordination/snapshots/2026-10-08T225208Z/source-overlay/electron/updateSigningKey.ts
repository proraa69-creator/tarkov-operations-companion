/**
 * Ed25519 public key that checks the players' update manifest (/download/version.json → `signature`, electron/appUpdate.ts).
 * The matching private key is never in the repository or on the server laptop: the build signs the manifest with it
 * (scripts/sign-client-release.mjs reads RAIDOS_UPDATE_SIGNING_KEY or RAIDOS_UPDATE_SIGNING_KEY_FILE). A copy of the app
 * only installs a build whose manifest this key verifies, so a changed exe on the laptop or a fake server cannot update it.
 */
export const UPDATE_SIGNING_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAKZvHCzEoTHopZz6UUs0JSWI3BRWiw951a58g3Fwos0U=
-----END PUBLIC KEY-----
`
