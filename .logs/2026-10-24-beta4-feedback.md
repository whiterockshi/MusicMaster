# Beta 4 feedback — 2026-10-24

- Lv1: all 12 pitches in every 20-question set, each occurring once or twice, shuffled.
- Analysis: per-level controls; Lv1 statistics and Beta 5 placeholders for Lv2/3.
- Calendar: exclude reviews from entries, activity markers and counts; retain stored history.
- Preserve green design and existing IndexedDB format.
- Document manual backup/recovery purpose.

Validation completed before environment interruption: npm test (9 passed), npm run build (passed), system Chromium Playwright suite (4 passed). Tests covered pitch coverage, per-level controls, normal-only calendar entries/counts, and existing gameplay, persistence, backup and review workflows. No implementation changes since those successful checks. Environment restored with all seven changed files intact; git diff --check passed before commit. No iPhone hardware validation performed.
