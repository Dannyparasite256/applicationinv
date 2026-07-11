# Enterprise IMS — Native Android App

The mobile app is a **native Android shell** (Capacitor) around the same React UI + REST API. You get an installable APK with native back button, status bar, splash, and offline-ready WebView — without rewriting the product in Kotlin.

## Architecture

```
┌─────────────────────────┐
│  Android App (Capacitor)│
│  WebView → React UI     │
└───────────┬─────────────┘
            │ HTTPS / HTTP
            ▼
┌─────────────────────────┐
│  Node API + PostgreSQL  │
│  (your server or LAN)   │
└─────────────────────────┘
```

| Piece | Location |
|--------|----------|
| App ID | `com.enterprise.ims` |
| UI | `frontend/` (Vite + React) |
| Native project | `frontend/android/` (after `cap add`) |
| Config | `frontend/capacitor.config.ts` |

## Prerequisites (on your PC)

1. **Node.js 20+**
2. **Android Studio** (Hedgehog or newer)  
   https://developer.android.com/studio  
   Install: Android SDK, Platform Tools, one system image (API 34+)
3. **JDK 17** (Android Studio bundles one; set `JAVA_HOME`)
4. Running **API + database** (same as web)

## One-time setup

```bash
cd frontend
npm install

# Build web assets
npm run build

# Create Android project (first time only)
npx cap add android

# Copy web build into Android + update plugins
npx cap sync android
```

## Run on emulator / phone

### 1. Start backend (listens on all interfaces)

```bash
# From repo root — ensure CORS allows mobile (already configured)
cd backend
# DATABASE_URL=...
npx tsx src/server.ts
```

API should be reachable at `http://0.0.0.0:4000` (or your machine IP).

### 2. Point the app at the API

**Emulator** (default in `.env.android`):

```env
VITE_API_URL=http://10.0.2.2:4000/api/v1
```

`10.0.2.2` is the special Android emulator address for your PC’s `localhost`.

**Physical phone** (same Wi‑Fi as PC):

```env
VITE_API_URL=http://192.168.x.x:4000/api/v1
```

Use your PC’s LAN IP (`ipconfig` on Windows).

Then rebuild:

```bash
cd frontend
# Windows PowerShell example:
$env:VITE_API_URL="http://10.0.2.2:4000/api/v1"
npm run build
npx cap sync android
npx cap open android
```

### 3. Open in Android Studio

```bash
npm run android:open
# or: npx cap open android
```

- Wait for Gradle sync  
- Pick emulator or USB device  
- Click **Run ▶**

## Build a release APK / AAB

1. In Android Studio: **Build → Generate Signed Bundle / APK**
2. Create a keystore (keep it safe)
3. Build **release** APK or Play Store **AAB**

CLI (after signing is configured in `android/app`):

```bash
cd frontend/android
./gradlew assembleRelease
# APK: app/build/outputs/apk/release/
```

## Daily workflow after UI changes

```bash
cd frontend
npm run android:build   # vite build + cap sync
npx cap open android    # then Run in Android Studio
```

## Live reload (optional)

In `capacitor.config.ts`:

```ts
server: {
  url: 'http://10.0.2.2:5173', // emulator → Vite on PC
  cleartext: true,
},
```

Run `npm run dev -- --host` so Vite listens on the LAN, then `npx cap run android`.

## Login on mobile

Same dynamic staff credentials as web:

1. Admin creates staff on web or mobile  
2. **Confirm Staff**  
3. Staff signs in with the email/password admin set  

No hardcoded worker logins.

## Permissions (AndroidManifest)

Capacitor adds network permission by default. For production printers / camera / barcode later, add plugins:

```bash
npm install @capacitor/camera @capacitor-community/barcode-scanner
npx cap sync
```

## Troubleshooting

| Issue | Fix |
|--------|-----|
| Blank screen / API fail on emulator | Use `http://10.0.2.2:4000/api/v1`, API running, `cleartext: true` |
| Phone can’t reach API | Same Wi‑Fi, Windows Firewall allow port 4000, use PC LAN IP |
| CORS errors | Backend already allows Capacitor origins + LAN; restart API |
| Gradle / SDK missing | Open project in Android Studio and install suggested SDK |
| `java` not found | Install JDK 17 and set `JAVA_HOME` |

## What this is (and isn’t)

- **Is:** Installable native Android app packaging the full ERP UI + native chrome  
- **Is not:** A full Kotlin rewrite — business logic stays on your Node API  

For Play Store, use HTTPS API in production and a signed release build.
