# Convico AI chat challenge

A standalone Expo/React Native TypeScript chat app with a local mock AI stream and durable offline queue. No API key or backend is required.

## Run

Requires Node 22, npm, and an Android emulator/device. On Windows, clone to a short path such as `E:\c`: Ninja's generated C++ object names can exceed the 260-character path limit when this project sits under a long directory name. The included Expo config plugin puts CMake staging at the project root to shorten release build paths. From the project directory:

```sh
npm ci
npm run android
```

For an APK with the JavaScript bundle included, use `npx expo run:android --variant release`. The debug build needs a live Metro server and cannot start from scratch while the emulator is fully offline. iOS requires macOS/Xcode. The app uses Expo SDK 58, `expo-sqlite`, NetInfo, Gesture Handler 3, Reanimated 4, Worklets, Expo Haptics, and Safe Area Context. These were installed with `expo install` to match the SDK. SQLite is included in native Expo runtimes; a browser build is not the target.

## Architecture

- `src/db.ts`: SQLite schema, message repository, transaction guarded insertion and delivery, ordered queue.
- `src/stream.ts`: deterministic local acknowledgement and token generator. The acknowledgement returns the stable user message ID as its idempotency key; it **does not contact a remote server**.
- `src/useChat.ts`: React hook coordinating connectivity, optimistic state, queue draining, bounded response retries, errors, and cleanup.
- `App.tsx`: virtualized chat list, composer, performance overlay, gestures, haptics, and UI thread pulse.

User messages are inserted into `messages` and `sync_queue` in one exclusive SQLite transaction. App writes are serialized. NetInfo connectivity triggers oldest-first queue draining. Only one worker runs at a time. Acknowledgement and queue removal happen together with status change to `delivered`. On network loss, an in-flight operation aborts. A pending message retains its stable ID and stays queued. Failed assistant responses are persisted and retried at most twice automatically during an online worker pass; tapping Retry allows another manual attempt. A restart turns interrupted `syncing` rows back to `pending` and interrupted `streaming` rows to `failed`.

The mock schedules one whitespace-delimited token every 22 ms against an absolute clock, targeting about 45 tokens/second with room for emulator timer overhead. React state is painted at most about every 60 ms; individual bubbles are memoized, and FlatList renders a window of history. The active pulse uses Reanimated shared values on the UI thread. TTFT is wall-clock time from the user message creation (or retry request) to the first token; for offline messages it includes queue wait. Token rate is `(tokens - 1) / seconds since first token`, sampled at each UI paint. “Chat renders” counts renders of the chat screen component since mount, not frames per second. JavaScript timer scheduling may change the actual token rate. A 60 FPS target must be measured on the target device; this number is not an FPS claim.

## Verification

```sh
npx tsc --noEmit
npx expo-doctor
npm run android
npx expo run:android --variant release
```

Manual demo: send a prompt and watch streaming/metrics; switch Android to airplane mode, send two messages, then reconnect and observe ordered Pending → Syncing → Delivered states; swipe a bubble right to quote it and feel haptic feedback; interrupt connectivity during streaming and observe failure/retry. Restart while offline to confirm queued messages persist.

On the Android API 37 emulator, the release APK launched with its bundled JavaScript while offline. Manual checks covered streaming, two queued messages persisting through a restart, oldest-first reconnect delivery, swipe-to-reply, and retry after a connection drop. The visible token-rate overlay read about 45–47 tokens/second during the recorded runs. This is an observed emulator result, not a guaranteed rate on other devices. Haptic feel and 60 FPS were not measured on physical hardware.

![Empty chat screen](docs/empty-final.png)

[Watch the two-minute emulator demo](docs/convico-demo.mp4).

## Submission and limits

The demo video is included in `docs/convico-demo.mp4`. The public GitHub repository remains dependent on a connected GitHub account or push-enabled repository destination; local conventional commits are present. The 5,000-message performance goal is a bonus and has not been benchmarked. The mock acknowledgement is local only, so cross-device delivery is outside this demo.
