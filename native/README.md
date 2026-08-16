# Spend Log — Android build

Packages the web app from [`../docs`](../docs) into an installable Android APK
using [Capacitor](https://capacitorjs.com/).

## Why this exists

The web version installs to the home screen and works offline, but its data
lives in Chrome's storage for the site's origin. **Clearing browser data
deletes your spending history**, and no web API prevents that —
`navigator.storage.persist()` only protects against automatic eviction when the
device is low on space, not against a deliberate clear.

The APK runs the same files in its own WebView, so the data sits in the app's
private storage. Clearing your browser has no effect on it. Only uninstalling
the app, or clearing its storage in Android Settings, removes the data.

Everything else is identical — it's the same `docs/` source, not a fork.

## Building

Requires the Android SDK (platform 35, build-tools 35.0.0), JDK 21 and Node.

```bash
cd native
npm install
npm run apk        # syncs ../docs into www/ and builds a debug APK
```

The debug APK lands in `android/app/build/outputs/apk/debug/`.

For a release build:

```bash
cd android && ./gradlew assembleRelease
```

then zipalign and sign `app-release-unsigned.apk` yourself (see below).

## Signing — read this before rebuilding

Android will only install an update over an existing app if **both are signed
with the same key**. Install an APK signed with a different key and the install
fails; you have to uninstall first, which erases the app's data.

Gradle's automatic debug key is generated per machine, so debug builds from a
fresh checkout will *not* be able to update each other. Keep one release
keystore somewhere safe and reuse it for every build:

```bash
keytool -genkeypair -keystore spendlog-release.jks -alias spendlog \
  -keyalg RSA -keysize 4096 -validity 10950

zipalign -f -p 4 app-release-unsigned.apk aligned.apk
apksigner sign --ks spendlog-release.jks --out SpendLog.apk aligned.apk
```

`*.jks` and `*.keystore` are gitignored. **Never commit a signing key to this
repository — it is public.**

If a key does get lost, the app's JSON export is the escape hatch: export from
the old install, uninstall, install the newly-signed build, import.

## How the two builds differ

`docs/` is the single source of truth. `npm run sync` stages it into `www/`,
skipping files that make no sense inside a package:

| Skipped | Why |
|---|---|
| `sw.js` | The service worker caches files fetched over the network. In the APK every asset is already local — it would be a cache in front of a cache. |
| `README.md`, `make_icons.py` | Developer files, not app assets. |

At runtime the app checks for `window.Capacitor` and adjusts two things: it
skips service-worker registration, and it tells the truth in Settings about
where the data lives and what can delete it.

## Layout

| Path | Role |
|---|---|
| `capacitor.config.json` | app id, name, and the dark background colour |
| `scripts/sync-web.mjs` | stages `../docs` into `www/` |
| `scripts/make_launcher_icons.py` | adaptive + legacy launcher icons (needs Pillow) |
| `android/` | the generated Gradle project; committed so builds are reproducible |
| `www/` | generated, gitignored — never edit it directly |

## Known gaps

- **Updates are manual.** No auto-update; rebuild and reinstall.
- **The `INTERNET` permission is declared** by Capacitor's default manifest.
  The app makes no network requests — every asset is local and there is no
  server — but the permission is present, and removing it was not tested
  against a real device.
