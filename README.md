# Kaizen

A weight-loss and fitness tracker for your PC and Android phone. It keeps your weight, food, workouts, steps and
sleep in one place, and has an AI coach that can look at all of it.

Everything is stored on your own devices. The PC and phone each keep a full copy and sync with each other, like Anki
does, so the phone works without the PC switched on.

## What it does

- **Weigh-ins and trends**: your weight over time, your goal, and the rate you're losing at.
- **Food**: log food by grams or by portions ("2 eggs", "1 slice"). Search Open Food Facts, scan a barcode with the
  phone, or use the built-in USDA food list.
- **Workouts**: time and calories from Health Connect, and sets and reps imported from a Hevy CSV export
  (or the Hevy API if you have Hevy Pro).
- **Steps, sleep and vitals** from Health Connect, which collects them from your watch, scale and other apps
  (Fitbit, Pixel Watch, Etekcity/VeSync and others).
- **Progress photos**, kept encrypted.
- **AI coach**: ask questions about your progress, and get a check-in every Sunday. It uses Claude, either through
  Claude Code signed in on the PC, or with your own Claude API key (Settings).

## Getting started

You need [Node.js](https://nodejs.org) 22.5 or newer (Kaizen uses Node's built-in SQLite).

```
cd server
npm install
npm start
```

Then open <http://localhost:5177>.

For a desktop window you can pin to the taskbar instead:

```
cd desktop
npm install
npm start
```

`npm run make-app` in `desktop` makes `desktop\app\Kaizen.exe`. On Windows, `Kaizen.vbs` opens Kaizen and starts the
server in the background if it isn't running.

## The phone app

The Android app reads Health Connect and keeps its own copy of your data.

1. Install JDK 21 and the Android SDK.
2. Run `npm install` in `mobile`, then run `build-apk.cmd`. It makes `data\kaizen.apk`.
3. Install the APK on your phone and pair it with the PC by scanning the QR code in Settings.

Screen changes reach the phone over your home Wi-Fi, so you only need to rebuild the APK after changing native code.

## Your own integrations

Everything is set up in **Settings** and saved in your own database (`data\`), which is never uploaded. Nothing
here is required: Kaizen works on its own, and each integration adds to it.

| What | What it adds | How to set it up |
|---|---|---|
| **Your details** | Calorie and protein targets | Settings: sex, birth year, height, goal weight, activity and pace. Or set calories yourself. |
| **Claude** (AI coach) | Questions about your progress, and the Sunday check-in | Either install [Claude Code](https://claude.com/claude-code) on the PC and sign in to your Claude plan, or paste a Claude API key from [console.anthropic.com](https://console.anthropic.com) into Settings. The phone uses the PC's coach when they're on the same Wi-Fi. |
| **Health Connect** | Steps, sleep, heart rate, workouts and weigh-ins from your watch, scale and other apps | Install the phone app, then allow Health Connect in Settings on the phone. Apps like Fitbit, Pixel Watch, Samsung Health and VeSync (Etekcity scales) need their own Health Connect sharing turned on. |
| **Your PC and phone** | The same data on both | On the phone: Settings > Link with your PC, then scan the QR code shown in the PC's Settings (or paste the code). |
| **Supabase** (optional) | Syncing when the phone isn't on your home Wi-Fi | Make a free project at [supabase.com](https://supabase.com), run the SQL Kaizen shows in Settings, then paste the Project URL and publishable key. Everything is encrypted on your device first, so Supabase only sees scrambled data. |
| **Hevy** | Sets and reps from your workouts | Free Hevy: export a CSV from the Hevy app and use Train > Import from Hevy. Hevy Pro: paste your API key from hevy.com > Settings > Developer, and workouts come in by themselves. |
| **Food** | Food search and barcodes | Built in, using Open Food Facts and a USDA food list. No account needed. |

## Folders

- `server/`: the PC server. `server/core/` is the shared logic, which the phone app runs too.
- `web/`: the screens, used by the PC and the phone.
- `mobile/`: the Android app (Capacitor).
- `desktop/`: the desktop window (Electron).
- `data/`: your database, photos and logs. This is created when you first run Kaizen and is never uploaded.

## License

MIT
