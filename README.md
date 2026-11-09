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

## Syncing between devices

When the PC and phone are on the same Wi-Fi, they sync directly. To sync from anywhere, link both to a free
[Supabase](https://supabase.com) project in Settings. Kaizen shows the SQL to create its one table. Everything is
end-to-end encrypted before it leaves your device, so Supabase only ever sees scrambled data.

## Folders

- `server/`: the PC server. `server/core/` is the shared logic, which the phone app runs too.
- `web/`: the screens, used by the PC and the phone.
- `mobile/`: the Android app (Capacitor).
- `desktop/`: the desktop window (Electron).
- `data/`: your database, photos and logs. This is created when you first run Kaizen and is never uploaded.

## License

MIT
