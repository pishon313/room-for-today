# Personal Planner

Published at https://coco-planner-20261003.web.app

The React/TypeScript/Vite app uses standard Firebase Hosting, a Seoul-region Firestore database, Google sign-in, and private Security Rules in project `coco-planner-20261003`. No billing account was added.

## Sign in on your devices

Open the published website on each Mac and iPhone and use **Sign in with Google** with the same account. If sign-in fails on a new device, check that the Google provider is enabled in [Firebase Authentication](https://console.firebase.google.com/project/coco-planner-20261003/authentication/providers) and the hosting domains are authorized under Authentication → Settings.

After signing in, create a note, wait for **Saved**, and open a second device to confirm it appears. Refresh and sign out/in to check your production account. The automated checks below use Firebase emulators, not your real Google login.

## Behavior and storage

- Firestore `/users/{uid}/items/{id}` is the source of truth. Monthly goals, weekly priorities, daily tasks, routines, Bucket List wishes, date-specific checkmarks, and memos are individual records. No sample records are seeded.
- Monthly keys are `YYYY-MM`, daily keys are `YYYY-MM-DD`, and weekly keys are the Monday date. The planner uses Asia/Seoul for today's date and date-only UTC arithmetic for navigation.
- A durable device outbox stores pending patches, namespaced by account. Text saves are debounced 700ms. Each new patch has a stable UUID and protocol version; retries keep that same identity. Firestore transactions check `/users/{uid}/appliedOps/{opId}` before applying each patch and atomically write the item and immutable operation marker. A retry of an already-applied operation only clears its local copy, even if another device has since edited the item. Patches are **not** combined for upload; same-item order is preserved. **Saved** requires a server-backed snapshot and no unresolved edits.
- Saving runs per item, one operation at a time: a rejected edit stays pending and blocks later edits to that item while unrelated records continue syncing. Persistent Firestore rejections wait for a change to that item or an explicit **Retry**; temporary errors retry on reconnect and every 15 seconds. If confirmation takes more than 12 seconds, open the header save status to see the pending warning. Refreshing with an internet connection recovers durable edits. Closing while pending prompts a warning; sign-out opens recovery and remains blocked until edits save or are deliberately discarded.
- The header save status opens a recovery dialog without moving or covering the planner by itself. It identifies each pending item, shows its unsaved fields for viewing or copying, and offers item-specific **Retry** and **Discard pending changes** controls. Technical error details are collapsed separately. Discard requires confirmation and removes only that item's pending patches; its saved cloud record and other items stay intact. Copy any wanted unsaved text before discarding. The dialog can also be opened while saving is healthy to inspect the status.
- Browser storage is a recovery buffer, not the saved planner database. Do not clear site data while changes are pending. This version needs internet to load the app. Device storage exhaustion shows an explicit copy-your-text warning. Edits that cannot be written to device storage remain in memory across queue refreshes and Retry, and are still sent to Firestore. Keep the page open until they save. Pending edits use increasing timestamps to preserve their order even within the same millisecond or after a clock adjustment.
- If browser storage cannot remove a queue entry after the server confirms it, the app reports a device-cleanup problem separately. Retry cleanup after storage access returns. After reload, the immutable server marker makes that same operation a no-op, so it cannot overwrite a newer cloud edit. The pending copy still prevents **Saved** and sign-out until cleanup succeeds or you deliberately discard it. An unreadable device entry is shown as raw text for copying and can be discarded individually with confirmation. If all browser storage access is blocked, restore access before signing out.
- **Upgrade from the earlier outbox format:** existing queued entries without protocol metadata cannot be proven unapplied. They stay visible and do not upload automatically. Open save recovery to compare current cloud content with pending content, copy either version, then explicitly **Apply as new edit** (which can replace newer cloud fields) or confirm **Discard pending changes**. Later edits to that same item wait behind the older entry; other items continue syncing. The app persists the new protocol tag before applying an older durable entry, and keeps it quarantined if device storage refuses that step. Existing cloud item records need no migration.
- Concurrent edits merge at field level. Different items or fields do not replace each other. For genuinely different operations on the same field (including memo body or repeat-day selection), the last write received by Firestore wins. An already-applied operation never writes again, but a genuinely new edit can deliberately restore earlier text. Text currently focused stays stable until blur. Deleted records are tombstones, so stale text edits cannot resurrect them.
- The dashboard shows today's remaining routine count and the selected week's progress. Open the Routine tab to review past weeks, mark check-ins, and edit repeat days.
- The Bucket List tab keeps wishes apart from dated plans. Add a title and optional short note, mark a wish done to record the current Asia/Seoul date, move it back to Want to do, or delete it. It does not change the dashboard. Bucket items sync individually through Firestore; completion state and date are written together.
- Settings offers System, Warm Light, Forest Dark, Sierra Blue, DeepBlck, and Gray themes. System follows each device's light/dark setting; the header button provides a quick light/dark switch. Theme choice is remembered in that browser's local storage and can be changed without signing in. Theme preference is per browser; planner content continues to sync through Firestore.
- New routines store an immutable Seoul start date: earlier dates are disabled and excluded from progress. Existing routines without a start date retain their previous history because their creation date cannot be reconstructed. Deploy the updated Firestore rules before deploying the app that writes start dates.
- Routine completion is keyed by routine ID plus date. Repeat-day changes take effect from the current Seoul date; separate dated schedule records preserve earlier weeks' expected check-ins and completion counts. A disabled weekday displays any prior checkmark but cannot be toggled until selected again. Deleting a routine hides it but retains its historical checkmarks. Repeat-day settings changed before this schedule-history feature cannot be reconstructed retroactively, though their completion records remain.
- Rules require the authenticated UID to match the path for every read/write and validate record shape. Item writes and operation-marker creation must appear together in one atomic commit; markers cannot be changed or deleted. No anonymous or public database access. Each queued edit adds one small permanent marker document plus a marker read/write and an item write. Typing can queue an edit per keystroke, so long writing sessions can consume Spark reads/writes and storage faster than the earlier combined-patch uploader. Markers must be retained as long as an old pending copy could reappear; this version does not prune them. Future optimization can compact edits only before any upload attempt is possible, or replace the protocol with one that has safe bounded retention.
- The initial version listens to the user's collection, including history and tombstones. This is appropriate for a small personal planner. Very large histories should use bounded period subscriptions to control Spark read usage.

## Development

Node 22+ recommended. `.env.local` is already configured for this project and ignored. Firebase web config is public application configuration, not an admin credential. To configure another project, copy `.env.example` and fill its four values from Firebase Project settings → Your apps.

```sh
npm ci
npm run dev
npm run build
```

When ready for a separate production release, deploy rules first and Hosting second:

```sh
npx firebase deploy --only firestore:rules --project coco-planner-20261003
npx firebase deploy --only hosting --project coco-planner-20261003
```

Never enable `VITE_USE_EMULATORS` in a production environment. Emulator connections are additionally guarded by Vite's development flag. No service account key is included.

## Verification

The suite includes calendar/outbox/routine-schedule unit tests, Firestore rules integration tests, and browser integration tests against local Firebase Auth/Firestore emulators. Browser checks cover refresh, sign-out/in, two sessions, different-field edits, Bucket List completion and Seoul dates, date navigation, routine schedule history, today's remaining count, offline recovery, server-rejected writes, pending text recovery after reload, retry and confirmed or cancelled discard through the UI, another account's empty planner, all Settings theme choices and persistence, system light/dark preference, quick theme toggle, and desktop/iPhone-width layout down to 320px. Replay checks cover cleanup failure and reload after another device's edit, a committed write whose client confirmation is lost, mixing an applied operation with a new patch, two tabs sharing a pending operation, a deliberate new edit restoring earlier text, and explicit review of older untagged entries. The save-error checks also include selective discard, storage-quota recovery, unreadable-queue isolation, device-cleanup failure, and clickable navigation while an error remains pending.

The rules tests specifically attempt cross-account reads/writes/list queries and anonymous access and confirm rejection. They also reject invalid data, unpaired writes, marker mutation, and deleted-record resurrection.

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
