# Settings and analysis reset — 2026-10-24

Implemented Support > Settings with persistent sharp/flat switch and range radios: Hi guitar C4–B4, Low guitar C3–B3, Bass C2–B2. Pitch-class scoring stays unchanged. Display spelling applies to answers, results, review/history and analysis. Sessions retain the selected range; review uses current selected range and remains keyed by pitch class. Audio remains a sine wave, not a sampled instrument.

Analysis displays lifetime and since-reset rates side by side. Confirmation is required; only the since-reset baseline changes. Per-session attempt counts mark the boundary, preserving history and handling later answers in existing sessions without relying on timestamps. Settings and baseline fields are optional in schema v1 for legacy compatibility, and are included in JSON export. CSV includes session range; legacy sessions default to high.

Validation: npm test (12 passed), npm run build (passed), Playwright with system Chromium (6 passed). Covered old/new JSON validation, invalid settings/reset rejection, reset boundaries, octave frequency ratios, flat/bass setting persistence and actual oscillator frequency, reset cancellation/confirmation and lifetime preservation, and prior regression workflows. Settings/mobile analysis screenshots visually inspected. iPhone hardware listening remains untested.
