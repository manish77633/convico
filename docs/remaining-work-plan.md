# Remaining work plan

Created 2026-10-16. This is a plan for a later implementation pass. The core app and submission are already in the repository. No item below is claimed complete by this document.

## 1. Measure and, if needed, improve the 60 FPS target

**Current state:** Streaming was observed around 45–47 tokens/second on an Android emulator. Frame rate was not measured. `App.tsx` already batches token paints and uses a virtualized `FlatList`.

1. Run the release build on a 60 Hz Android phone and record frame times while continuously scrolling during a response. Record the device, refresh rate, run duration, frame count, and janky/slow frames. Use Android frame profiling or Perfetto; repeat a short idle baseline for comparison.
2. Profile JS work and React renders during the same scenario. If frames miss the 16.7 ms budget, locate the actual hot path before changing list or stream behavior.
3. Apply only measured fixes: further isolate the active bubble and metrics overlay, tune list windowing/batching, or reduce message-array work per token. Preserve the observed 30–50 token/second stream and correct auto-scroll behavior.
4. Re-measure on the same device and document the result in the README. If 60 FPS is not reached, report the measured result and remaining cause.

**Done when:** A reproducible release-build measurement and its limits are documented; any identified frame regression is fixed or explicitly reported.

## 2. Finish native interaction verification

**Current state:** Swipe-to-reply worked on the emulator. Physical haptic feel and keyboard transitions were not checked on a phone.

1. On an Android phone, open/close the keyboard while composing, streaming, scrolling, and showing the reply bar. Confirm the composer stays visible and input remains usable without noticeable jumps. Check a smaller screen and longer draft.
2. Swipe user and assistant bubbles during streaming. Confirm reply state, haptic feedback, and no accidental swipe while vertically scrolling. Verify graceful behavior on a device without haptics.
3. If a failure is observed, adjust `App.tsx` keyboard layout or gesture thresholds and repeat only the affected checks. Record the device and outcome.

**Done when:** The physical-device behaviors above are observed and documented, or a specific limitation is reported.

## 3. Add focused automated tests (bonus)

**Current state:** TypeScript, lint, Expo Doctor, and manual Android flows passed; no Jest/Detox suite exists.

1. Add an Expo SDK 58 compatible Jest setup. Extract pure stream timing and queue decision logic from `src/stream.ts` and `src/useChat.ts` where needed, without changing behavior.
2. Test token order/rate scheduling with a fake clock; offline enqueue and restart recovery; oldest-first draining; duplicate-send protection; mid-stream disconnect; bounded auto-retry and manual retry.
3. Keep SQLite transaction integration covered by a targeted repository test if the chosen test environment supports it. Add one Android end-to-end scenario only after the unit tests are stable.
4. Document one test command and run it once with TypeScript/lint in a consolidated pass.

**Done when:** The important stream and sync state transitions have repeatable tests that would fail on an actual ordering or retry regression.

## 4. Scale cached history to 5,000+ messages (bonus)

**Current state:** `FlatList` virtualizes rendered rows, but `src/db.ts:getMessages()` loads the entire thread and `src/useChat.ts` keeps the full array in memory.

1. Add a SQLite index on `(thread_id, created_at, id)` and keyset-paginated history queries. Load only the newest page initially, then fetch older pages as the user scrolls upward. Keep the durable sync queue independent of visible pages.
2. Preserve viewport position when prepending history, stable IDs, reply references, and latest-message auto-scroll. Avoid copying all 5,000 rows on every token.
3. Seed 5,000 realistic messages in a benchmark build; measure cold initial load, memory, scroll frame times, and streaming while scrolling. Compare with the current app on the same device.
4. Add regression tests for page boundaries and ordering, then document measured results without an unsupported “zero stutter” claim.

**Done when:** Initial load uses bounded pages and the 5,000-message scenario has documented device measurements.

## 5. Optional audio waveform (bonus, last)

1. Add a clearly labeled **mock** voice preview/playback action to a message. It should start, pause, and stop a timed sample state; no microphone permission or real audio recording is needed.
2. Animate waveform bars through Reanimated shared values on the UI thread, driven by deterministic sample amplitudes and synchronized with the mock playback position. Clean up animation/timers on stop and unmount.
3. Verify controls and animation during chat streaming and offline use. Add a short demo clip and document that the waveform is simulated.

**Done when:** The waveform responds to working playback controls, stays smooth during streaming, and does not imply real voice capture.

## Later execution order

Complete items 1 and 2 first because they close verification gaps in the core brief. Then add tests, pagination, and the optional waveform in that order. After implementation, run one consolidated TypeScript/lint/test pass, a release Android check, and update the README/demo with measured outcomes.
