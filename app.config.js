// Expo config (replaces app.json at build time — the JSON file stays for
// editors/tools that read it, and this file re-exports it verbatim except for
// ONE dynamically-injected value: the Google Maps Android API key).
//
// Why dynamic: the log-driven fix for the standalone APK crash was the missing
// `com.google.android.geo.API_KEY` manifest meta-data (see ecorouter-crash.txt:
// IllegalStateException 'API key not found' thrown from
// com.rnmaps.maps.MapView.<init> when the Google Play maps library inflates).
// Expo Go bundles its own key, so local Expo sessions never needed it.
// The key is user-owned and RESTRICTED in the Google console (package
// com.priyanshubhatt.ecorouter + your key's SHA-1); it must never be committed
// into this repository, so it is read from an environment variable injected by
// EAS Build (EAS env: EXPO_PUBLIC_GOOGLE_MAPS_API_KEY) instead of being
// hardcoded. When it is absent (local Expo Go usage), the value stays unset
// and Expo Go continues to work exactly as before.
//
// NOTE: this file MUST stay CommonJS (module.exports) — Expo evaluates dynamic
// configs through require-from-string, and ESM `export default` throws
// "exports is not defined in ES module scope".
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const base = JSON.parse(readFileSync(join(__dirname, 'app.json'), 'utf8')).expo;

const mapsKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;

module.exports = {
  ...base,
  android: {
    ...base.android,
    // Classic Expo config (still honored by SDK 54 prebuild): this is what
    // writes the com.google.android.geo.API_KEY meta-data into the standalone
    // AndroidManifest. Omitted entirely when no key is present so Expo Go
    // behavior is untouched.
    ...(mapsKey ? { config: { googleMaps: { apiKey: mapsKey } } } : {}),
  },
};
