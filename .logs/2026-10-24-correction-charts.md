# Correct-answer replay, analysis charts and history display — 2026-10-24

Workflow: after a wrong valid answer, preserve the scored attempt once, finish the feedback effect, announce the correct solfege with a local Japanese voice when available, wait two seconds, and replay the original pitch/range. Next remains disabled through replay; manual replay is available. Unanswered is separate and does not trigger this correction. Cancellation invalidates pending playback and returns to feedback instead of permitting duplicate scoring.

Analysis: two category bar charts (since-reset and lifetime) replace individual note cards; selected level/range and reset boundaries are retained. Each chart shows 0–100%, all 12 pitch names, count and explicit missing-data marks. Mobile charts can scroll horizontally.

Calendar: newest five normal sessions per day only; counts, stored history and daily graph retain all sessions. Support shows session count and total JSON-equivalent size, clearly distinct from actual IndexedDB disk usage.

Capacity measurement: representative full 20-answer session serialized to 4,180 UTF-8 bytes. Approximately 4–5KB/session, 4–5MB per 1,000, excluding shared records and browser storage overhead. No recorded audio is stored. Documented existing 10,000-session validation and 10MiB import limits and future archive/performance work; no automatic deletion added.

Validation: unit suite 15 passed; TypeScript/production build passed; final Chromium E2E suite 8 passed. Verified correct-pitch replay and next-button gating, graph/reset behavior, latest-five ordering with all seven fixture sessions retained, and existing gameplay/storage/range regressions. Mobile chart screenshot visually inspected. An intermediate setting-persistence test reloaded before IndexedDB finished saving; updated persistence checks to wait for the existing saved indicator before reload and reran successfully. Device-local Japanese voice/hardware acoustics are not verified on iPhone.
