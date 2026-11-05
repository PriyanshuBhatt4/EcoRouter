# EcoRouteApp

Eco-friendly trip prototyper: find up to 3 walking/cycling routes to a destination, compare them (fastest / shortest / cleanest / optimal), see a regional-model PM2.5 estimate, then track the real trip with GPS and keep a local trip history. Educational prototype — routes and air values come from free public services and are estimates only, not street-level or safety advice.

- **Phone app**: Expo (SDK 54) — React Native, react-native-maps, expo-location. Profile + trip history are stored **on the device only** (no account needed).
- **Backend**: FastAPI — destination geocoding (OpenStreetMap Nominatim), routing (Valhalla public server), PM2.5 estimates (Open-Meteo / CAMS). Runs **without a database or any cloud configuration**; optional cloud-sync endpoints degrade gracefully with clear `503` messages until Supabase is configured.

## Run the demo (2 terminals + a phone)

**Requirements**: Node.js 22.13+ (Node 24 works too — needed by Expo SDK 54 and the app's test tooling), Python 3.13, and the **Expo Go** app on a phone (App Store / Play Store) connected to the **same Wi-Fi** as this computer.

**1. Start the backend** (first time: `pip install` then done; later, just activate + uvicorn):

```powershell
cd backend
.\ecorouter\Scripts\Activate.ps1
pip install -r requirements.txt -r requirements-dev.txt
.\ecorouter\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Quick check: open http://localhost:8000/health in a browser — it should say `"status":"ok"`.

**2. Start the phone app**:

```powershell
cd ..        (back to the project root)
npm install  (first time only)
npx expo start
```

**3. Connect the phone**: scan the QR code shown in the terminal with **Expo Go** (Android app / iOS Camera).

**4. Point the app at your backend.** The app reads the backend address from `.env.local` in the project root (`EXPO_PUBLIC_API_BASE_URL`, e.g. `http://<your-computer-ip>:8000`). If your computer's IP changed, find it with `ipconfig` (look for "IPv4 Address" under your Wi-Fi adapter), put it in `.env.local`, save, and restart `npx expo start` (press `r` in the expo terminal). Then type a destination in the app (e.g. "Hauz Khas") and tap **Find Routes**.

### Emulator instead of a phone

- **Android emulator**: set `EXPO_PUBLIC_API_BASE_URL=http://10.0.2.2:8000`. To simulate movement: emulator menu (⋮) → Location, or use the emulator's map playback.
- **iOS simulator** (Mac): `EXPO_PUBLIC_API_BASE_URL=http://localhost:8000`.

### Use the phone from any network (hosted backend)

The local setup above only works when phone and computer share one Wi-Fi. To use the app on **other Wi-Fi networks or mobile data**, host the backend publicly (`https://`) and point the app at it — the backend URL is the only address the app ever needs.

The project ships a ready hosting spec: **`render.yaml` (repository root)** — a Render blueprint for the `backend/` service (free plan, `uvicorn app.main:app` startup, `/health` check, CORS open to any origin). One manual deployment is required:

1. **Get the code into a Git host you control.** Render deploys from a Git repository (GitHub/GitLab). Create an account + an empty repo if you don't have one, then put this project there (a git commit + push must be done by you — work in this repo is deliberately left uncommitted).
2. **Deploy on Render**: render.com → "New" → "Blueprint" → select your repo. Render reads the **`render.yaml` at the repository root** (build: `pip install -r requirements.txt`, start: `uvicorn app.main:app`, health check `/health`, free plan). No database configuration is required — cloud-sync endpoints stay honest `503`s.
3. Optionally set the environment variables listed (empty by design) in `render.yaml` — `DATABASE_URL`, `SUPABASE_*` — only if you later want cloud sync. **Never put backend secrets into any Expo variable**; Expo vars are compiled into the app.
4. Verify the URL honestly: open `https://<your-service>.onrender.com/health` — it must say `"status":"ok"`. Until this succeeds, the app must keep using the local setup.
5. Point the app at it: in the project root `.env.local` set `EXPO_PUBLIC_API_BASE_URL=https://<your-service>.onrender.com` (restart `npx expo start`, press `r`). This works even while running the app through Expo Go, from any network.
6. For a **production app build** (no Expo Go), set `EXPO_PUBLIC_API_URL_PRODUCTION=https://<your-service>.onrender.com` when building — the app uses it whenever the dev variable is unset. No fallback URL is ever assumed.

Note: free Render services sleep when idle; the first request after sleep can take ~30 s (the app shows its normal "could not reach the backend" message, then works once the service wakes).

## Standalone Android APK (no Expo Go, no laptop needed)

The `preview` profile in `eas.json` builds an installable **APK** (internal distribution) that bakes the hosted backend URL in. The dev override `EXPO_PUBLIC_API_BASE_URL` is deliberately blank in this profile and `.env*` files never leave your machine (git-ignored, excluded from the EAS upload) — a laptop LAN IP can never leak into the APK.

One-time setup (requires your own Expo account):

1. `npm i -g eas-cli`
2. `eas login`
3. `npx eas init` (links this folder to your Expo account; writes `extra.eas.projectId` into `app.json`)
4. Make sure the hosted backend is live: `https://ecorouter-backend.onrender.com/health` returns `"status":"ok"`.

### Google Maps API key (required for standalone builds)

A standalone APK crashed on Android with `IllegalStateException: API key not found … com.google.android.geo.API_KEY` when the map first mounted (Expo Go bundles its own key; an APK does not). The key is read from `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` by `app.config.js` — nothing is hardcoded and no secret is committed:

1. Google Cloud Console → create/select a project → enable **Maps SDK for Android**.
2. Create an **API key**, then restrict it: *Application restrictions → Android apps*, package name `com.priyanshubhatt.ecorouter`, plus your signing key's SHA-1 fingerprint (EAS shows it under the build details page → "Android keystore"; use the release certificate SHA-1).
3. Give the key to the build (never the repo): `eas env:create --name EXPO_PUBLIC_GOOGLE_MAPS_API_KEY --value <YOUR_KEY> --environment production --type string` (link projects via `--project <your-project-id>` if asked). If you use a non-default EAS environment for the preview profile, add `--environment preview` instead and set `"environment"` in the profile.
4. Rebuild and reinstall: `eas build -p android --profile preview`.
5. First launch requires location permission (a foreground-only prompt; no background location is requested).

Build:

- `eas build -p android --profile preview`
- Optional pre-check that no env files reach the builder: `npx eas build:inspect --profile preview -p android --stage archive --output <existing-folder>` (confirm no `.env*` inside before real builds).

Download & install:

1. When the build finishes, the terminal prints a build page link (also on https://expo.dev under your project → Builds).
2. Open the APK install link on your Android phone (Chrome can scan/QR from the build page) and allow the unknown-source prompt, or download the `.apk` from the build page and copy/`adb install` it.
3. First launch requires location permission (a foreground-only prompt; no background location is requested).

## Tests

- Backend (from `backend/`): `.\ecorouter\Scripts\python.exe -m pytest -q`
- App (from project root): `npm test`

## Troubleshooting

| Symptom | Fix |
|---|---|
| App says "Could not reach the backend…" | Local setup: backend not started, or `.env.local` has the wrong IP → restart backend + `npx expo start`. Phone and computer must be on the same Wi-Fi (guest networks often block this); Windows Defender/firewall may ask to allow Python — allow it. Hosted setup: service may be waking up (free tier sleeps) → try again in ~30 s. |
| "Backend address is not configured" | No backend URL set → create `EXPO_PUBLIC_API_BASE_URL=http://<computer-ip>:8000` (local) or `=https://<your-service>.onrender.com` (hosted) in `.env.local`, save, restart expo (press `r`). |
| "No location found for that destination" | Try a more specific place ("Hauz Khas, New Delhi"). |
| "The mapping service timed out / unavailable" | Public prototype servers are best-effort — try again. |
| Location permission denied | App still works on the map (defaults to a Delhi view) — but routes need your GPS; grant location in Settings. |
| `GET /me/...` returns 503 `AUTH_NOT_CONFIGURED` / `DB_NOT_CONFIGURED` | Expected: cloud profile/trip sync is optional and not configured. The app itself needs no login — trips are stored on the device. |

## Notes & limitations

- Routing/geocoding/air-quality use public prototype services without SLA; durations are provider estimates (no live traffic).
- PM2.5 is a **regional model estimate (CAMS)** — not street-level pollution and not health advice; it often can't distinguish nearby routes (the app says so explicitly when that happens).
- Trip distance is GPS-derived with a simple noise filter; tracking is foreground-only.
- Data sent to public services: origin/destination coordinates and route sample points. No accounts, analytics, or third-party tracking in v1.
- Cloud sync (`/me/*` endpoints, Supabase + Postgres) is backend-ready but **out of scope** for the local demo — see `PROJECT_PLAN.md` for the plan, assumptions, and deferred decisions.
