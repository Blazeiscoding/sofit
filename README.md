# SoFit

An open-source, Whoop-style app for screenless fitness trackers on Google Health, starting with the **Google Fitbit Air**. Built with Expo (SDK 58) and React Native.

It reads your data through the Google Health API, so it works with Fitbit and Google trackers that sync to the Google Health app (Fitbit Air, other Fitbit bands, Pixel Watch). Other brands' screenless trackers (Whoop, Oura, Amazfit and so on) aren't supported yet. Contributions that add other data sources are welcome.

> **Status:** early personal project. The app builds and runs on Android, but it has only had light testing against real data, so expect rough edges. Not affiliated with Google, Fitbit or WHOOP, and not a medical device.

- **Overview:** Recovery, Strain and Sleep rings, plus vitals compared with your 30-day baseline (HRV, resting HR, breathing rate, SpO₂, skin temperature, VO₂ max), band battery and a daily AI morning brief.
- **Sleep:** stage timeline (hypnogram), sleep performance against need, sleep debt, efficiency, consistency, 14-night trend.
- **Strain:** a 0–21 score from minute-level heart rate, time in HR zones, intraday heart rate, workouts.
- **SoFit Age:** a biological age estimate with a per-factor breakdown and pace of aging.
- **Coach:** chat on your own OpenRouter key. The model calls tools that read your synced data on the phone, so its answers use your real numbers.
- **Alarms:** phone alarms, a bedtime suggestion from tonight's sleep need, and bedtime reminders.
- **Monitoring:** a background sync about every 15–30 minutes, with alerts for elevated resting HR, an HRV crash, low SpO₂, a breathing-rate spike, a temperature swing, low band battery or a stale band sync.

## How the data flows

```
Fitbit Air → Google Health app → Google cloud → Google Health API (v4) → SoFit (SQLite on the phone)
```

SoFit uses the **Google Health API**, which replaces the Fitbit Web API. Google turns the Fitbit Web API off on 2 November 2026. Access is read-only, and data shows up after the band syncs through the Google Health app, so it is delayed rather than live. Everything is stored on the device. Only the coach sends data off the phone, and only to OpenRouter.

**Known limitations**

- **Band alarms:** the Google Health API has no alarm endpoints, so SoFit can't set the band's Smart Wake vibration. Set that in the Google Health app; SoFit's phone alarm is the backup.
- **iOS alarm sound:** an alarm notification on iOS plays its sound once and doesn't keep ringing like the Clock app.
- **Heart-rate history:** the API serves minute-level heart rate for 14 days at a time. Strain for older days is estimated from Active Zone Minutes and steps.
- **Scores are estimates:** Recovery, Strain, Sleep and SoFit Age are SoFit's own formulas (see `src/scores/`), modelled on Whoop's published descriptions. They are not medical measurements.

## Setup

### 1. Google Cloud (one time, about 10 minutes)

1. Go to <https://console.cloud.google.com/> and create a project.
2. **APIs & Services → Library**: enable **Google Health API**.
3. **Google Auth Platform → Branding/Audience**: User type **External**. Add your Google account under **Test users**.
4. **Data Access**: add these scopes:
   - `https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly`
   - `https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly`
   - `https://www.googleapis.com/auth/googlehealth.sleep.readonly`
   - `https://www.googleapis.com/auth/googlehealth.settings.readonly`
5. **Audience → Publish app** (set it to *In production*). In *Testing* mode Google expires refresh tokens after 7 days, so you'd have to sign in again every week. An unverified app in production is fine for personal use: you'll see an "unverified app" warning when you sign in, and it's limited to 100 users.
6. **Clients → Create client → iOS**, with bundle ID `com.sofit.app`. Copy the client ID.
7. Create a `.env` file in the project root (see `.env.example`):
   ```
   EXPO_PUBLIC_GOOGLE_CLIENT_ID=1234567890-xxxx.apps.googleusercontent.com
   ```
   Sign-in uses the same iOS client on Android too, through its reversed-client-ID redirect scheme (`app.config.ts` registers it).

Also, in the **Google Health app** on your phone, sign in with the same Google account and finish its setup with your Fitbit Air paired. Until the account is linked, the API returns `ACCOUNT_NOT_LINKED`.

