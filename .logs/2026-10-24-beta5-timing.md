# Beta 5 cold-start speech and shorter sessions — 2026-10-24

Fixed cold-start speech readiness: wait up to two seconds for voiceschanged and prime speech before starting. Only local Japanese voices are allowed. Missing local Japanese voice is now reported visibly instead of silently dropping announcements. Cancellation prevents a delayed announcement after pause.

Lv2 now has ten distinct ordered different-pitch pairs per session and a ten-second answer window. Any missing Lv2 answer position triggers correct-answer announcement/wait/replay without changing partial score, unanswered classification or review registration rules. Lv3 now has five questions. Each question remains worth at most five, so new maxima are 100/50/25; daily charts normalize to 100. Old twenty-question Lv2/3 history remains valid.

G4 investigation: formula yields 391.99543598174927Hz (A4=440), G#4/Ab4 yields 415.3046975799451Hz. Added both exact-formula and real-browser oscillator assertions; no pitch mapping discrepancy found, so tuning was not changed. Hardware/acoustic perception remains unverified.

Validation: unit suite 27 passed (including delayed voice readiness, missing voice timeout, cancellation, pitch values and legacy session lengths); TypeScript/production build passed; full Chromium suite 12 passed. Additional targeted rerun passed two E2E cases with the newly added G4/Ab4 oscillator and nonidentical-pair assertions. Lv2 completion is 42/50 with 84-point normalized graph, Lv3 is 25/25. Timeout partial answer and correction replay are covered. Initial missing prepareSpeech import was caught by build, fixed, and the incomplete browser run stopped before fresh complete validation.

No microphone, external speech service, deployment, or iPhone hardware validation introduced. Updated PLAN, README and AGENTS.
