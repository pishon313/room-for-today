# Personal Planner

Published at https://coco-planner-20261003.web.app

The React/TypeScript/Vite app uses standard Firebase Hosting, a Seoul-region Firestore database, Google sign-in, and private Security Rules in project `coco-planner-20261003`. No billing account was added.

## Sign in on your devices

Open the published website on each Mac and iPhone and use **Sign in with Google** with the same account. If sign-in fails on a new device, check that the Google provider is enabled in [Firebase Authentication](https://console.firebase.google.com/project/coco-planner-20261003/authentication/providers) and the hosting domains are authorized under Authentication → Settings.

After signing in, create a note, wait for **Saved**, and open a second device to confirm it appears. Refresh and sign out/in to check your production account. The automated checks below use Firebase emulators, not your real Google login.

## Behavior and storage

- Firestore `/users/{uid}/items/{id}` is the source of truth. Monthly goals, weekly priorities, daily tasks, routines, Bucket List wishes, date-specific checkmarks, and memos are individual records. No sample records are seeded.
- Monthly keys are `YYYY-MM`, daily keys are `YYYY-MM-DD`, and weekly keys are the Monday date. The planner uses Asia/Seoul for today's date and date-only UTC arithmetic for navigation.
- A durable device outbox stores only pending patches, namespaced by account. Text saves are debounced 700ms; patches for one record are combined. An operation is removed only after Firestore acknowledges its write. **Saved** also requires a server-backed snapshot and no pending edits.
- Offline writes remain visible and retry on reconnect, every 15 seconds, or with **Retry**. A write without confirmation after 12 seconds shows a failure notice. Refreshing with an internet connection recovers the outbox. Closing while pending prompts a warning; sign-out is blocked while pending.
- Browser storage is a recovery buffer, not the saved planner database. Do not clear site data while changes are pending. This version needs internet to load the app. Device storage exhaustion shows an explicit copy-your-text warning. Edits that cannot be written to device storage remain in memory across queue refreshes and Retry, and are still sent to Firestore. Keep the page open until they save. Pending edits use increasing timestamps to preserve their order even within the same millisecond or after a clock adjustment.
- Concurrent edits merge at field level. Different items or fields do not replace each other. For the same field (including memo body or repeat-day selection), the last write received by Firestore wins. Reconnecting old edits can therefore become the latest edit. Text currently focused stays stable until blur. Deleted records are tombstones, so stale text edits cannot resurrect them.
- The dashboard shows today's remaining routine count and the selected week's progress. Open the Routine tab to review past weeks, mark check-ins, and edit repeat days.
- The Bucket List tab keeps wishes apart from dated plans. Add a title and optional short note, mark a wish done to record the current Asia/Seoul date, move it back to Want to do, or delete it. It does not change the dashboard. Bucket items sync individually through Firestore; completion state and date are written together.
- Settings offers System, Warm Light, Forest Dark, Sierra Blue, DeepBlck, and Gray themes. System follows each device's light/dark setting; the header button provides a quick light/dark switch. Theme choice is remembered in that browser's local storage and can be changed without signing in. Theme preference is per browser; planner content continues to sync through Firestore.
- New routines store an immutable Seoul start date: earlier dates are disabled and excluded from progress. Existing routines without a start date retain their previous history because their creation date cannot be reconstructed. Deploy the updated Firestore rules before deploying the app that writes start dates.
- Routine completion is keyed by routine ID plus date. Repeat-day changes take effect from the current Seoul date; separate dated schedule records preserve earlier weeks' expected check-ins and completion counts. A disabled weekday displays any prior checkmark but cannot be toggled until selected again. Deleting a routine hides it but retains its historical checkmarks. Repeat-day settings changed before this schedule-history feature cannot be reconstructed retroactively, though their completion records remain.
- Rules require the authenticated UID to match the path for every read/write and validate record shape. No anonymous or public database access.
- The initial version listens to the user's collection, including history and tombstones. This is appropriate for a small personal planner. Very large histories should use bounded period subscriptions to control Spark read usage.

## Development

Node 22+ recommended. `.env.local` is already configured for this project and ignored. Firebase web config is public application configuration, not an admin credential. To configure another project, copy `.env.example` and fill its four values from Firebase Project settings → Your apps.

```sh
npm ci
npm run dev
npm run build
npx firebase deploy --only hosting,firestore:rules --project coco-planner-20261003
```

Never enable `VITE_USE_EMULATORS` in a production environment. Emulator connections are additionally guarded by Vite's development flag. No service account key is included.

## Verification

The suite includes fourteen calendar/outbox/routine-schedule unit tests, six Firestore rules integration tests, and browser integration tests against local Firebase Auth/Firestore emulators. Browser checks cover refresh, sign-out/in, two sessions, different-field edits, Bucket List completion and Seoul dates, date navigation, routine schedule history, today's remaining count, offline recovery, server-rejected writes, pending text recovery after reload, retry, another account's empty planner, all Settings theme choices and persistence, system light/dark preference, quick theme toggle, and desktop/iPhone-width layout down to 320px. TypeScript, production build, unit tests, Firestore rules tests, and browser integration tests passed for this change.

The rules tests specifically attempt cross-account reads/writes/list queries and anonymous access and confirm rejection. They also reject invalid data and deleted-record resurrection.

To repeat tests, install Java 21+ and Playwright Chromium:

```sh
npx playwright install chromium
npm test
npm run test:rules
```

For browser integration tests, start the emulators in one terminal, then run tests in another:

```sh
npx firebase emulators:start --only auth,firestore --project demo-planner
npm run test:e2e
```

Playwright starts Vite with the emulator-only configuration automatically. Test data is created only in the emulator. `tests/desktop.png` and `tests/iphone.png` are emulator screenshots, not live account data. Actual Google OAuth and physical Mac/iPhone synchronization require the setup above and have not yet been verified.