### 2. Run on Android

**Cloud build (no Android SDK needed).** EAS builds the app on Expo's servers; the free plan is enough.

```bash
npm install
npx eas-cli@latest login
npx eas-cli@latest init                   # links the app to your own Expo project (once)
npx eas-cli@latest env:create --name EXPO_PUBLIC_GOOGLE_CLIENT_ID --value <client id> --environment development --visibility plaintext
npx eas-cli@latest build -p android --profile development
```

Install the APK from the link EAS gives you, then run `npx expo start` on the same Wi-Fi and open the server in the app.

**Local build.** You need Android Studio (SDK and platform tools), JDK 17, and a phone with USB debugging enabled. Then run `npx expo run:android`.

After the first build, `npx expo start` is enough for JavaScript changes. Rebuild when you change native modules, `app.json`/`app.config.ts` or `.env`. `.easignore` keeps `.env` out of cloud uploads, so never put your OpenRouter key in EAS environment variables.

### 3. Run on iPhone

iOS builds happen in the cloud with EAS. You need a paid Apple Developer account.

```bash
npx eas-cli@latest login
npx eas-cli@latest env:create --name EXPO_PUBLIC_GOOGLE_CLIENT_ID --value <client id> --environment development --visibility plaintext
npx eas-cli@latest device:create          # register your iPhone
npx eas-cli@latest build -p ios --profile development
```

Install the build from the link EAS gives you, then run `npx expo start` and open the project in the dev client.

### 4. In the app

1. **Sign in with Google**, then fill in your profile (birth date, sex, height, weight, usual sleep need).
2. Paste your **OpenRouter key** (`sk-or-v1-…`), or put it in `.env` as `EXPO_PUBLIC_OPENROUTER_KEY` and it's copied into the phone's secure storage on first launch. The default model is `z-ai/glm-5.3-flash` (DeepSeek V4.1 Flash is one tap away); you can change it under Settings → Model.
3. The first sync downloads 90 days of data. Recovery needs at least 4 nights of HRV before it shows a score, and SoFit Age needs about a week of data.
4. **Alarms** (alarm icon on the Overview tab): on Android 14+, allow *Alarms & reminders* when the app asks, otherwise alarms can arrive late.

## Development

```bash
npm run typecheck
npm run lint
npm test              # score engines and alert rules
```

| Path | What it does |
| --- | --- |
| `src/api/auth.ts` | Google OAuth (PKCE), token refresh, secure storage |
| `src/api/googleHealth.ts` | Google Health API client (list, reconcile, rollUp, dailyRollUp, devices) |
| `src/sync/syncEngine.ts` | Incremental sync into SQLite: 90-day backfill, 3-day overlap, 14 days of minute-level HR |
| `src/scores/` | Recovery, Strain, Sleep and SoFit Age (pure functions, unit-tested); age norms are in `AGE_NORMS` |
| `src/monitor/` | Alert rules and the background task |
| `src/alarm/alarms.ts` | Phone alarms, snooze, bedtime reminder, sleep-need plan |
| `src/ai/` | OpenRouter streaming, coach tools, prompts, morning brief |
| `src/app/` | Expo Router screens |

### Troubleshooting

- **Google rejects the redirect on Android** (`invalid_request` or "custom scheme" errors): create an **Android** OAuth client (package `com.sofit.app`, plus the SHA-1 from `cd android && ./gradlew signingReport`). Under its advanced settings, enable *custom URI scheme*, and put that client ID in `.env`.
- **"Session expired" every week:** the consent screen is still in *Testing*. Publish it (step 1.5).
- **No recovery score:** HRV comes from sleep. Wear the band overnight and let the Google Health app sync.
- **Background alerts never arrive:** Android battery optimization can stop background work. Set SoFit's battery usage to *Unrestricted* in Android settings. In development builds you can force a run from Settings → *Run background task now*.

## Contributing

Issues and pull requests are welcome. Run `npm run typecheck`, `npm run lint` and `npm test` before opening a PR. Score formulas live in `src/scores/`; if you change one, update or add tests alongside it.

## License

[MIT](LICENSE)
