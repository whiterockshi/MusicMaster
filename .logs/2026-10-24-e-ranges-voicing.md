# E-based ranges and split chord voicing — 2026-10-24

User confirmed Eb upper bounds and the CM7 example takes priority over keeping upper voices inside the named Low-guitar band.

New Lv1/2 pitch ranges are Bass E1–Eb2 (MIDI28–39), Low guitar E2–Eb3 (40–51), High guitar E3–Eb4 (52–63). A4 remains MIDI69=440Hz. Pitch classes map to the appropriate octave inside the E-start band, and displayed octaves derive from actual MIDI pitches.

New Lv3 uses a bass-band root and adds an octave to its third/fifth/seventh offsets. CM7 is MIDI36/52/55/59 = C2/E3/G3/B3. Arpeggio, simultaneous chord and correction replay share questionPitches. Lv3 ignores the global single-note range selection, saves under bass, and analysis/graph default to bass when Lv3 is selected; historical other ranges remain selectable.

Added optional layout version to questions/sessions/attempts/reviews. New questions use 2; absent metadata means legacy C-start layout 1. Review identity includes layout so old mistakes retain their original pitch and voicing and cannot be cleared by a new-layout answer. Old review items are visibly marked. Lifetime stats transparently include historical layouts; users can reset the recent baseline. CSV includes pitch_layout. Fixed legacy range migration to avoid inventing an orphan high-range duplicate when all recorded errors were bass-only.

Validation: unit suite 31 passed; TypeScript/production build passed; Chromium E2E suite 12 passed. Verified all 12 MIDI pitches per range, all 48 chord voicings, old-layout persistence/identity, legacy bass-only migration, and actual browser CM7 oscillator frequencies 65.406/164.814/195.998/246.942Hz in both arpeggiated and simultaneous output. Inspected mobile settings and Lv3 answer screenshots. A test-editing mix-up was caught during suite discovery; restored the unit file and AGENTS from their baseline, reapplied focused additions and verified the final diffs and passing suite. No iPhone acoustic verification performed.
