2# FluentPath — Detailed Improvement Suggestions

**Reviewed:** 11 April 2026
**Codebase version:** 38 commits, ~13,900 lines

---

## Table of Contents

1. [Code Architecture & Structure](#1-code-architecture--structure)
2. [Code Quality & Cleanup](#2-code-quality--cleanup)
3. [Security](#3-security)
4. [Performance](#4-performance)
5. [UX & Accessibility](#5-ux--accessibility)
6. [Backend (Apps Script)](#6-backend-apps-script)
7. [Data & Storage](#7-data--storage)
8. [Feature Gaps](#8-feature-gaps)
9. [Testing & Reliability](#9-testing--reliability)
10. [DevOps & Deployment](#10-devops--deployment)

---

## 1. Code Architecture & Structure

### 1.1 Monolithic HTML files with inline CSS and JS

**Problem:** Each HTML file contains all its CSS and JavaScript inline. `examiner-panel.html` is 3,128 lines, `student-course.html` is 2,145 lines, and `student-initial-test.html` is 2,066 lines. This makes files extremely hard to navigate, debug, and maintain. Changes to shared patterns (e.g., button styles, MCQ rendering) must be manually replicated across files.

**Suggestion:** Extract JavaScript into separate `.js` files per page (`examiner-panel.js`, `student-course.js`, `student-initial-test.js`). Extract page-specific CSS into corresponding `.css` files. This will enable IDE features (jump to definition, linting, minification) and make diffs cleaner.

### 1.2 Duplicated CSS reset and base styles

**Problem:** Every HTML file re-declares `* { margin:0; padding:0; box-sizing:border-box; }`, body font settings, `@keyframes fadeIn`, `@keyframes spin`, button base styles, card patterns, progress bars, and other fundamentals. The `theme.css` file only contains CSS variables and font imports (23 lines) — it should carry these shared rules.

**Suggestion:** Move the CSS reset, body typography, animation keyframes, and all shared component styles (buttons, cards, badges, progress bars, form inputs) into `theme.css` or a new `base.css`. Each page should only contain truly unique styles.

### 1.3 No shared component rendering for MCQs, recorders, audio players

**Problem:** MCQ rendering logic (question display, option chips, correct/incorrect highlighting, colour-coded feedback) is written independently in `student-initial-test.html`, `student-course.html`, and `examiner-panel.html`. The speaking recorder UI and audio player box are similarly duplicated. Any bugfix or style change must be applied in three places.

**Suggestion:** Create a `components.js` module with functions like `renderMCQ(question, options, correct, onSelect)`, `renderRecorder(drillId, onTranscript)`, and `renderAudioPlayer(text, maxPlays)`. All three pages import and call these functions.

### 1.4 `escHtml()` lives in `utils.js` but is also defined inline

**Problem:** `utils.js` exports `escHtml()` as a global function, but examining the HTML files shows inline `escHtml` is used in `examiner-marking.html` (legacy), and some places still do `innerHTML = '...' + variable` without escaping. The utility module is too thin (9 lines, one function).

**Suggestion:** Audit all `innerHTML` assignments for missing `escHtml()` calls. Expand `utils.js` to include other repeated helpers: date formatting (`formatDate`, `formatLessonDate`), time-ago display, and name sanitisation — all of which are currently re-implemented in each file.

### 1.5 Global state objects without structure

**Problem:** The teacher dashboard stores all state in a single `ex` object (`ex.studentName`, `ex.day`, `ex.marks`, `ex.ptGraded`, etc.) with no defined shape. The student course page uses loose global variables (`studentName`, `lessonDate`, `currentStep`, `lessonData`, `answers`, etc.). This makes it easy to introduce typos that silently fail.

**Suggestion:** Define state shapes as documented objects at the top of each file with default values. Consider using a simple state manager pattern: a `createState(defaults)` function that validates keys on set and triggers save-to-localStorage automatically.

### 1.6 Legacy file `examiner-marking.html` still in repo

**Problem:** `examiner-marking.html` (1,121 lines) is documented as "superseded by the dashboard" and "kept for backwards compatibility." It uses the old Formspree email-parsing workflow and duplicates grading logic. It adds maintenance burden and could confuse new contributors.

**Suggestion:** Move to a `/legacy/` folder or remove entirely with a git tag for reference. If any teacher still uses it, provide a redirect banner pointing to the dashboard.

---

## 2. Code Quality & Cleanup

### 2.1 Mixed `var` / `const` / `let` declarations

**Problem:** `config.js` and `api.js` use `var` exclusively (ES5 style), while `i18n.js`, `checkpoint.js`, `video-call.js`, and inline scripts mix `const`/`let` freely. This inconsistency suggests no coding standard is enforced. `var` has function scoping which can cause subtle bugs in loops.

**Suggestion:** Standardise on `const`/`let` throughout. Since the app runs on modern browsers (it requires `speechRecognition`, `AbortController`, `CSS custom properties`), there's no reason to stay on ES5. Run a pass to convert all `var` declarations.

### 2.2 No linting or formatting tools

**Problem:** There is no `.eslintrc`, `.prettierrc`, or any code formatting configuration. Code style varies significantly between files: some use 2-space indent, others use mixed indentation; string quotes alternate between single and double; semicolons are inconsistent.

**Suggestion:** Add ESLint with a minimal config (e.g., `eslint:recommended`) and Prettier. Add a pre-commit hook (via `husky` + `lint-staged` or a simple git hook) to enforce formatting. This prevents style drift and catches common errors.

### 2.3 Inline HTML construction via string concatenation

**Problem:** Throughout the codebase, complex HTML is built via string concatenation:
```javascript
html += '<div style="display:flex;justify-content:space-between;...">' +
  '<div><strong>Day ' + escHtml(...) + '</strong>' + ...
```
This pattern (seen extensively in `index.html:446-477`, `examiner-panel.html` throughout) is error-prone (missing closing tags, injection risks from missed escaping), hard to read, and impossible for IDEs to validate.

**Suggestion:** Create a small `h()` helper that generates DOM elements programmatically:
```javascript
function h(tag, attrs, ...children) { /* returns HTMLElement */ }
```
Or use template literals with a tagged template that auto-escapes interpolations. Either approach catches structural errors at creation time instead of producing broken HTML.

### 2.4 Repeated date formatting functions

**Problem:** Date formatting logic is re-implemented in at least 4 places:
- `index.html`: `formatDate()` and `formatLessonDate()` (lines 427-436, 550-554)
- `student-course.html`: inline date formatting
- `examiner-panel.html`: multiple date format calls
- `checkpoint.js`: `timeAgo()` function

**Suggestion:** Consolidate into `utils.js`: `formatDate(str, style)` with options for 'short' (`10 Apr`), 'long' (`10 April 2026`), 'iso' (`2026-04-10`), and `timeAgo(timestamp)`.

### 2.5 Magic numbers and strings

**Problem:** The number `20` (total course days) appears as a hard-coded literal in 15+ places across the frontend and backend. Similarly, `80` (total test marks), `90` (lesson duration in minutes), and CEFR threshold scores are embedded directly in code. If any of these change, a global search-and-replace is needed.

**Suggestion:** Add to `config.js`:
```javascript
FP.COURSE_DAYS = 20;
FP.TEST_TOTAL_MARKS = 80;
FP.LESSON_DURATION_MIN = 90;
FP.CEFR_THRESHOLDS = { A1: [0, 15], A2: [16, 30], ... };
```

### 2.6 Console warnings swallowed silently

**Problem:** Many `catch` blocks are empty or only use `console.warn`:
```javascript
} catch (e) { /* quota exceeded or unavailable */ }
```
(checkpoint.js:28, api.js error paths, apps-script.js library operations)

While this is acceptable for non-critical operations, there's no way for the teacher to know when things are silently failing (e.g., checkpoint save failing due to quota, library write failing).

**Suggestion:** Add a lightweight error reporting mechanism. At minimum, increment a counter and show a "Some data may not have been saved" warning in the UI if multiple saves fail. For the Apps Script backend, log errors to a dedicated "Error Log" sheet tab.

---

## 3. Security

### 3.1 No authentication — anyone can read/write any student's data

**Problem:** The Google Apps Script web app is deployed with "Who has access: Anyone." The `doGet` and `doPost` functions accept any student name parameter with no authentication. Anyone who knows (or guesses) a student name can:
- Read their test results, lesson submissions, and personal progress
- Submit fake test results or lesson completions
- Modify teacher settings
- Access speaking recordings from Google Drive

This is the most critical issue in the codebase.

**Suggestion:** Implement at least basic authentication:
- **Short term:** Add a shared secret (API key) that all legitimate clients include in requests. Store it in a config file not committed to git (the repo is public at `sgalindo88.github.io`).
- **Medium term:** Use Google OAuth with the Apps Script `Session.getActiveUser()` for teacher endpoints. For student endpoints, issue a signed token (HMAC) when the teacher registers a student, which the student includes in all requests.
- **Long term:** Migrate to a proper backend (Firebase, Supabase) with per-user authentication.

### 3.2 Hardcoded API endpoints in public repository

**Problem:** `config.js` contains the full Google Apps Script webhook URL and Formspree endpoint. Since this is hosted on GitHub Pages, anyone can view the source and use these endpoints directly. The Claude API key is server-side (safe), but the webhook URL is effectively a public, unauthenticated API.

**Suggestion:** While moving to proper auth (3.1), at minimum add rate limiting in the Apps Script: track requests per student name per hour in a cache, reject excessive requests.

### 3.3 Potential XSS in `innerHTML` assignments

**Problem:** While `escHtml()` is used in many places, there are paths where user-controlled data is inserted into `innerHTML` without escaping. For example, lesson data returned from the Claude API is rendered into the DOM — if the AI returns malicious HTML (unlikely but possible via prompt injection), it would execute in the student's browser.

**Suggestion:** Audit every `innerHTML` assignment. For AI-generated content, always escape. Consider using `textContent` instead of `innerHTML` wherever HTML markup isn't needed. For rich content, use a sanitisation library or the built-in `DOMParser` with an allowlist.

### 3.4 `postForm` truncates values at 2,000 characters silently

**Problem:** `api.js:43-48` silently truncates form values to 2,000 characters. Long writing responses or speaking transcripts could be clipped without the user knowing. This is data loss, not a security issue, but it's a reliability concern.

**Suggestion:** Either increase the limit significantly (10,000+), remove it entirely, or warn the user when truncation occurs. Alternatively, switch to `postJson` for large payloads (lesson submissions) where response readability isn't an issue.

---

## 4. Performance

### 4.1 No asset bundling or minification

**Problem:** GitHub Pages serves raw, unminified files. Each page loads 4-6 separate JavaScript files and 2-3 CSS files. The largest page (`examiner-panel.html`) is ~110KB of inline HTML+CSS+JS, plus external scripts. While the total is small by modern standards, there's no cache-busting strategy — any file update requires cache clearing.

**Suggestion:** Add a simple build step (even a shell script) that:
1. Concatenates + minifies JS files per page
2. Adds content hashes to filenames for cache busting
3. Minifies CSS
4. Generates the final HTML with updated `<script>` references

Tools: `esbuild` (zero config, extremely fast), or `terser` + `clean-css` via npm scripts.

### 4.2 Google Sheets reads scan entire tabs every time

**Problem:** Every Apps Script read operation calls `sheet.getDataRange().getValues()` which downloads the entire sheet into memory. `handleGetProgress` reads three full sheets (Initial Test Results, Examiner Results, Course Progress) plus iterates all Lesson Marks rows. As the student count grows, this gets increasingly slow.

**Suggestion:**
- Use `sheet.getRange(row, col, numRows, numCols)` to read only needed columns
- Cache frequently-read data using `CacheService.getScriptCache()` with a 5-minute TTL
- Index by student name: maintain a lookup sheet or use `TextFinder` for targeted reads instead of scanning all rows:
  ```javascript
  var finder = sheet.createTextFinder(studentName).matchEntireCell(true);
  var ranges = finder.findAll();
  ```

### 4.3 Teacher dashboard loads all data on init, not per-panel

**Problem:** When the teacher dashboard initialises (`initApp()`), it fetches progress, settings, attendance, all submissions, test results, and library data — even if the teacher only wants to check one panel. The initial load makes 5+ API calls.

**Suggestion:** Lazy-load panel data. Fetch data only when a panel tab is clicked for the first time. Cache the result so subsequent tab switches are instant. Show a loading spinner in each panel until its data arrives.

### 4.4 Full `lesson_json` stored in Sheets cells

**Problem:** Each lesson is a ~3-5KB JSON string stored in a single Sheets cell. The `getLibraryEntries()` function reads ALL library entries (including their full `lesson_json`) just to check entry counts and difficulty profiles. At 600+ entries, this becomes a multi-second operation.

**Suggestion:** The `get_library` endpoint already excludes `lesson_json` from the response — good. But `getLibraryEntries()` (used internally by `handleGenerateLesson`) still parses all `lesson_json` fields. Refactor it to only read the columns it needs (`id`, `level`, `day`, `is_active`, `original_difficulty_json`, `times_served`) by selecting specific column ranges.

### 4.5 No lazy loading for the teacher dashboard sidebar

**Problem:** All 10 panels' HTML is present in the DOM at page load, even though only one is visible. This includes hidden form elements, textareas, and grading interfaces.

**Suggestion:** Generate panel HTML on first visit (lazy rendering). Each sidebar tab click checks if the panel has been built; if not, render it from a template function, then show it. This reduces initial DOM size and speeds up page load.

---

## 5. UX & Accessibility

### 5.1 No keyboard navigation in lesson steps

**Problem:** The student course requires mouse clicks to navigate between steps, select MCQ options, and interact with vocabulary cards. There are no `tabindex` attributes, `role` attributes, or `aria-label` annotations on interactive elements. Keyboard-only users (or those using assistive technology) cannot complete a lesson.

**Suggestion:** Add:
- `tabindex="0"` and `role="button"` to all clickable cards and options
- Keyboard event handlers (`Enter`/`Space` to select MCQ options)
- `aria-live="polite"` regions for dynamic content changes (step transitions, MCQ feedback)
- Focus management: move focus to the first interactive element when a new step loads

### 5.2 Colour alone conveys meaning in MCQ feedback

**Problem:** Correct answers are green, incorrect are red. There are no text labels or icons visible to colourblind users. The tick (✓) and cross (✗) are present in some implementations but not all.

**Suggestion:** Always pair colour with an icon (✓/✗) and a text label ("Correct"/"Incorrect"). Use patterns in addition to colour (e.g., dashed border for incorrect, solid for correct).

### 5.3 No error states for network failures shown to students

**Problem:** When API calls fail (Google Sheets unreachable, timeout), the student sees either an infinite loading spinner or a silent failure. The `fetchProgress` function falls back gracefully to localStorage, but the lesson generation timeout in `student-course.html` shows no user-friendly error.

**Suggestion:** Add clear error states:
- "We couldn't reach the server. Check your internet connection and try again." with a retry button
- Distinguish between timeout (server slow) and network error (offline)
- Show a persistent "Offline mode" banner when connectivity is lost, indicating that progress will sync later

### 5.4 90-minute timer has no pause functionality

**Problem:** The lesson timer counts down from 90 minutes with no way to pause. If a student needs a bathroom break, takes a phone call, or has an interruption, the timer keeps running. The "warning when <10 min remain" adds pressure.

**Suggestion:** Add a pause button that stops the timer and shows a "Paused" overlay. Auto-pause when the browser tab is hidden (using the `visibilitychange` event). Resume with a confirmation click.

### 5.5 No dark mode or high-contrast option

**Problem:** The warm cream/ink palette is pleasant but offers no alternative for users who prefer dark mode or need higher contrast. The current contrast ratios may not meet WCAG AA for all text sizes (e.g., `--muted: #6b5f4e` on `--paper: #f5f0e8` is approximately 3.8:1, which fails WCAG AA for small text requiring 4.5:1).

**Suggestion:** Check all colour combinations against WCAG AA. At minimum, darken `--muted` to improve contrast. Optionally, add a dark-mode toggle using CSS `prefers-color-scheme` media query with an override switch.

### 5.6 Student progress is not visible during lessons

**Problem:** While taking a lesson, the student has no view of their overall course progress (e.g., "Day 8 of 20, you've completed 7 lessons"). The step progress bar shows progress within the current lesson, but not the bigger picture.

**Suggestion:** Add a small persistent indicator in the top navigation: "Day 8/20" with a subtle progress arc or bar.

### 5.7 No confirmation before leaving a lesson in progress

**Problem:** If a student accidentally navigates away (clicks a link, closes the tab, types a URL), there is no `beforeunload` warning. Session recovery helps, but the disruption is unnecessary.

**Suggestion:** Add `window.onbeforeunload` during active lessons to prompt the user. Remove the handler when the lesson is successfully submitted.

### 5.8 Teacher grading workflow requires too many clicks

**Problem:** To grade a lesson, the teacher must: navigate to the Grading panel, select a day from the dropdown, click through 4 tabs (Writing, Speaking, All Responses, Final Score), fill in scores on each, then save. For 20 students over 20 days, this is 400+ grading sessions.

**Suggestion:**
- Add a "Quick Grade" view that shows all gradable fields on one page (no tabs)
- Pre-populate scores with AI-suggested values based on response length, vocabulary complexity, and MCQ performance
- Add keyboard shortcuts for common actions (Tab through score fields, Enter to save)
- Show a "Next ungraded lesson" button that automatically loads the next ungraded submission

---

## 6. Backend (Apps Script)

### 6.1 No input validation on POST endpoints

**Problem:** The `doPost` handler accepts any parameters and writes them directly to sheets. There is no validation of:
- Student name format or length
- Score ranges (could write `writing_score: 999`)
- Date formats
- Required fields

**Suggestion:** Add validation functions for each endpoint:
```javascript
function validateScoreRange(value, min, max) { ... }
function validateStudentName(name) { ... }
function validateDateFormat(date) { ... }
```
Return `400`-style error responses for invalid input.

### 6.2 No rate limiting

**Problem:** Any client can make unlimited requests. A misbehaving client (or attacker) could exhaust the Apps Script execution quota (6 min/execution, 90 min/day for free accounts) or flood Google Sheets with data.

**Suggestion:** Use `CacheService` to track request counts per IP or student name. Reject requests exceeding a threshold (e.g., 60 requests/minute). Log rejected requests.

### 6.3 `doGet` and `doPost` use a growing if-else chain

**Problem:** The request router in `doGet` and `doPost` is a long if-else chain that will grow with every new endpoint. This is hard to maintain and makes it easy to miss edge cases.

**Suggestion:** Refactor to a dispatch table:
```javascript
var GET_HANDLERS = {
  'get_progress': handleGetProgress,
  'get_settings': handleGetSettings,
  ...
};
function doGet(e) {
  var handler = GET_HANDLERS[e.parameter.action];
  if (!handler) return errorResponse('Unknown action');
  return jsonResponse(handler(e.parameter));
}
```

### 6.4 No error logging

**Problem:** Errors in catch blocks are returned to the client but not logged server-side. If a student reports "it didn't save," there's no server-side log to investigate.

**Suggestion:** Create an "Error Log" sheet tab. On every caught error, append a row with `[timestamp, action, student, error_message, parameters]`. Add a dashboard panel to view recent errors.

### 6.5 Claude API calls have no caching at the server level

**Problem:** `handleGenerateLesson` makes a Claude API call that can take 5-15 seconds. If two students request the same `(level, day)` simultaneously, both generate fresh lessons (before either is written to the library). The lesson library mitigates this for subsequent requests, but the first-request problem remains.

**Suggestion:** Use `LockService.getScriptLock()` to prevent concurrent generation for the same `(level, day)`. The first request generates and writes to the library; the second request waits for the lock and then reads from the library.

### 6.6 Hardcoded teacher name

**Problem:** `examiner-panel.html:2922` hardcodes `ex.teacherName = 'Sebastian Galindo'`. This means the platform can only have one teacher. The `doPost` handler writes this name to sheets.

**Suggestion:** Make teacher name configurable — either from a login system, a URL parameter, or a setting stored in Google Sheets (e.g., a "Teachers" tab).

---

## 7. Data & Storage

### 7.1 Google Sheets as primary database has scaling limits

**Problem:** Google Sheets has a 10 million cell limit per spreadsheet, 5MB per cell, and performance degrades beyond ~5,000 rows per sheet. With 20 students × 20 lessons × 17 columns, the Course Progress tab alone reaches 6,800 cells per cohort. Multiple cohorts will hit limits.

**Suggestion:** Plan the migration path now:
- **Short term (current cohort):** Fine as-is. Add monitoring for row counts.
- **Medium term (5+ cohorts):** Archive completed cohorts to a separate spreadsheet. Add an "Archive" button to the teacher dashboard.
- **Long term:** Migrate to Firebase Firestore or Supabase. Both offer free tiers sufficient for this scale, proper querying, real-time sync, and authentication.

### 7.2 localStorage has no expiry or cleanup

**Problem:** The app stores checkpoints, hub cache, lesson cache, teacher state, and other data in localStorage with no expiry. Over time, this accumulates. localStorage has a ~5-10MB limit per origin. Cached lessons (`fp_lesson_<level>_d<day>`) are 3-5KB each; 120 possible lessons = 360-600KB. The teacher dashboard state can grow large with grading history.

**Suggestion:** Add expiry timestamps to cached data. On app load, clean up entries older than 30 days. Implement a `StorageManager` that tracks total usage and warns when approaching limits.

### 7.3 No data export or backup mechanism

**Problem:** All student data lives in one Google Sheet. If the sheet is accidentally deleted, corrupted, or the Google account is compromised, all data is lost. There's no export functionality for teachers to download student records.

**Suggestion:**
- Add an automated daily backup script (Apps Script time-based trigger that copies the sheet to a backup folder)
- Add a "Download Student Report" button in the dashboard that generates a PDF or CSV of a student's complete record
- Add a "Download All Data" button that exports the entire spreadsheet as Excel/CSV

### 7.4 `no-cors` POST mode prevents error detection

**Problem:** `api.js:76-83` uses `mode: 'no-cors'` for Google Apps Script POSTs, which returns opaque responses. The frontend cannot tell if the write succeeded or failed — it always returns `true`. The save verification step (reading back the data) is a workaround, but it adds latency and can itself fail.

**Suggestion:** Use CORS-enabled POST where possible. Google Apps Script supports CORS for `doPost` when deployed as a web app. If CORS headers are an issue, proxy through a CORS-friendly endpoint or switch to `postJson`. The `save_audio` endpoint already uses JSON POST successfully.

---

## 8. Feature Gaps

### 8.1 No multi-student overview for teachers

**Problem:** The teacher can only view one student at a time. With 20+ students, there's no way to see at a glance which students have ungraded submissions, who hasn't completed their lesson, or who's falling behind.

**Suggestion:** Create a "Class Overview" dashboard that shows:
- A table of all students with columns: name, CEFR level, days completed, last active, ungraded count, attendance %
- Sort/filter by status (needs grading, inactive, behind schedule)
- Click any student row to open their individual dashboard
- Colour-code rows: green (on track), yellow (needs attention), red (falling behind)

### 8.2 No notification system

**Problem:** Teachers don't know when a student submits a lesson or test. Students don't know when their test has been graded. Both parties must manually refresh to check for updates.

**Suggestion:**
- **Email notifications:** Apps Script can send emails via `MailApp.sendEmail()`. Trigger on: student submits test/lesson (notify teacher), teacher grades work (notify student), teacher assigns level (notify student).
- **In-app notifications:** Add a notification bell icon with a badge count. Store notifications in a "Notifications" sheet tab.
- **Browser push notifications:** Use the Push API for real-time alerts (requires HTTPS, which GitHub Pages provides).

### 8.3 No student-to-student progress comparison (anonymised)

**Problem:** Students have no sense of how they compare to peers. Healthy competition and social proof can motivate learners.

**Suggestion:** Add an optional "Class Progress" section to the hub showing anonymised stats: "You are on Day 8. The class average is Day 6." No individual names shown.

### 8.4 No spaced repetition for vocabulary

**Problem:** Each day's vocabulary is introduced and practiced once, then never revisited. Language learning research strongly supports spaced repetition (SRS) for long-term retention.

**Suggestion:** Track vocabulary words shown per student. In each new lesson's warm-up or vocabulary section, include 2-3 review words from previous days using a simple SRS algorithm (review after 1 day, 3 days, 7 days, 14 days). The Claude prompt can include "also review these previously-learned words: [list]".

### 8.5 No gamification or achievement system

**Problem:** The 20-day course has no rewards, streaks, or milestones beyond the progress bar. Adult learners benefit from visible achievement markers.

**Suggestion:** Add:
- Day streak counter ("5-day streak!")
- Milestone badges (Day 5, Day 10, Day 15, Day 20)
- Skill-level badges when scores improve
- A "Learning Stats" section showing total words learned, minutes studied, speaking time
- Optional: weekly email summary of achievements

### 8.6 No support for multiple courses or repeating the course

**Problem:** The platform assumes a single 20-day course per student. After completion, there's no next step. Students who want to continue at a higher level must reset everything.

**Suggestion:** Add a "course" concept:
- Each course has a level, start date, and 20 days
- A student can complete Course 1 (B1), then start Course 2 (B2)
- The teacher can "promote" a student to the next level, which creates a new course
- Progress from past courses is preserved and viewable

### 8.7 No printable/exportable lesson content

**Problem:** Lesson content is only viewable in the browser during the lesson. Students can't print worksheets, review vocabulary offline, or share materials with family members who might help them practice.

**Suggestion:** Add a "Print this lesson" button that generates a clean print-friendly version (vocabulary list, writing prompts, key takeaways). Use `@media print` CSS. Also offer a "Download as PDF" option using the browser's print-to-PDF capability.

### 8.8 Web Speech API browser support gaps

**Problem:** The Web Speech API (especially `SpeechRecognition`) has poor support on some browsers: no support on Firefox, limited on Safari. The code checks for browser compatibility and shows a warning, but the speaking section becomes completely non-functional for affected users.

**Suggestion:**
- Show a browser recommendation banner ("For the best experience, use Chrome or Edge")
- For unsupported browsers, offer a text-input fallback for speaking drills ("Type what you would say")
- Consider adding a server-side speech recognition option using Whisper API (via Apps Script proxy) for uploaded audio

### 8.9 No support for right-to-left languages

**Problem:** The i18n system supports Spanish only. If the platform expands to serve immigrants who speak Arabic, Farsi, or other RTL languages, the entire UI layout would need to be mirrored.

**Suggestion:** Not urgent, but architect the translation system to be extensible: keep language data in JSON files rather than a JS constant, add a `dir` attribute to the `<html>` element based on the active language, and use CSS logical properties (`margin-inline-start` instead of `margin-left`) where possible.

---

## 9. Testing & Reliability

### 9.1 No automated tests

**Problem:** There are zero test files in the repository. No unit tests, integration tests, or end-to-end tests. Every change relies entirely on manual testing. Regressions are likely as the codebase grows.

**Suggestion:**
- **Unit tests** for pure logic: `escHtml()`, `recycleProbability()`, `findLibraryMatch()`, `buildTeacherGuidanceBlock()`, CEFR score calculation, date formatting. Use Vitest or Jest.
- **Integration tests** for Apps Script endpoints: Mock SpreadsheetApp and test each handler.
- **E2E tests** for critical flows: Student completes a lesson, teacher grades it. Use Playwright or Cypress.
- Start with the highest-value tests: the CEFR calculation logic, MCQ scoring, and save/load flows.

### 9.2 No error monitoring

**Problem:** When something breaks in production, the only way to know is when a user reports it. There's no error tracking, no crash reporting, no usage analytics.

**Suggestion:**
- Add `window.onerror` and `window.onunhandledrejection` handlers that log errors to a Google Sheet (via a dedicated `log_error` endpoint)
- Add basic usage analytics: page views, lesson completions, average time per step. This helps identify where students get stuck.
- Consider a free tier of Sentry or LogRocket for more sophisticated error tracking.

### 9.3 Checkpoint recovery has edge cases

**Problem:** The checkpoint system saves every 5 seconds, but:
- If the browser crashes during a save, the checkpoint could be corrupted (partial JSON)
- The 60-second auto-resume countdown could resume into a broken state if the lesson data was only partially loaded
- There's no version check — if the app is updated, old checkpoints might be incompatible

**Suggestion:** Add a version field to checkpoints. On load, verify the checkpoint structure before resuming. Use a double-buffer approach (save to `fp_ckpt_test_a` and `fp_ckpt_test_b` alternately) so a crash during save doesn't corrupt the only copy.

### 9.4 No graceful degradation for Google Sheets downtime

**Problem:** If Google Sheets is down or the Apps Script quota is exceeded, the entire platform stops working except for what's cached in localStorage. There's no offline mode for the teacher dashboard.

**Suggestion:** Add a service worker that caches the most recent data and serves it when offline. Show a clear "Working offline — changes will sync when connection is restored" banner. Queue failed writes and replay them when connectivity returns.

---

## 10. DevOps & Deployment

### 10.1 No CI/CD pipeline

**Problem:** Deployment is manual: push to GitHub Pages. There's no automated quality checks on push.

**Suggestion:** Add a GitHub Actions workflow that:
1. Runs ESLint
2. Runs any unit tests
3. Validates HTML (using `html-validate` or similar)
4. Checks for hardcoded secrets
5. Deploys to GitHub Pages on merge to main

### 10.2 Apps Script deployment is manual and undocumented in code

**Problem:** The Apps Script must be manually pasted into Google's editor. There's no version control for the deployed script, no rollback mechanism, and no way to know which version is currently deployed.

**Suggestion:** Use `clasp` (Google's command-line tool for Apps Script) to:
- Push `apps-script.js` to the project from the command line
- Version deployments with git tags
- Add `clasp push` and `clasp deploy` to the CI/CD pipeline

### 10.3 No staging environment

**Problem:** All development is done against production data. There's no way to test changes without affecting real students.

**Suggestion:** Create a second Google Sheet ("FluentPath - Dev") and a second Apps Script deployment with a different URL. Add a `FP.ENV` flag in `config.js`:
```javascript
FP.ENV = 'production'; // or 'development'
FP.WEBHOOK_URL = FP.ENV === 'production' ? 'https://...' : 'https://...-dev';
```

### 10.4 No health monitoring

**Problem:** If the Apps Script stops working (quota exceeded, authentication expired, sheet renamed), nobody knows until a user complains.

**Suggestion:** Add a `/health` endpoint to Apps Script that checks Sheet accessibility and API key validity. Set up a free uptime monitor (e.g., UptimeRobot) to ping it every 5 minutes and alert via email on failure.

### 10.5 DDEV configuration is unused

**Problem:** The `.ddev/` directory configures PHP + MariaDB for local development, but the app is pure HTML/JS with no PHP or database. This configuration is vestigial and misleading.

**Suggestion:** Remove `.ddev/` or replace with a simple `live-server` or `serve` npm script for local development. Add a `package.json` with a `"dev"` script.

---

## Summary Priority Matrix

| Priority | Suggestion | Impact | Effort |
|----------|-----------|--------|--------|
| **Critical** | 3.1 Add authentication | Security | Medium |
| **Critical** | 3.3 Fix XSS in innerHTML | Security | Low |
| **High** | 1.1 Extract JS/CSS from HTML | Maintainability | Medium |
| **High** | 1.2 Consolidate shared CSS | Maintainability | Low |
| **High** | 4.2 Optimise Sheets reads | Performance | Medium |
| **High** | 5.1 Add keyboard navigation | Accessibility | Medium |
| **High** | 8.1 Multi-student overview | Feature | Medium |
| **High** | 8.2 Notification system | Feature | Medium |
| **Medium** | 2.1 Standardise var/const/let | Code quality | Low |
| **Medium** | 2.2 Add ESLint/Prettier | Code quality | Low |
| **Medium** | 2.5 Extract magic numbers | Code quality | Low |
| **Medium** | 4.3 Lazy-load dashboard panels | Performance | Low |
| **Medium** | 5.3 Network error states | UX | Low |
| **Medium** | 5.7 beforeunload warning | UX | Low |
| **Medium** | 6.1 Input validation | Security | Medium |
| **Medium** | 7.3 Data backup/export | Reliability | Medium |
| **Medium** | 8.4 Spaced repetition | Feature | High |
| **Medium** | 9.1 Add unit tests | Reliability | Medium |
| **Low** | 1.3 Shared MCQ component | Architecture | Medium |
| **Low** | 1.6 Remove legacy file | Cleanup | Low |
| **Low** | 5.4 Timer pause button | UX | Low |
| **Low** | 5.5 Dark mode | UX | Medium |
| **Low** | 8.5 Gamification | Feature | High |
| **Low** | 8.6 Multi-course support | Feature | High |
| **Low** | 10.1 CI/CD pipeline | DevOps | Medium |
