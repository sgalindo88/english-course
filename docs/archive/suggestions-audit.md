# FluentPath — Suggestions Audit

**Based on:** [suggestions.md](suggestions.md) (45 improvement suggestions)
**Audited against:** Implementation Phases 1–4 + post-phase quick wins (11 April 2026)
**Result:** 36 implemented, 3 low-effort remaining, 6 deferred

---

## Fully Implemented (36/45)

| # | Suggestion | Implemented In |
|---|-----------|---------------|
| 1.1 | Extract JS/CSS from HTML | Phase 1 (Steps 1.3, 1.4) |
| 1.2 | Consolidate shared CSS | Phase 1 (Step 1.4 — theme.css + per-page CSS) |
| 1.4 | escHtml inline duplicates | Phase 1 (Step 1.6 — removed from teacher-portal.js) |
| 1.6 | Remove legacy file | Phase 1 (Step 1.7 — moved to legacy/) |
| 2.2 | Add ESLint/Prettier | Phase 1 (Step 1.5) |
| 2.4 | Repeated date formatting | Phase 1 (Step 1.6 — consolidated in utils.js) |
| 2.5 | Magic numbers | Phase 1 (Step 1.6 — FP.COURSE_DAYS, FP.TEST_TOTAL_MARKS, FP.LESSON_DURATION_MIN) |
| 3.1 | Authentication | Phase 1 (Step 1.1 — APP_SECRET + TEACHER_SECRET); tokens embedded in config.js for production |
| 3.3 | XSS in innerHTML | Phase 1 (Step 1.2 — escHtml with single-quote escaping) |
| 3.4 | postForm truncates at 2,000 chars | Post-phase (v0.43.0 — default limit raised from 2,000 to 10,000 characters) |
| 4.2 | Sheets reads scan all rows | Phase 2 (Step 2.1 — CacheService + TextFinder) |
| 4.3 | Dashboard loads all data on init | Phase 2 (Step 2.2 — lazy-loaded panels) |
| 4.4 | lesson_json read unnecessarily | Phase 2 (Step 2.1 — column index optimisation in getLibraryEntries) |
| 4.5 | No lazy loading for sidebar panels | Phase 2 (Step 2.2 — panelLoaded tracker) |
| 5.1 | No keyboard navigation | Phase 3 (Step 3.4 — tabindex, role, aria-label, Enter/Space handlers) |
| 5.2 | Colour alone conveys MCQ feedback | Phase 3 (Step 3.4 — ::after "Correct"/"Incorrect" text labels) |
| 5.3 | No error states for network failures | Phase 2 (Step 2.7 — offline banner on hub with Retry) |
| 5.4 | Timer has no pause | Phase 3 (Step 3.5 — pause overlay + auto-pause on tab switch) |
| 5.6 | Student progress not visible during lessons | Post-phase (v0.43.0 — nav badge shows "Day X / 20" during lessons) |
| 5.7 | No beforeunload warning | Phase 2 (Step 2.7 — lessonInProgress/testInProgress flags) |
| 5.8 | Grading requires too many clicks | Phase 3 (Step 3.6 — Next Ungraded button + Ctrl+S / Ctrl+→ shortcuts) |
| 6.1 | No input validation | Phase 2 (Step 2.4 — requireParam, validateScore, validateDate) |
| 6.3 | doGet/doPost if-else chain | Phase 2 (Step 2.3 — GET_HANDLERS + POST_HANDLERS dispatch tables) |
| 6.4 | No error logging | Phase 2 (Step 2.5 — Error Log sheet tab + get_errors endpoint) |
| 7.2 | localStorage has no expiry or cleanup | Post-phase (v0.43.0 — cleanupLocalStorage() purges entries >30 days on every page load; warns at 4MB) |
| 7.3 | No data export/backup | Phase 3 (Step 3.3 — JSON/CSV download + dailyBackup function) |
| 8.1 | No multi-student overview | Phase 3 (Step 3.1 — class overview panel with sortable table) |
| 8.2 | No notification system | Phase 3 (Step 3.2 — email notifications for test/lesson/grading) |
| 8.4 | No spaced repetition | Phase 3 (Step 3.7 — Vocabulary Tracker sheet + 1/3/7/14-day SRS) |
| 8.5 | No gamification | Phase 4 (Step 4.5 — 6 achievement badges with unlock toasts) |
| 8.6 | No multi-course support | Phase 4 (Step 4.7 — course_id + promote_student + hub Course N label) |
| 9.1 | No automated tests | Phase 2 (Step 2.6 — 45 vitest tests across utils + apps-script) |
| 9.3 | Checkpoint recovery edge cases | Post-phase (v0.43.0 — double-buffer writes to _a/_b slots + version field + legacy migration) |
| 10.1 | No CI/CD pipeline | Phase 4 (Step 4.2 — GitHub Actions: lint + test on push/PR) |
| 10.2 | Apps Script deployment manual | Phase 4 (Step 4.3 — clasp push/deploy with npm scripts) |
| 10.3 | No staging environment | Phase 4 (Step 4.6 — FP.ENV auto-detect + DEV banner + dev webhook) |
| 10.4 | No health monitoring | Phase 4 (Step 4.4 — unauthenticated health endpoint) |

---

## Not Implemented — Low Effort, Worth Doing (3)

| # | Suggestion | Effort | Impact | Notes |
|---|-----------|--------|--------|-------|
| **2.1** | Standardise var/const/let | Low | Code quality | Run `npm run lint:fix` + manual pass to convert remaining `var` to `const`/`let`; shared scripts (`config.js`, `api.js`) still use `var` for ES5 compatibility |
| **2.6** | Console warnings swallowed silently | Low | Reliability | Add lightweight error counter; show "Some data may not have saved" warning after multiple catch blocks fire silently |
| **5.5** | Dark mode / high-contrast | Medium | Accessibility | Add `prefers-color-scheme: dark` media query with CSS variable overrides; add toggle switch in student hub |

---

## Not Implemented — Medium/High Effort, Future Consideration (6)

| # | Suggestion | Effort | Notes |
|---|-----------|--------|-------|
| **1.3** | Shared MCQ component (renderMCQ, renderRecorder) | Medium | Would reduce ~200 lines of duplication across student-test.js, student-lesson.js, and examiner-panel.js; requires refactoring render functions to use a common API |
| **1.5** | Global state objects without structure | Medium | A `createState(defaults)` pattern with key validation; risky refactor for code that currently works |
| **2.3** | Replace string concatenation with h() helper or tagged templates | Medium | Would catch structural HTML errors and improve readability; large refactor touching every render function |
| **4.1** | Asset bundling / minification | Medium | esbuild for JS concat + minify + content hash filenames; not urgent at current file sizes (~13KB total JS) |
| **6.2** | Rate limiting on API endpoints | Medium | Use CacheService to track requests per student per hour; reject excessive requests; protects against quota exhaustion |
| **9.4** | Graceful degradation for Google Sheets downtime | Medium | Service worker caches app shell but API calls pass through to network (SW skips Apps Script requests due to 302 redirect incompatibility); full solution would need client-side read queue |

---

## Not Applicable / Deferred (5+)

| # | Suggestion | Reason |
|---|-----------|--------|
| **6.5** | Claude API caching at server level | Already handled by lesson library recycling system + LockService preventing concurrent generation |
| **6.6** | Hardcoded teacher name | Still hardcoded (`ex.teacherName = 'Sebastian Galindo'`); would require a login system or teacher registration to fix properly |
| **7.1** | Google Sheets scaling limits | Not a concern for the current cohort size (<50 students); archive strategy documented but not needed yet |
| **7.4** | no-cors POST prevents error detection | Partially mitigated by save verification (read-back after write); full fix requires switching to CORS-enabled POST or a proxy |
| **8.3** | Student-to-student progress comparison | Nice-to-have with privacy considerations; anonymised class stats could be added to the hub |
| **8.7** | Printable/exportable lesson content | Nice-to-have; would use `@media print` CSS and a "Print this lesson" button |
| **8.8** | Web Speech API browser support gaps | Already shows a browser warning + text-input fallback recommendation; Whisper API integration would be a larger effort |
| **8.9** | RTL language support | Not needed for current Spanish-only i18n; noted for future Arabic/Farsi expansion |
| **9.2** | Client-side error monitoring (Sentry/LogRocket) | Error Log sheet covers server-side; client-side would need `window.onerror` + `onunhandledrejection` handlers posting to an error endpoint |
| **10.5** | DDEV configuration unused | Kept — the user actively uses DDEV for local development |

---

## Bug Fixes Applied During Implementation

| Issue | Root Cause | Fix |
|-------|-----------|-----|
| Class overview showed "No students registered yet" | `sheetToObjects` reads actual sheet headers which may differ from HEADERS constant (`Student Name` vs `student_name`) | `handleGetClassOverview` now tries both header variants for all columns |
| Switching students kept old student's data | `loadFromLocalStorage` restored full state, conditional reset was skipped when names matched after save + reload | Added `resetStudentState()` that always clears all student data unconditionally on URL param load |
| Lesson generation failed with "studentName is not defined" | `buildLessonPrompt` didn't accept `studentName` parameter but SRS code used it for `getReviewWords()` | Added `studentName` as 6th parameter to `buildLessonPrompt` |
| Service worker cached error responses for API calls | Apps Script returns HTTP 200 for error JSON; SW cached these and served them as stale responses | SW now skips all Apps Script requests entirely (pass through to network) |
| Service worker 404 on app shell pre-cache | Absolute paths (`/index.html`) don't work on GitHub Pages subdirectory (`/fluentpath/`) | Changed to relative paths (`./index.html`); HTML uses network-first strategy |
| config.local.js 404 in production console | Static `<script>` tag requested gitignored file on GitHub Pages | Removed static tags; config.js dynamically loads config.local.js only in development mode |
| Teacher portal and hub didn't load data in production | Auth tokens were empty (config.local.js absent); API returned Unauthorized | Embedded production tokens directly in config.js |
