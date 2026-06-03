# Changelog

All notable changes to the FluentPath platform are documented here.

---

## [0.45.0] - 2026-06-02

### Changed — Pluggable AI provider (Gemini / Anthropic / OpenAI)

Replaced the hard-coded Anthropic/Claude integration with a provider-agnostic layer. The AI provider, key, and model are now chosen entirely through Script Properties — no code change to switch. **Default provider is Gemini (`gemini-2.5-flash`).**

#### Script Properties (breaking — reconfigure before redeploy)
- **Removed** `CLAUDE_API_KEY` and `CLAUDE_MODEL`
- **Added** `AI_API_KEY` (required), `AI_PROVIDER` (optional: `gemini` default / `anthropic` / `openai`), `AI_MODEL` (optional, default `gemini-2.5-flash`)

#### Apps Script (`apps-script.js`)
- **`AI_PROVIDERS` registry** — one adapter per provider, each defining `buildRequest` (URL, headers, payload) and `extractText` / `extractError` for that provider's response shape:
  - **gemini** — `…/v1beta/models/{model}:generateContent`, `x-goog-api-key` header, text at `candidates[0].content.parts[0].text`
  - **anthropic** — `…/v1/messages`, `x-api-key` + `anthropic-version`, text at `content[0].text`
  - **openai** — `…/v1/chat/completions`, `Authorization: Bearer`, text at `choices[0].message.content`
- **`aiGenerate(prompt)`** — single dispatcher: reads `AI_PROVIDER` / `AI_API_KEY` / `AI_MODEL`, calls the matching adapter, handles HTTP/error uniformly, returns the generated text
- **`stripJsonFences(text)`** — shared helper to strip markdown code fences the model may wrap around JSON
- **`handleGenerateLesson`** and **`rewriteLessonForDifficulty`** — now generate via `aiGenerate` instead of an inline Anthropic `UrlFetchApp` call
- **New `ai_summary` POST handler** — implements the previously-missing teacher weekly-summary draft action through `aiGenerate`; returns `{ summary }`. The dashboard's "✨ AI Draft Summary" button now works (no frontend change needed)
- **`handleHealth`** — `claude_key` check renamed to `ai_key`; added `ai_provider` to the report
- **Header comment + `authorizeScript`** — updated to describe the pluggable provider setup

#### Docs
- **README.md** — rewrote the AI integration section (new Script Properties table, provider list), updated Technology Stack / APIs, and corrected lingering Jitsi references to the current student-initiated call-request system (`call-request.js`)

#### Frontend
- Comment/alert strings in `student-lesson.js` and `examiner-panel.js` updated from "Claude" to "the AI provider" (no behavioural change; the API key stays server-side)

---

## [0.44.0] - 2026-04-12

### Changed — Replace Jitsi with Video Call Request System

The old Jitsi Meet integration (auto-launched floating video panel) has been replaced with a student-initiated call request system where the teacher responds with their preferred link (Zoom, WhatsApp, Meet, etc.).

#### Student flow
- **"Request a Video Call" button** — floating bottom-right corner on hub, placement test, and daily lesson pages
- Click → POST `request_video_call` → email sent to teacher → button becomes "Request pending…" with a manual Refresh link
- When teacher sends a link: green **banner at top of page** with "Join Call" + Dismiss button; floating button transforms to "Join Teacher's Call"
- Polling on page load + tab focus + manual refresh (no continuous polling)
- Student can Dismiss to clear their request at any time

#### Teacher flow
- **Dashboard panel** — blue reminder card at top showing all pending call requests with student name, page, and "open dashboard" link
- **Student Profile panel** — new blue "VIDEO CALL" card shows pending request + paste-link input + Send Link / Mark as Done buttons
- Sent links are visible in the card as a clickable link; teacher can Mark as Done to clear
- **Email notification** (opt-in, default ON) includes: student name, page (hub/test/lesson day), CEFR level, timestamp, deep link to that student's dashboard

#### Backend (`apps-script.js`)
- **New sheet tab** `Video Call Requests` with columns: id, student_name, requested_at, page, day_number, call_link, link_sent_at, status (pending/sent/done/dismissed)
- **`handleRequestVideoCall`** — creates a request, triggers email notification
- **`handleGetActiveCallRequest`** — student polls for most recent pending/sent request
- **`handleGetCallRequests`** — teacher dashboard fetches all active requests
- **`handleSendCallLink`** — teacher attaches a link to a pending request
- **`handleUpdateCallStatus`** — marks done (teacher) or dismissed (student)
- **`notifyTeacherCallRequest`** — email helper with full context + deep link
- Added `notify_on_call_request` column to Settings (default ON)
- New endpoints: `request_video_call`, `send_call_link`, `update_call_status`, `get_active_call_request`, `get_call_requests`

#### Frontend
- **New file `src/scripts/call-request.js`** — `CallRequest.init({page, dayNumber})` module manages button state, banner, polling, and dismissal
- **Wired into** `hub.js`, `student-test.js`, `student-lesson.js` on DOMContentLoaded
- **Teacher dashboard** — `loadCallRequests`, `renderDashboardCallRequests`, `renderProfileCallRequest`, `sendCallLink`, `markCallDone` functions added to `examiner-panel.js`
- **New toggle** "Notify on video call request" in Student Profile → Notifications card

#### Removed (Jitsi cleanup)
- Deleted `src/scripts/video-call.js`
- Removed `<script src="video-call.js">` from `student-course.html`, `student-initial-test.html`, `examiner-panel.html`
- Removed all `VideoCall.init` / `VideoCall.show` / `VideoCall.updateRoom` calls from `student-lesson.js`, `student-test.js`, `examiner-panel.js`
- Removed `VideoCall` from ESLint globals; added `CallRequest`
- Updated service worker cache list (bumped to v6) — `video-call.js` replaced with `call-request.js`

---

## [0.43.0] - 2026-04-11

### Fixed — Quick wins from suggestions audit

#### localStorage cleanup (Suggestion 7.2) — `src/scripts/utils.js`
- **`cleanupLocalStorage()`** — runs on every page load via `api.js`; removes lesson caches and hub cache older than 30 days; adds `_ts` timestamps to existing entries for future cleanup; warns in console when localStorage exceeds 4MB

#### postForm truncation limit (Suggestion 3.4) — `src/scripts/api.js`
- **Default limit raised from 2,000 to 10,000 characters** — prevents silent data loss on long writing responses and speaking transcripts

#### Checkpoint double-buffer (Suggestion 9.3) — `src/scripts/checkpoint.js`
- **Double-buffer writes** — alternates between `_a` and `_b` localStorage slots; a crash mid-save corrupts at most one slot, the other remains valid
- **Version field** — checkpoints include `_version: 2`; incompatible old versions are filtered out on load
- **Legacy migration** — `load()` checks old single-key format first, so existing checkpoints are still recovered

#### Day X/20 progress in lesson nav (Suggestion 5.6) — `src/scripts/student-lesson.js`
- **Nav badge updated** — shows "Day 3 / 20" instead of just "Day 3" during lessons

#### New file: `SUGGESTIONS_AUDIT.md`
- Complete cross-reference of all 45 suggestions vs. implementation status (32 done, 7 low-effort remaining, 6 deferred)

---

## [0.42.0] - 2026-04-11

### Added — Service worker for offline resilience

#### New file: `sw.js`
- **App shell caching** — pre-caches all HTML, CSS, and JS files on install; serves cache-first with background update
- **API GET caching** — stale-while-revalidate strategy for Apps Script responses; returns cached data immediately while refreshing in the background
- **Google Fonts** — cache-first (rarely change)
- **POST queue** — failed POST requests stored in IndexedDB (`fp-post-queue`); replayed automatically when connectivity returns via the `online` event
- **Cache cleanup** — old cache versions deleted on activate

#### Service worker registration (`src/scripts/api.js`)
- **Auto-registration** — registers `sw.js` from the computed root path on every page load
- **Update check** — polls for service worker updates every 30 minutes
- **Online replay** — sends `replay-queue` message to the SW when the browser comes back online
- **Queue replay listener** — logs replayed request count to console

#### Strategies
| Request type | Strategy | Fallback |
|-------------|----------|----------|
| Local HTML/CSS/JS | Cache-first | 503 "Offline" text |
| Google Fonts | Cache-first | — |
| API GET (Apps Script) | Stale-while-revalidate | Cached response or JSON `{ error: "Offline" }` |
| API POST (Apps Script) | Network-first | Queue in IndexedDB, replay on reconnect |

---

## [0.41.0] - 2026-04-11

### Added — clasp for Apps Script version control

#### New files
- **`appsscript.json`** — Apps Script manifest with V8 runtime, timezone, OAuth scopes (spreadsheets, drive, external requests, mail)
- **`.clasp.json`** — clasp config pointing to the Apps Script project (gitignored — contains script ID)
- **`.claspignore`** — only pushes `apps-script.js` and `appsscript.json` to Google; ignores all frontend files

#### Config
- **`package.json`** — added `clasp:push`, `clasp:deploy` (push + deploy with git commit message), `clasp:status` scripts
- **`.gitignore`** — added `.clasp.json`

#### Setup (one-time, interactive)
1. `npx clasp login` — opens browser for Google OAuth
2. Find your Script ID: Apps Script editor → Project Settings → Script ID
3. Paste it into `.clasp.json` replacing `YOUR_SCRIPT_ID_HERE`
4. `npm run clasp:push` — pushes `apps-script.js` to the project
5. `npm run clasp:deploy` — pushes + creates a new versioned deployment

---

## [0.40.0] - 2026-04-11

### Added — Multi-course support

#### Data model
- **`course_id` column** added to `Course Progress`, `Lesson Marks`, and `Settings` sheet headers
- Existing data without `course_id` defaults to `'1'` — fully backward compatible

#### Apps Script (`apps-script.js`)
- **`handleGetProgress`** — now accepts optional `course_id` parameter; reads the active `course_id` from Settings if not provided; filters Course Progress and Lesson Marks by course
- **`promote_student` POST handler** — increments `course_id` in Settings and sets the new CEFR level; returns `{ result: 'success', course_id, level }`
- **`TEACHER_ACTIONS`** — added `promote_student` (requires teacher token)

#### Student hub (`src/scripts/hub.js`)
- **`course_id` stored** in localStorage (`fp_course_id`) from progress response
- **Course label** — shows "Course 2 — " prefix on milestone descriptions when `course_id > 1`

#### Student lesson (`src/scripts/student-lesson.js`)
- **Save payload** — includes `course_id` from localStorage (default `'1'`)

#### Teacher dashboard (`src/examiner-panel.html`)
- **"Course Promotion" card** — new section in Student Profile with level selector and "Promote to Next Course" button

#### Teacher dashboard JS (`src/scripts/examiner-panel.js`)
- **`promoteStudent()`** — POSTs `promote_student` action, updates local state and sidebar on success

#### Config (`src/scripts/config.js`)
- **`FP.KEYS.COURSE_ID`** — added `'fp_course_id'` localStorage key

---

## [0.39.0] - 2026-04-11

### Added — Gamification and achievement system

#### Student hub (`src/scripts/hub.js`)
- **6 achievements** defined: First Steps (test completed), Level Up (CEFR assigned), Day One (1 lesson), 5-Day Streak (5 lessons), Halfway There (10 lessons), Graduate (20 lessons)
- **`renderAchievements(d)`** — renders a horizontal badge row below the CTA section; earned badges in full colour, unearned badges greyed out
- **`showAchievementToast(achievement)`** — animated toast notification at the bottom of the screen when a new achievement is unlocked; auto-dismisses after 3.5 seconds
- **localStorage tracking** — earned achievement IDs stored in `fp_achievements`; compared on each render to detect newly unlocked achievements
- Called at the end of `renderDashboard()` so achievements update on every hub visit

#### Student hub HTML (`index.html`)
- **Achievements container** — `<div id="achievementsSection">` added below the CTA section

#### Styles (`src/styles/hub.css`)
- **`.achieve-grid`** — flexbox row with wrapping badges
- **`.achieve-badge`** — card with icon + label; `.earned` (gold border, white bg) vs `.unearned` (greyed out, low opacity)
- **Toast animation** — `@keyframes fpToastIn` for slide-up entrance

---

## [0.38.0] - 2026-04-11

### Added — Staging environment

#### Shared config (`src/scripts/config.js`)
- **`FP.ENV`** — auto-detected from hostname: `'production'` on `sgalindo88.github.io`, `'development'` everywhere else (localhost, DDEV, etc.)
- Production webhook URL remains the default; dev override goes in `config.local.js`

#### Shared API wrapper (`src/scripts/api.js`)
- **DEV banner** — fixed blue bar at the top of every page reading "DEV MODE" when `FP.ENV === 'development'`; auto-injected on DOMContentLoaded; not shown in production

#### Local config (`src/scripts/config.local.js`)
- **Dev webhook URL** — documented how to uncomment and set `FP.WEBHOOK_URL` to a separate "FluentPath - Dev" Apps Script deployment for local development

#### Setup
1. Create a second Google Sheet ("FluentPath - Dev")
2. Create a second Apps Script deployment linked to the dev sheet
3. In `config.local.js`, uncomment `FP.WEBHOOK_URL` and paste the dev deployment URL
4. Local dev (`npm run dev` / DDEV) → "DEV MODE" banner visible, uses dev sheet
5. Production (GitHub Pages) → no banner, uses production sheet

---

## [0.37.0] - 2026-04-11

### Added — CI/CD with GitHub Actions

- **`.github/workflows/ci.yml`** — runs on push to `master` and pull requests; checks out code, installs dependencies (`npm ci`), runs `npm run lint`, then `npm test`; uses Node 18 with npm cache
- **README.md** — CI status badge added below the title

---

## [0.36.0] - 2026-04-11

### Added — Health monitoring endpoint

#### Apps Script (`apps-script.js`)
- **`handleHealth()`** — new GET endpoint (`?action=health`) returning system status: Google Sheets accessibility, Claude API key status, APP_SECRET status, spreadsheet name, and timestamp
- **No authentication required** — the health endpoint skips the token check so uptime monitors (UptimeRobot, Better Stack, etc.) can ping it without credentials
- **Status values**: `healthy` (all checks pass) or `degraded` (any check fails)
- Added to `GET_HANDLERS` dispatch table

#### Setup
To monitor uptime, configure a free monitor (e.g., UptimeRobot) to ping:
`https://script.google.com/macros/s/YOUR_ID/exec?action=health` every 5 minutes.
Alert on any response where `status` is not `healthy`.

---

## [0.35.0] - 2026-04-11

### Added — Keyboard navigation and accessibility

#### Colour contrast (`src/styles/theme.css`)
- **`--muted` darkened** from `#6b5f4e` to `#5a5040` — achieves WCAG AA 4.5:1 contrast ratio on `--paper` background

#### Focus indicators (`src/styles/theme.css`)
- **`:focus-visible` global rule** — 2px solid blue outline on all interactive elements when using keyboard navigation
- **`:focus:not(:focus-visible)`** — removes outline for mouse/touch users (no visual regression)

#### MCQ options — keyboard + screen reader (`src/scripts/student-lesson.js`)
- **`tabindex="0"`**, **`role="button"`**, **`aria-label`** added to all listening and practice MCQ options
- **`onkeydown` handler** — Enter and Space keys select an option (same as click)
- **`aria-live="polite"`** on feedback containers — screen readers announce correct/incorrect results

#### MCQ feedback — text labels (`src/styles/student-lesson.css`, `src/styles/student-test.css`)
- **`::after` pseudo-elements** — "Correct" / "Incorrect" text labels added alongside the colour change, so colourblind users can distinguish results

#### Vocabulary cards (`src/scripts/student-lesson.js`)
- **`tabindex="0"`**, **`role="button"`**, **`aria-label`** added to each vocabulary card
- **Enter/Space keyboard handling** — toggles word definition reveal

#### Focus management — step transitions (`src/scripts/student-lesson.js`)
- **Auto-focus** on first interactive element (textarea, input, button, or `[tabindex="0"]`) when a lesson step changes

#### Focus management — test screens (`src/scripts/student-test.js`)
- **Auto-focus** on first interactive element when navigating between test sections

#### Placement test feedback (`src/scripts/student-test.js`)
- **`aria-live="polite"`** set dynamically on MCQ feedback elements and Q19 multi-select feedback

#### Timer (`src/student-course.html`)
- **`aria-label="Lesson timer"`** added to the timer element

---

## [0.34.0] - 2026-04-11

### Added — Multi-student class overview

#### Apps Script (`apps-script.js`)
- **`handleGetClassOverview()`** — new GET endpoint (`get_class_overview`) that returns a summary for every registered student: name, CEFR level, days completed, last active date, ungraded count, attendance %, and status colour (green/yellow/red)
- Reads Students, Examiner Results, Course Progress, Lesson Marks, and Attendance sheets in one pass using pre-indexed maps (no per-student queries)

#### Teacher dashboard HTML (`src/examiner-panel.html`)
- **Class Overview panel** — new panel before Dashboard with a sortable table, colour-coded rows, and a "Show only students needing attention" filter toggle
- **Sidebar** — new "CLASS" section with "Class Overview" link at the top of the sidebar navigation

#### Teacher dashboard JS (`src/scripts/examiner-panel.js`)
- **`loadClassOverview()`** — fetches class data from `get_class_overview`, lazy-loaded on first panel visit
- **`renderClassTable()`** — builds a sortable HTML table; columns: Student, Level, Progress (bar + count), Last Active, Ungraded, Attendance %; click any column header to sort
- **`sortClassTable(key)`** — toggles ascending/descending sort on the clicked column
- **`switchToStudent(name)`** — navigates to the individual dashboard for the clicked student (reloads page with `?student=name`)
- **Filter toggle** — "Show only students needing attention" checkbox filters to yellow/red status rows
- **Status logic** — green (on track), yellow (has ungraded work or 0 days), red (3+ ungraded or no level assigned)

#### Styles (`src/styles/examiner-panel.css`)
- **`.class-table`** — sortable table with hover rows, colour-coded left border per status
- **`.class-progress-bar`** / **`.class-progress-fill`** — inline progress bar in the Progress column

---

## [0.33.0] - 2026-04-11

### Added — Quick grading workflow

#### Teacher dashboard HTML (`src/examiner-panel.html`)
- **"Next Ungraded →" button** — added to the marking panel header next to "Fetch Latest Submission"
- **Keyboard shortcut hints** — shows `Ctrl+S` (save) and `Ctrl+→` (next ungraded) below the buttons

#### Teacher dashboard JS (`src/scripts/examiner-panel.js`)
- **`goNextUngraded()`** — fetches all submissions (cached after first call), finds the first ungraded submission after the current day, and loads it; shows "All lessons graded!" when none remain
- **`cachedSubmissions`** — in-memory cache of all submissions; populated on first Next Ungraded click
- **`invalidateSubmissionCache()`** — clears the cache after saving grades so the next-ungraded logic reflects the change
- **Keyboard shortcuts** — `Ctrl+S` / `Cmd+S` saves grades to sheet, `Ctrl+→` / `Cmd+→` loads next ungraded; only active when the marking panel is visible

---

## [0.32.0] - 2026-04-11

### Added — Vocabulary spaced repetition (SRS)

#### Apps Script (`apps-script.js`)
- **`Vocabulary Tracker` sheet tab** — new headers: `student_name`, `word`, `level`, `day_introduced`, `last_reviewed`, `review_count`, `next_review_date`
- **`getReviewWords(studentName)`** — returns up to 3 words due for review today (sorted oldest-due-first)
- **`saveVocabularyWords(studentName, words, level, dayNumber)`** — writes new vocabulary to the tracker, skipping words already tracked for the student; sets first review date to +1 day
- **`markWordsReviewed(studentName, words)`** — advances reviewed words to the next SRS interval (1 → 3 → 7 → 14 days) by updating `last_reviewed`, `review_count`, and `next_review_date` directly in the sheet
- **`SRS_INTERVALS`** — [1, 3, 7, 14] day review schedule
- **`buildLessonPrompt`** — appends a "SPACED REPETITION" instruction block when review words exist, asking Claude to integrate them into warmup, practice, or writing (not the vocab section)
- **`save_progress` handler** — now extracts `vocabulary_words` from the POST payload, saves them to the tracker, and marks any pending review words as reviewed

#### Student lesson (`src/scripts/student-lesson.js`)
- **Save payload** — includes `vocabulary_words` (JSON array of word strings extracted from `state.lessonContent.vocabulary.words`)

---

## [0.31.0] - 2026-04-11

### Added — Email notification system

#### Apps Script (`apps-script.js`)
- **`getNotificationSettings(studentName)`** — reads `teacher_email`, `student_email`, `notify_on_test`, `notify_on_submission` from the Settings sheet
- **`sendNotificationEmail(to, subject, htmlBody)`** — best-effort email via `MailApp.sendEmail`; silently logs failures to Error Log instead of blocking the request
- **`notifyTeacherTestSubmitted(studentName)`** — emails the teacher when a student submits a placement test
- **`notifyTeacherLessonSubmitted(studentName, dayNumber)`** — emails the teacher when a student completes a daily lesson
- **`notifyStudentTestGraded(studentName, cefrLevel)`** — emails the student when their test has been graded and a CEFR level assigned
- **Settings headers** extended with `teacher_email`, `student_email`, `notify_on_test`, `notify_on_submission`
- **Notification triggers** added to `_submit_test`, `save_progress`, and `_examiner_results` POST handlers

#### Teacher dashboard (`src/scripts/examiner-panel.js`)
- **State extended** — `ex.teacherEmail`, `ex.notifyOnTest`, `ex.notifyOnSubmission` added to state object and persisted to localStorage
- **Profile form** — reads/writes notification fields on `initApp` and `saveProfile`
- **`update_settings` payload** — includes `teacher_email`, `student_email`, `notify_on_test`, `notify_on_submission`

#### Teacher dashboard HTML (`src/examiner-panel.html`)
- **Notifications card** — new "NOTIFICATIONS" section in the Student Profile panel with teacher email input and two toggle switches (notify on test, notify on lesson)

---

## [0.30.0] - 2026-04-11

### Added — Student data export and daily backup

#### Apps Script (`apps-script.js`)
- **`handleGetStudentReport(studentName)`** — new GET endpoint (`get_student_report`) that compiles all data for a student: placement test results, settings, attendance, course submissions, and lesson marks into a single JSON response
- **`getMarksForStudent(studentName)`** — helper that returns all Lesson Marks rows for a student
- **`dailyBackup()`** — time-triggered function that copies the entire spreadsheet to a "FluentPath Backups" folder in Google Drive; prunes old copies to keep only the 7 most recent
- Added `get_student_report` to the `GET_HANDLERS` dispatch table

#### Teacher dashboard (`src/scripts/examiner-panel.js`)
- **`exportProfile(format)`** — rewritten to fetch a full server-side report via `get_student_report`, with fallback to local `ex` data if the server is unavailable
- **`downloadReportJSON()`** — downloads the report as pretty-printed JSON
- **`downloadReportCSV()`** — flattens the report into Section/Field/Value rows and downloads as CSV
- Both formats include: student info, settings, placement test scores, course submissions, and lesson marks

#### Teacher dashboard HTML (`src/examiner-panel.html`)
- **Export buttons** — "Export Data" button replaced with "Download Report (JSON)" and "Download Report (CSV)"

---

## [0.29.0] - 2026-04-11

### Added — Timer pause and smart auto-pause

#### Student lesson (`src/scripts/student-lesson.js`)
- **`togglePause()`** / **`pauseLesson()`** / **`resumeLesson()`** — pause/resume the lesson timer; shows a translucent overlay with "Paused — click Resume to continue"
- **Pause button** — `⏸` button in the top nav next to the timer; toggles to `▶` when paused
- **Auto-pause on tab hidden** — listens to `visibilitychange`; automatically pauses when the student switches tabs or minimises the browser
- **`totalPausedTime` tracking** — accumulates seconds spent paused; included in the save payload as `paused_time_min` so the teacher can see active time vs. total elapsed time
- **Timer display** — shows gold colour when paused (`.nav-timer.paused`)
- **Cleanup on finish** — resumes if paused (removes overlay), hides pause button on completion screen

#### Styles (`src/styles/student-lesson.css`)
- **`.nav-pause`** — compact button style for the top nav
- **`.pause-overlay`** + **`.pause-card`** — full-screen translucent overlay with centred card, title, subtitle, and Resume button
- **`.nav-timer.paused`** — gold colour state for paused timer

---

## [0.28.0] - 2026-04-11

### Added — Unit tests (vitest)

#### New files
- **`tests/helpers.js`** — test harness that loads global-style JS files (`utils.js`, `apps-script.js`) into vitest using indirect `eval`; provides minimal Apps Script API mocks (`SpreadsheetApp`, `CacheService`, etc.)
- **`tests/utils.test.js`** — 23 tests covering `escHtml` (XSS payloads, edge cases), `formatDate` (long/short/invalid), `formatLessonDate`, `formatTimeSpent` (clock string filtering), `formatDuration`, `formatPlayTime`, `timeAgo` (bilingual output)
- **`tests/apps-script.test.js`** — 22 tests covering `recycleProbability` (boundary values 0/4/5/9/10), `findLibraryMatch` (strict match, lenient fallback, focus tag overlap, null handling), `nearDuplicateExists` (exact/different/empty/null), `requireParam` (valid/missing/blank/null), `validateScore` (range/non-numeric), `validateDate` (valid/invalid/empty)

#### Config
- **`package.json`** — added `test` and `test:watch` scripts
- **`eslint.config.mjs`** — added ES module override for `tests/` directory
- **vitest 2** installed (compatible with Node 18)

#### Result: **45 tests, all passing**

---

## [0.27.0] - 2026-04-11

### Added — beforeunload warning and offline banner

#### Student lesson (`src/scripts/student-lesson.js`)
- **`beforeunload` handler** — browser prompts "Leave site?" when the student navigates away during an active lesson; disabled after successful save or on completion screen
- **`lessonInProgress` flag** — set `true` on `beginLesson()` and checkpoint resume, `false` on `finishLesson()`

#### Placement test (`src/scripts/student-test.js`)
- **`beforeunload` handler** — same pattern as lesson; warns during active test
- **`testInProgress` flag** — set `true` on `startTest()` and checkpoint resume, `false` on `finishTest()` and `restartTest()`

#### Student hub (`src/scripts/hub.js`)
- **Offline banner** — fixed bottom bar with "Offline — showing cached data" and a Retry button; shown when the API call fails and localStorage fallback is used; auto-hidden on successful fetch
- **`showOfflineBanner()`** / **`hideOfflineBanner()`** — create/show/hide the banner dynamically

---

## [0.26.0] - 2026-04-11

### Changed — Lazy-load teacher dashboard panels

#### Teacher dashboard (`src/scripts/examiner-panel.js`)
- **`panelLoaded` tracker** — tracks which panels have been loaded; data fetched only on first visit
- **`showPanel`** — now calls `loadPanelData(id)` on first visit instead of loading all data at init
- **`loadPanelData(id)`** — dispatches to the correct loader: `loadPlacementTest`, `autoLoadSubmission`, `loadLibraryPanel`, `loadApprovalQueue`
- **`reloadPanel(id)`** — forces a panel to re-fetch its data (for post-save scenarios)
- **`initApp`** — removed eager `autoLoadSubmission()` call; marking data now loads only when the teacher clicks the Grade Lessons panel
- **`fetchDashboardData`** — remains as the only network call on init (updates stats, attendance, lesson records for the dashboard panel)
- **`updateDashboardStats`** / **`getCurrentDay`** — replaced hard-coded `20` with `FP.COURSE_DAYS`

#### Impact
- Initial dashboard load drops from 3+ API calls to 1 (just `get_progress`)
- Panel-specific data (`get_test_results`, `get_latest_submission`, `get_library`, approval queue) fetches only when needed
- Tab switching after first load is instant (data is cached in JS memory)

---

## [0.25.0] - 2026-04-11

### Changed — Apps Script: dispatch tables, input validation, caching, error logging

#### Dispatch tables (Step 2.3)
- **`GET_HANDLERS`** — 12-entry map replacing the `doGet` if-else chain (11 existing + new `get_errors`)
- **`POST_HANDLERS`** — 8-entry map replacing the `doPost` if-else chain; special-case routing for examiner results (`sheet_name`) and placement test (no action) preserved via `_examiner_results` and `_submit_test` internal keys
- Adding a new endpoint is now one line in the handler map + the handler function

#### Input validation (Step 2.4)
- **`requireParam(params, key)`** — throws on missing/blank required parameters
- **`validateScore(value, min, max)`** — validates numeric score within range
- **`validateDate(value)`** — validates date string is parseable
- Applied to: `save_progress` (student_name, day_number, level), `save_marks` (student_name, day_number), `save_attendance` (student_name), `update_settings` (student_name), `_submit_test` (candidate_name), `_examiner_results` (candidate_name), `delete_library_entry` (id)

#### Caching — CacheService (Step 2.1)
- **`cacheGet(key)`** / **`cachePut(key, value)`** — JSON-safe get/put wrappers with 5-minute TTL
- **`cacheInvalidateStudent(name)`** — clears all cached data for a student (progress, settings, attendance, test results, submissions); called automatically by all POST handlers that modify student data
- **`handleGetProgress`** — cached (heaviest endpoint: reads 3 sheets + joins marks)
- **`handleGetSettings`** — cached (frequent reads from hub + i18n)

#### Targeted reads — TextFinder (Step 2.1)
- **`findLastByStudent`** — rewritten to use `TextFinder` for O(1) column lookup instead of scanning every row via `sheetToObjects`; reads only the matched row's data instead of loading the entire sheet into memory
- **`getLibraryEntries`** — reads header once to find column indices, then iterates raw array values instead of converting all rows to objects

#### Error logging (Step 2.5)
- **`logError(action, student, message, params)`** — writes errors to an "Error Log" sheet tab with timestamp, action, student, message, and truncated params
- Called automatically in both `doGet` and `doPost` catch blocks
- **`handleGetErrors`** — new GET endpoint returning the 50 most recent error log entries
- Added `get_errors` to the `GET_HANDLERS` dispatch table

---

## [0.24.0] - 2026-04-11

### Changed — Move legacy file to `legacy/`

- **`src/examiner-marking.html`** → moved to **`legacy/examiner-marking.html`** with its CSS; paths updated to reference `../src/` for shared scripts and styles. Superseded by the teacher dashboard's "Grade Placement Test" panel.
- **`src/styles/examiner-marking.css`** → moved to **`legacy/examiner-marking.css`**

---

## [0.23.0] - 2026-04-11

### Changed — Consolidate utility functions and extract magic numbers

#### Shared config (`src/scripts/config.js`)
- **`FP.COURSE_DAYS`** (20), **`FP.TEST_TOTAL_MARKS`** (80), **`FP.LESSON_DURATION_MIN`** (90) — single source of truth for course constants; previously hard-coded across 15+ locations

#### Shared utilities (`src/scripts/utils.js`)
- **Expanded from 1 to 7 functions** — consolidated duplicated helpers from hub.js, student-test.js, and checkpoint.js:
  - `formatDate(dateStr, style)` — long ("10 April 2026") or short ("10 Apr") formatting
  - `formatLessonDate(raw)` — short date alias for lesson displays
  - `formatTimeSpent(val)` — minutes display, filters malformed clock strings
  - `formatDuration(ms)` — "Xm Ys" from milliseconds
  - `formatPlayTime(ms)` — "Xs listened" from milliseconds
  - `timeAgo(timestamp)` — bilingual relative time display

#### Files cleaned up
- **`src/scripts/hub.js`** — removed `formatDate`, `formatLessonDate`, `formatTimeSpent`; replaced 9 hard-coded `20` and 1 hard-coded `80` with `COURSE_DAYS` / `TOTAL_MARKS` constants
- **`src/scripts/student-test.js`** — removed `formatDuration`, `formatPlayTime` (now from utils.js)
- **`src/scripts/student-lesson.js`** — `LESSON_DURATION` now uses `FP.LESSON_DURATION_MIN`; course day cap uses `FP.COURSE_DAYS`
- **`src/scripts/examiner-panel.js`** — total score display uses `FP.TEST_TOTAL_MARKS`
- **`src/scripts/checkpoint.js`** — removed local `timeAgo` (now from utils.js)
- **`src/scripts/teacher-portal.js`** — removed inline `escHtml` (now uses shared utils.js)
- **`teacher.html`** — added `utils.js` script include
- **`src/student-initial-test.html`** — added `utils.js` script include (required by checkpoint.js)

---

## [0.22.0] - 2026-04-11

### Added — ESLint and Prettier

#### New files
- **`eslint.config.mjs`** — ESLint 9 flat config targeting browser globals, FluentPath shared globals (`FP`, `escHtml`, `Checkpoint`, `VideoCall`, `I18n`), and rules tuned for a multi-file `<script>` tag codebase (onclick-called functions, shared globals via writable)
- **`.prettierrc`** — single quotes, trailing commas, 120-char line width
- **`package.json`** — npm scripts: `lint`, `lint:fix`, `format`, `format:check`, `dev`

#### Bug fixes found by ESLint
- **`src/scripts/i18n.js`** — removed duplicate `'Write your response here…'` key in translation strings; simplified webhook detection to use `FP.WEBHOOK_URL` directly instead of checking for page-level `WEBHOOK_URL` / `GOOGLE_SHEET_WEBHOOK` globals
- **`src/scripts/student-lesson.js`** — fixed undefined `progressBar` reference on lesson completion screen; now uses `document.getElementById('progressBar')` consistently

#### Result
- `npm run lint` passes with **0 errors, 0 warnings**
- Prettier config ready — run `npm run format` for a dedicated formatting pass

---

## [0.21.0] - 2026-04-11

### Changed — Extract CSS from HTML files into `src/styles/`

All inline `<style>` blocks have been moved to separate `.css` files under `src/styles/`. Existing shared CSS (`theme.css`, `mobile.css`) also moved there. HTML files now contain only markup.

| HTML File | New CSS File | Lines |
|-----------|-------------|------:|
| `index.html` | `src/styles/hub.css` | 100 |
| `teacher.html` | `src/styles/teacher-portal.css` | 42 |
| `src/student-initial-test.html` | `src/styles/student-test.css` | 774 |
| `src/student-course.html` | `src/styles/student-lesson.css` | 310 |
| `src/examiner-panel.html` | `src/styles/examiner-panel.css` | 330 |
| `src/examiner-marking.html` | `src/styles/examiner-marking.css` | 348 |

---

## [0.20.0] - 2026-04-11

### Changed — Extract JavaScript from HTML files

All inline `<script>` blocks have been moved to separate `.js` files. HTML files now contain only markup and CSS. No logic was changed — this is a pure structural extraction.

| HTML File | New JS File | Lines |
|-----------|-------------|------:|
| `index.html` | `src/scripts/hub.js` | 366 |
| `teacher.html` | `src/scripts/teacher-portal.js` | 34 |
| `src/student-initial-test.html` | `src/scripts/student-test.js` | 751 |
| `src/student-course.html` | `src/scripts/student-lesson.js` | 1,665 |
| `src/examiner-panel.html` | `src/scripts/examiner-panel.js` | 2,028 |

All JS files grouped under `src/scripts/`. Script load order preserved — each HTML file loads the new `.js` file in the same position as the original inline script, followed by any subsequent scripts (video-call.js, i18n.js).

---

## [0.19.0] - 2026-04-11

### Fixed — innerHTML XSS Hardening

#### Shared utilities (`src/utils.js`)
- **`escHtml()` now escapes single quotes** — added `&#39;` replacement so values are safe inside single-quoted HTML attributes and `onclick` handlers (previously only escaped `&`, `<`, `>`, `"`)

#### Examiner marking (`src/examiner-marking.html`)
- **`addChip()`** — `label`, `ans`, and `detail` parameters now escaped with `escHtml()` before DOM insertion; previously interpolated raw student MCQ answers into innerHTML
- **`buildCEFRRef()`** — `b.level` and `b.desc` now escaped (defensive; values are currently hardcoded constants)
- **Added `utils.js` script include** — page was using `escHtml()` calls without loading the shared utility

#### Teacher dashboard (`src/examiner-panel.html`)
- **Approval queue** — `l.id` now escaped with `escHtml()` in all `onclick` handlers and `id` attributes (6 occurrences across `renderApprovalQueue` and `renderLessonPreviewContent`)
- **Focus tags** — `opt` values now escaped in `buildFocusTags()` onclick handlers and button text (defensive; values are currently from a hardcoded constant)

---

## [0.18.0] - 2026-04-11

### Added — Token-Based API Authentication

#### Apps Script (`apps-script.js`)
- **Two-tier auth system** — all requests validated against `APP_SECRET` (Script Property); teacher-only endpoints (grading, settings, attendance, library delete, AI summaries) additionally require `TEACHER_SECRET`
- **`validateToken(params)`** / **`validateTeacherToken(params)`** — check request tokens against Script Properties; first-run grace period skips validation if no secrets are configured yet
- **`TEACHER_ACTIONS` map** — declarative list of actions requiring teacher-level auth
- **Unauthorized responses** — requests with missing or invalid tokens receive `{ error: 'Unauthorized' }` with no data leakage

#### Shared config (`src/config.js`)
- **`FP.APP_TOKEN`** / **`FP.TEACHER_TOKEN`** — placeholder token fields (empty by default, overridden by `config.local.js`)

#### Shared API wrapper (`src/api.js`)
- **`_appendToken(url)`** — internal helper that appends `token` and `teacher_token` query params to GET and JSON POST URLs
- **`postForm`** — injects `token` and `teacher_token` into the form body automatically
- **`postJson`** — appends tokens to the URL via `_appendToken` (body stays pure JSON)

#### New file: `src/scripts/config.local.js` (gitignored)
- Template file for local token overrides; included by all HTML pages after `config.js`

#### All HTML pages
- Added `<script src="config.local.js">` after `config.js` in: `index.html`, `teacher.html`, `student-initial-test.html`, `student-course.html`, `examiner-panel.html`, `examiner-marking.html`

#### Student course (`src/student-course.html`)
- **Audio upload** — direct `fetch` call now includes `token` query parameter

#### `.gitignore`
- Added `src/config.local.js` to prevent secrets from being committed

---

## [0.17.0] - 2026-04-11

### Changed — Grading Panel Overhaul

#### Teacher dashboard (`src/examiner-panel.html`)
- **"Mark" → "Grade" rename** — all user-facing labels changed: sidebar nav ("Grade Placement Test", "Grade Lessons"), panel headers ("EXAMINER GRADING", "Grade Lessons"), stats ("Lessons Graded"), slider sections ("GRADE: TASK COMPLETION", "GRADE: SPEAKING CRITERIA"), summary ("LESSON TOTAL (graded)"), status messages, and overlay text
- **Writing tab restructured** — now shows Warm-up Response, Vocabulary Practice, and Writing Task above the grading sliders (previously only showed writing + vocab)
- **Speaking tab cleaned up** — shows Conversation Transcript and audio players with drill transcripts; removed redundant "Pronunciation Drills" text block that showed "(none)"
- **All Responses tab → Listening & Comprehension** — displays listening and practice answers as colour-coded chips (green ✓ for correct, red ✗ for incorrect) matching placement test styling; score headers show X/Y totals
- **Final Score includes all skills** — summary grid expanded from 2 boxes (Writing /25, Speaking /20) to 4 (+ Listening, + Comprehension auto-scored from student answers); grand total dynamically sums all four with variable denominator
- **Graded/ungraded badge** — new pill badge on the student submission header card showing "GRADED" (green) or "UNGRADED" (amber) based on `has_marks`
- **Tab switching fix** — `showMarkTab` uses exact text matching via a map instead of `.includes()`, so "Final Score" tab correctly highlights
- **Email & sheet saves** — `sendResultsEmail` and `saveToSheet` include listening/comprehension scores in totals

#### Student course (`src/student-course.html`)
- **Per-question correctness tracking** — `selectListeningOpt` and `selectPracticeOpt` now save `_correct` (correct answer index) and `_is_right` (1/0) per question into `answers_json`, enabling green/red chip display in the teacher dashboard

### Added — Save Overlay (all pages)

#### Shared (`src/api.js`)
- **`FP.showSaveOverlay(msg)`** / **`FP.updateSaveOverlay(msg)`** / **`FP.hideSaveOverlay()`** — full-screen blocking overlay with spinner and message; prevents clicks, navigation, and interaction while an async save is in progress; dynamically created on first use; assigned directly on `FP` (no IIFE) for reliable availability

#### Student course (`src/student-course.html`)
- **`finishLesson`** — overlay shown from audio upload through save + verification; "View Progress" link hidden until save completes
- **Save status styling** — bumped from 13px italic to 18px bold with coloured background card

#### Placement test (`src/student-initial-test.html`)
- **`submitResults`** — overlay blocks interaction during Formspree + Google Sheet dual submission

#### Teacher dashboard (`src/examiner-panel.html`)
- **`savePlacementToSheets`**, **`saveAttendance`**, **`saveToSheet`** — each wrapped with overlay during the async POST

#### Examiner marking (`src/examiner-marking.html`)
- **`saveToSheets`** — overlay during examiner results save

### Fixed — Student Course Bugs

#### Student course (`src/student-course.html`)
- **Back button removed** — removed the Back button from lesson navigation to prevent students from losing answers when going back; the nav area is now forward-only
- **Nav hidden during loading** — the Continue button is hidden while the AI lesson is being generated and only appears after content loads
- **Drill recording is user-controlled** — pronunciation drills now use `continuous: true` and a toggle pattern; the student clicks to start and clicks again to stop, instead of the recording auto-stopping after the first utterance
- **`saveProgress`** — now shows an informative warning when save fails instead of a misleading "Demo mode" message
- **`finishLesson`** — added try-catch around recognition/drill cleanup so errors in stopping recordings can't prevent the save from running
- **`stopDrill`** — added null checks for DOM elements (drill button, transcript, feedback) so calling it after the speaking step DOM is removed doesn't crash
- **Save verification** — after saving, the lesson completion screen reads back progress from the sheet to confirm the save landed; shows a warning if the day isn't found
- **Timer resume fix** — `startTimer` accepts optional `initialElapsed` parameter; checkpoint resume no longer has a race condition resetting elapsed time

#### Hub page (`index.html`)
- **Lesson order** — completed lessons sorted by day number ascending (was showing in sheet-append order)
- **Date formatting** — raw ISO timestamps (`2026-04-10T04:00:00.000Z`) now formatted as short dates ("10 Apr")
- **Time display** — filters out malformed time values (clock strings like "8:53:11 a.m.") that leaked into the time_spent field

#### Apps Script (`apps-script.js`)
- **`handleGetProgress`** — lessons are now sorted by `day_number` ascending so the hub page displays them in correct order

### Fixed — Teacher Dashboard Bugs

#### Apps Script (`apps-script.js`)
- **`handleGetProgress`** — joins Lesson Marks sheet to include `writing_score`, `speaking_score`, and `answers_json` per lesson in progress data (fixes empty marks in progress tracker and skills snapshot)
- **`handleGetLatestSubmission`** — accepts optional `day` query param to fetch a specific submission instead of only the latest ungraded one
- **`handleGetAllSubmissions`** — new GET endpoint returning a lightweight list of all submitted lessons with graded status (supports lesson picker dropdown)
- **`handleGetLibrary`** — validates `level` is non-empty and `day` is a valid integer ≥ 1; skips malformed entries that produced broken grouping keys

#### Student course (`src/student-course.html`)
- **`selectListeningOpt`** — tracks `listening_correct` and `listening_total` in `state.answers` for score display in teacher dashboard
- **`selectPracticeOpt`** — tracks `practice_correct` and `practice_total` in `state.answers`
- **`saveProgress`** — increased `answers_json` truncation from 3 000 → 5 000 chars; passes `maxValueLength: 5000` to `postForm` to avoid the default 2 000-char limit in `_encodeForm`

#### Teacher dashboard (`src/examiner-panel.html`)
- **Lesson picker** — new `<select id="day-picker">` dropdown populated via `get_all_submissions`; `loadSpecificDay()` fetches a chosen day's submission; shows "✓ graded" badge per entry
- **"All Responses" tab** — new tab between Speaking and Final Score showing warmup response, vocabulary practice, listening answers (with score), and comprehension/practice answers parsed from `answers_json`
- **Drill transcripts** — `renderSpeakingAudio` now displays the student's spoken text as a styled quote block alongside each drill's audio player (parsed from `answers_json` drill keys)
- **Progress tracker columns** — added Warmup, Vocab, Listening, and Practice columns; `fetchDashboardData` stores `answersJson` per lesson record; `updateLessonRecord` parses it to show ✓/score/— per activity type
- **Skills snapshot** — auto-fixes now that `handleGetProgress` returns marks data (no additional code change needed)

### Added — Save Overlay (all pages)

#### Shared (`src/api.js`)
- **`FP.showSaveOverlay(msg)`** / **`FP.updateSaveOverlay(msg)`** / **`FP.hideSaveOverlay()`** — full-screen blocking overlay with spinner and message; prevents clicks, navigation, and interaction while an async save is in progress; dynamically created on first use so no HTML changes are needed per page

#### Student course (`src/student-course.html`)
- **`finishLesson`** — overlay shown from audio upload through save + verification; "View Progress" link remains hidden until overlay dismisses

#### Placement test (`src/student-initial-test.html`)
- **`submitResults`** — overlay blocks interaction during Formspree + Google Sheet dual submission

#### Teacher dashboard (`src/examiner-panel.html`)
- **`savePlacementToSheets`**, **`saveAttendance`**, **`saveToSheet`** — each wrapped with overlay during the async POST

#### Examiner marking (`src/examiner-marking.html`)
- **`saveToSheets`** — overlay during examiner results save

### Fixed — Student Course Bugs

#### Student course (`src/student-course.html`)
- **Back button removed** — removed the Back button from lesson navigation to prevent students from losing answers when going back; the nav area is now forward-only
- **Nav hidden during loading** — the Continue button is hidden while the AI lesson is being generated and only appears after content loads
- **Drill recording is user-controlled** — pronunciation drills now use `continuous: true` and a toggle pattern; the student clicks to start and clicks again to stop, instead of the recording auto-stopping after the first utterance
- **`saveProgress`** — now shows an informative warning when save fails instead of a misleading "Demo mode" message
- **`finishLesson`** — added try-catch around recognition/drill cleanup so errors in stopping recordings can't prevent the save from running
- **`stopDrill`** — added null checks for DOM elements (drill button, transcript, feedback) so calling it after the speaking step DOM is removed doesn't crash
- **Save verification** — after saving, the lesson completion screen reads back progress from the sheet to confirm the save landed; shows a warning if the day isn't found

#### Apps Script (`apps-script.js`)
- **`handleGetProgress`** — lessons are now sorted by `day_number` ascending so the hub page displays them in correct order

### Fixed — Attendance Not Persisted to Google Sheets

#### Apps Script (`apps-script.js`)
- **`Attendance` sheet** — new sheet with columns: `student_name`, `attendance_json`, `absence_notes`, `updated_at`
- **`handleGetAttendance(student)`** — new GET endpoint returning the stored attendance JSON and absence notes
- **`save_attendance` POST action** — upserts attendance data per student using `upsertByStudent`

#### Teacher dashboard (`src/examiner-panel.html`)
- **`saveAttendance`** — now POSTs attendance map and absence notes to the `save_attendance` endpoint (falls back to localStorage-only when no webhook is configured)
- **`fetchAttendanceFromSheet`** — new function called during `fetchDashboardData`; loads attendance from the sheet and merges with local state so data survives browser/device changes

---

## [0.16.1] - 2026-04-10

### Fixed — Speaking Audio Upload Errors

#### Apps Script (`apps-script.js`)
- **`handleSaveAudio`** — wrapped `getAudioFolder()` in try/catch so a DriveApp permission error returns a descriptive message ("Run authorizeScript()…") instead of crashing the entire handler
- **`handleSaveAudio`** — returns an explicit error when no recordings are found in the request body (helps diagnose parse failures)
- **`handleGetAudio(fileId)`** — new GET action that reads a Drive file by ID and returns its content as base64 with MIME type; serves as a CORS-safe proxy for audio playback
- **`doPost` save_audio branch** — validates that the parsed body contains `recordings` before proceeding; returns a diagnostic error including `postData.type` when parsing fails
- **`get_audio` GET action** — added to `doGet` routing

#### Student course (`src/student-course.html`)
- **`uploadAudioRecordings`** — logs server-side errors and warnings to the console instead of silently swallowing them
- **`finishLesson`** — shows a warning message when audio upload fails so students know their written work is still saved
- **`uploadAudioRecordings`** — added `redirect: 'follow'` to the fetch call for explicit redirect handling

---

## [0.16.0] - 2026-04-10

### Added — Speaking Audio Review (Proposal 1)

#### Student recording (`src/student-course.html`)
- **`getAudioMimeType()`** — detects the best supported MIME type in priority order: `audio/webm;codecs=opus`, `audio/webm`, `audio/mp4` (Safari), `audio/ogg`; ensures recordings work on iPhone/Safari
- **`blobToBase64(blob)`** — converts a recorded Blob to a base64 string for upload
- **`uploadAudioRecordings()`** — encodes all recordings to base64 and POSTs them as JSON to the `save_audio` Apps Script action; returns the `speaking_audio_json` string on success
- **`startDrill`** — now runs `MediaRecorder` alongside `SpeechRecognition` per drill; stores the resulting Blob in `audioRecordings[drillId]`; stores phonetic word-match score (`drill_${id}_score`) in `state.answers`
- **`toggleConvRecording`** — now starts/stops `convMediaRecorder` alongside `SpeechRecognition`; stores the conversation Blob in `audioRecordings['conversation']`
- **`finishLesson`** — shows "Uploading your recordings… please wait." message before saving; uploads audio then calls `saveProgress` with the resulting `speaking_audio_json`
- **`saveProgress`** — accepts `speakingAudioJson` parameter and includes `speaking_audio_json` field in the Course Progress payload

#### Apps Script (`apps-script.js`)
- **`speaking_audio_json` column** added to `Course Progress` HEADERS
- **`getOrCreateSubfolder(parent, name)`** — Drive helper to get or create a named sub-folder
- **`getAudioFolder(studentName, lessonDay)`** — resolves/creates `FluentPath Audios / <student> / Lesson <day>` folder hierarchy
- **`handleSaveAudio(body)`** — decodes base64 blobs, saves each to Drive with public viewer sharing, returns a JSON map of `{ drillKey: fileId, drillKey_score: 0.85, conversation: fileId }`; file-level errors are non-fatal (logged, skipped)
- **`save_audio` POST action** — added to `doPost`; parses JSON body (action passed via query string); returns `{ result, audio_json }`
- **JSON-body detection** — `doPost` now reads `e.postData.contents` to extract `action` when the body is `application/json` (used by `save_audio` and the existing `ai_summary` action)

#### Teacher marking panel (`src/examiner-panel.html`)
- **Audio playback section** added at the top of the Speaking card in `panel-marking`; hidden when no audio is present
- **`fetchAudioBlobUrl(fileId)`** — fetches audio from the `get_audio` Apps Script endpoint, decodes base64, and creates a local blob URL for playback
- **`renderSpeakingAudio(audioJsonStr)`** — parses `speaking_audio_json`, shows "Loading audio…" placeholders, then fetches each file via `fetchAudioBlobUrl` and renders `<audio>` players with accuracy scores
- **`displaySubmission`** — calls `renderSpeakingAudio` when populating the marking panel

---

## [0.15.0] - 2026-04-10

### Added — Lesson Library & Recycling System

#### Core algorithm (`apps-script.js`)
- **New `Lesson Library` sheet** — auto-created with columns `id`, `level`, `day`, `created_at`, `source_student`, `original_difficulty_json`, `lesson_json`, `is_active`, `times_served`; created via the existing `ensureSheetHeaders` helper, no manual schema changes needed
- **`recycleProbability(entryCount)`** — single authoritative function for the tier curve: 0–4 entries → 0 % recycle (seed phase), 5–9 → 50 %, 10+ → 80 %
- **`getLibraryEntries(level, day)`** — loads all active entries for a `(level, day)` bucket with parsed `difficulty` and `lesson` objects
- **`findLibraryMatch(entries, difficulty)`** — strict pass (all 6 sliders within ±1, ≥1 focus tag overlap if incoming has tags) then lenient pass (Manhattan distance ≤ 4, focus tags ignored); returns first match or null
- **`nearDuplicateExists(entries, difficulty)`** — dedup check for writes: true if any existing entry has all 6 sliders identical (write path only, not serve path)
- **`addToLibrary(level, day, lesson, difficulty, sourceStudent)`** — appends a row after passing the dedup check; returns false if skipped
- **`incrementTimesServed(entryId)`** — increments the `times_served` cell on a library row in-place
- **`findClosestEntry(entries, difficulty)`** — picks the entry with smallest Manhattan distance for option-C rewrites
- **`rewriteLessonForDifficulty(sourceLesson, targetDifficulty, level, day, apiKey, model)`** — option-C: sends source lesson + target difficulty block to Claude; keeps topic/structure, adjusts only difficulty dimensions
- **`handleGetLibrary()`** — new GET action `get_library`; returns entry counts and serve totals grouped by `(level, day)`, omits `lesson_json` for speed
- **`handleGetLibraryEntry(id)`** — new GET action `get_library_entry`; returns the full row including `lesson_json` for preview
- **`handleDeleteLibraryEntry(id)`** — new POST action `delete_library_entry`; soft-deletes by setting `is_active = 'false'` (recoverable from the sheet)

#### `handleGenerateLesson` orchestration
- Checks `aiInstructions` first: non-empty → skip library entirely and generate fresh (decision 5)
- Loads library entries, rolls against `recycleProbability`: if recycling fires, attempts `findLibraryMatch` → if hit, increments `times_served` and returns cached lesson (`source: 'library'`); if miss, attempts option-C rewrite (`source: 'rewrite'`); rewrite failures fall back to fresh generation
- Fresh-generated lessons are written back to the library unless `aiInstructions` was non-empty (decision 6)
- All writes pass through the dedup check (decision 9) — no near-duplicate entries bloat the library
- Response now includes a `source` field: `'library'` | `'rewrite'` | `'fresh'` (client ignores this; useful for debugging)

#### Teacher Dashboard — Lesson Library panel (`examiner-panel.html`)
- **New "Lesson Library" sidebar link** under COURSE section
- **Stats row**: Total Entries / Times Recycled / Days Seeded (5+)
- **6 × 20 grid** (one row per CEFR level, 20 columns for lesson days): cells colour-coded red (0), yellow (1–4), green (5–9), blue (10+); hover enlarges the cell; clicking opens the entry list modal
- **Entry list modal**: shows `id` (short), source student, created date, difficulty profile summary, times-served badge; entry-level Preview and Delete buttons
- **Preview**: fetches and displays a compact lesson summary (topic, objective, vocab words, writing prompt, key takeaways) without loading the full JSON blob
- **Soft-delete**: confirms before acting; updates local cache and re-renders the grid and modal immediately without a full page reload
- **Recycled badge on Dashboard**: two new stat boxes ("Library Entries" / "Times Recycled") appear on the overview panel; populated the first time the Lesson Library panel is opened

---

## [0.14.0] - 2026-04-09

### Fixed — AI Lesson Generation Now Actually Works
- **Wired up Claude API in `apps-script.js`** — added `handleGenerateLesson(level, day, topic, allowSpanish, studentName)` that calls the Claude Messages API via `UrlFetchApp.fetch` (model: `claude-haiku-4-5` by default, configurable via `CLAUDE_MODEL` Script Property); strips markdown code fences and parses the JSON before returning
- **`generate_lesson` GET action** added to `doGet` so the response is CORS-readable (the previous client used `postForm` with `mode: 'no-cors'`, which made the response opaque and unreadable)
- **Rewrote `generateLesson()` in `student-course.html`** — now calls `FP.api.get(...?action=generate_lesson&level=&day=&topic=&spanish=&student=)`, caches the returned lesson in localStorage by `fp_lesson_<level>_d<day>` so reloads don't re-bill the API, and falls back gracefully on error
- **Replaced single hardcoded `getFallbackLesson()` with 5-lesson library** — distinct topics (appointments, shopping, workplace, health, family/community) cycled by `(day - 1) % 5`; each is a complete lesson template with vocab, listening, speaking, practice, and writing
- **Offline banner** — when AI generation fails and the fallback fires, a yellow banner appears at the top of the lesson screen so the teacher knows to fix the API key
- **Hardened `doPost` fallthrough** — unknown POST `action` values previously fell through to `safeAppendRow('Initial Test Results', ...)`, silently writing empty rows into the test results sheet every time the broken `generate_lesson` POST ran; now the default branch only fires when `action` is empty (placement test submission), and unknown actions return an error response

### Added — Teacher Difficulty Profile Influences AI Lessons
- **`difficulty_json` column on Settings sheet** — single new column holds the teacher's difficulty profile, focus tags, and AI instructions as JSON; auto-added to existing sheets on first sync (no manual schema change needed)
- **`saveDifficulty()` and `saveFocusAreas()` now sync to Sheets** — previously these only wrote to the teacher's localStorage, so the student's lesson generator could never see them; new `syncDifficultyToSheet()` helper POSTs `update_settings` with just `student_name` and `difficulty_json`
- **`update_settings` is now a partial-update merge** — apps-script reads the existing Settings row first, only overwriting fields explicitly present in the request; previously, sending a partial update would have wiped unrelated fields (teacher_name, cefr_level, allow_spanish, etc.)
- **`handleGenerateLesson` reads the student's difficulty profile** from the Settings sheet, parses `difficulty_json`, and folds it into the Claude prompt via a new `buildTeacherGuidanceBlock()` helper that translates 1–5 sliders into qualitative descriptors and concrete numeric overrides (e.g. vocabulary count, writing minWords)
- **Caching note**: lesson cache is per `(level, day)` and is *not* invalidated on profile changes, matching the existing UI promise that *"Changes apply to the next generated lesson"* — i.e. unopened days reflect the new profile, already-generated days do not

### Hardened — Sheet Schema Safety
- **`upsertByStudent` now uses actual sheet headers** instead of the `HEADERS` constant — previously, extending a `HEADERS` entry would have misaligned rows in any pre-existing sheet; new `ensureSheetHeaders()` helper appends missing columns to the sheet on the right and is shared by both `safeAppendRow` and `upsertByStudent`
- **`upsertByStudent` student-row lookup is now O(rows) instead of O(rows × cols)** — uses `getRange` on just the name column rather than reading the whole sheet via `getDataRange`

### Setup
Requires adding `CLAUDE_API_KEY` to the Apps Script project's Script Properties — see header comment in `apps-script.js`. The `difficulty_json` column is added to the Settings sheet automatically the first time the teacher saves a profile or difficulty change.

---

## [0.13.0] - 2026-04-07

### Changed — Teacher Student Picker & Auto-Registration
- **Student picker on teacher portal** — `teacher.html` now fetches registered students from Google Sheets and displays them as selectable cards; selecting a student navigates directly to the dashboard with that student loaded
- **Auto-registration** — new students are automatically added to the "Students" tab (with name and join date) when they first visit the student hub and `get_progress` is called
- **`get_students` endpoint** — new Apps Script GET action returns the full student list from the "Students" sheet
- **Removed setup screen gate** — `examiner-panel.html` no longer requires teacher name, student name, and CEFR level to be entered manually; student name comes from URL parameter (or localStorage for returning visits), CEFR level is fetched from Google Sheets automatically
- **Hardcoded teacher name** — teacher name set to "Sebastian Galindo" everywhere (state, profile, emails, Google Sheets sync); teacher name field in Student Profile panel is now read-only
- **Setup screen simplified** — reduced to a single student name input as a fallback; links back to teacher portal for the recommended flow

---

## [0.12.0] - 2026-04-07

### Changed — Optional Video Calls for Students
- **Video call no longer required to begin** — removed the mandatory Jitsi connection gate from both `student-initial-test.html` and `student-course.html`; "Begin Test" and "Begin Today's Lesson" buttons are now enabled immediately
- **Floating "Join Video Call" button** — students now see the same optional floating panel (bottom-right corner) that teachers already have, instead of the inline required embed
- **Removed inline video call container** — the `#videoCallContainer` div, connection status bar, and "Join the video call above to begin" hint text removed from both student cover screens

---

## [0.11.0] - 2026-04-06

### Fixed — Placement Test Slider Persistence & Settings Panel
- **Slider score displays now update reliably** — added `_ptRestoring` guard flag to prevent `savePTGradedState()` from overwriting graded data mid-restoration; `updatePTSlider` and `updatePTSubCriteria` skip saves during restore cycles
- **Scores persist across page reloads** — sheet data and localStorage now layer correctly: sheet values load first, localStorage supplements any gaps; original localStorage snapshot preserved so intermediate saves can't corrupt it
- **Q14 sub-criteria persist** — sub-criteria sliders (Task Achievement, Grammar, Vocabulary, Coherence) now restore from localStorage like other sliders
- **Corrupted notes filtered** — restoration skips notes that are bare numbers (artefact of a prior save-during-restore bug that wrote slider values into notes fields)
- **Added `onchange` fallback** on all placement test range inputs for browsers that don't fire `oninput` reliably during drag
- **Added "Reset Grading Data" button** to the placement test panel — clears all slider scores, notes, and feedback from both DOM and localStorage
- **Added 3 missing settings to teacher profile** — "Allow Spanish UI hints", "Allow skip placement test", and "Allow retake placement test" toggles with toggle-switch UI; syncs to Google Sheets via `update_settings` POST on save
- **Settings state persisted** — `allowSpanish`, `allowSkipTest`, `allowRetakeTest` added to `ex` state, `saveToLocalStorage`, and `initApp` form population

---

## [0.10.0] - 2026-04-06

### Changed — Shared Fetch Wrapper, Hub Data Flow & Checkpoint Auto-Resume
- **Created `src/api.js`** — shared fetch wrapper (`FP.api`) with 30-second `AbortController` timeout, consistent error handling, and form-encoding utility; exposes `get()`, `postForm()`, and `postJson()` methods
- **Migrated all 14 raw `fetch()` calls** across 6 files (index.html, student-initial-test.html, student-course.html, examiner-panel.html, examiner-marking.html, i18n.js) to use `FP.api`
- **Removed manual `AbortController` boilerplate** from student-course.html lesson generation (now handled by the wrapper)
- **Removed manual form-encoding boilerplate** from all `no-cors` POST calls (now handled by `FP.api.postForm()`)
- **Simplified hub data flow** — `fetchProgress()` now fetches progress + settings in parallel (`Promise.all`), caches the combined result as a single `fp_hub_cache` JSON entry, and falls back through cached state → individual localStorage keys
- **Fixed settings never loaded on success** — teacher preferences (skip test, retake test) were previously only fetched when the progress request failed; now always fetched in parallel
- **Added `FP.KEYS.HUB_CACHE`** to config.js; hub `syncIndividualKeys()` and `buildDefaultProgress()` now use `FP.KEYS` constants
- **Checkpoint auto-resume** — recovery modal now shows a 60-second countdown with a shrinking progress bar; auto-resumes when the timer expires so reloaded sessions don't stay stuck on the modal
- **ESC key dismisses modal** — pressing Escape resumes by default, matching the safest action
- **Bilingual countdown text** — "Auto-resuming in Xs / Continuación automática en Xs"
- **i18n DOM batching** — `addSectionIcons()` uses `data-i18n-icon` attribute instead of `querySelector` per element; step counter scan targets specific tag types instead of `querySelectorAll('*')`; `clearAll()` batched from 4 DOM passes to 2; teacher approval result cached after first fetch
- **Video call re-init guard** — split `init()` (once-only, returns false on re-call) and new `updateRoom(studentName, date)` (re-callable); fixes potential race conditions from repeated `init()` calls on student-course.html
- **Lesson history pagination** — hub shows last 5 completed lessons by default with a "View all X lessons" toggle; prevents long lists from pushing the CTA button off screen
- **Removed dead comments and code** — deleted ~30 lines of comments referencing removed approval workflow, old webhook documentation block, deprecated `getDayNumber()` function, dead `loadSubmission()` wrapper, vestigial `check_approval` endpoint in Apps Script, and stale "transcript toggle removed" comment

---

## [0.9.0] - 2026-04-05

### Changed — Shared Configuration, Utilities & Theme
- **Created `src/config.js`** — single source of truth for webhook URL, Formspree endpoint, CEFR level metadata (`FP.LEVELS`), and localStorage key names (`FP.KEYS`); removed hardcoded URLs from 5 HTML files
- **Created `src/utils.js`** — shared `escHtml()` function; removed 3 duplicate implementations (index.html, student-course.html, examiner-panel.html)
- **Created `src/theme.css`** — shared CSS custom properties and Google Fonts import; removed duplicate `:root` blocks and font `<link>`/`@import` tags from 5 HTML files
- **Standardised variable names** — all files now reference `FP.WEBHOOK_URL` via local aliases (`WEBHOOK_URL` or `GOOGLE_SHEET_WEBHOOK`)

---

## [0.8.3] - 2026-04-05

### Fixed — Placement Test & Lesson Marking Score Persistence
- **Placement test graded scores now load** — Apps Script `get_test_results` returns previously graded data from "Examiner Results" sheet (individual question scores, notes, feedback, CEFR level)
- **Lesson marking grades now load** — Apps Script `get_latest_submission` returns existing marks from "Lesson Marks" sheet (writing/speaking breakdowns, feedback)
- **Individual question scores saved** — `savePlacementToSheets()` now writes `score_q11`–`score_q24` to the Examiner Results sheet, not just section totals
- **Examiner Results uses upsert** — changed from `safeAppendRow` (duplicate rows on re-grade) to `upsertByStudent` (updates existing row)
- **Placement test sliders persist** — graded slider values, Q14 sub-criteria, and per-question notes saved to localStorage via `savePTGradedState()`; restored on reload from sheet data first, localStorage fallback
- **Lesson marking sliders persist** — writing and speaking slider values saved to localStorage via `saveMarksToLocalStorage()`; restored from sheet breakdown JSON first, localStorage fallback
- **Debounced auto-save** — placement test notes trigger a 2-second debounced save; sliders save immediately

---

## [0.8.2] - 2026-04-05

### Fixed — Teacher Dashboard Data Display
- **Placement test panel layout** — moved panel inside `.main-content` div; was rendering outside the sidebar layout (broken positioning)
- **Dashboard stats populated** — "Avg. Lesson Time" stat now calculates from lesson records; "Recent Lesson Activity" section now shows last 5 lessons with scores and attendance
- **`getCurrentDay()` fixed** — now uses actual course progress (attendance/lesson count) instead of calendar day of month (e.g. April 5 ≠ Day 5)
- **Textarea values restored on reload** — teacher notes, absence notes, writing/speaking feedback, overall feedback, and AI instructions now persist across page reloads via localStorage
- **Profile email restored** — student email now populates both the profile form and the marking send-results form on reload
- **Skills snapshot listening bar** — listening progress bar now calculates from weekly summary ratings instead of always showing 0%; vocabulary bar also uses weekly summary data when available
- **Google Sheets dashboard sync** — `fetchDashboardData()` now fetches course progress from Google Sheets on init, merges lesson records with localStorage, and syncs CEFR level changes

---

## [0.8.1] - 2026-04-05

### Fixed — Bug Fixes & Hardening
- **Placement test auto-score denominator** corrected from `/35` to `/30` (true auto-scored max: Reading 20 + Listening auto 10)
- **Spanish accent marks** fixed in checkpoint.js recovery modal — "hace ms de un da" → "hace más de un día"
- **AI weekly summary** replaced broken direct Anthropic API call (missing auth header + CORS blocked) with Apps Script proxy route and clear fallback message
- **XSS hardening** in teacher dashboard — added `escHtml()` to unescaped Google Sheets data (level, day, date, status) in innerHTML assignments
- **Speech recording browser check** — speaking step now detects unsupported browsers (non-Chrome/Edge), shows bilingual warning banner, and disables recording buttons instead of silently failing
- **Student name validation** on hub — max 100 characters, letters/accents/hyphens/apostrophes only, with `maxlength` attribute and `aria-label` for accessibility
- **Lesson generation timeout** — added 30-second `AbortController` on the Apps Script fetch and a 45-second safety timeout on the loading spinner to prevent infinite loading state

---

## [0.8.0] - 2026-04-05

### Changed — Placement Test Improvements
- **Auto-fill name** from hub (localStorage) and make date read-only
- **Listening stop button** with cumulative play-time tracking for both main passage and dictation
- **Required + skip** on all writing questions (Q11-Q14, Q20) with "Skip this question" checkbox
- **All speaking textareas required** (Q21-Q24)
- **Speech recording** added to speaking section (Q21-Q24) using Web Speech API with live transcript
- **Video call room name** now displayed with shareable link so teacher knows which room to join
- **Translation activated** with `I18n.setLevel('test')` for tap-to-translate mode
- **"Return to FluentPath"** button on results screen (removed "Take Test Again")
- **Re-take test** option on hub when teacher enables `allow_retake_test`

### Changed — Course Page Improvements
- **Auto-fill name, date (read-only), and level** from localStorage
- **Level grid locked** when CEFR level is assigned — greyed out with "Assigned by your teacher" note
- **Approval workflow removed** — `startCourse()` goes straight to lesson generation
- **Course day number** uses last completed + 1 (not day of month)
- **Required + skip** on all text questions (warm-up, vocabulary practice, writing, review notes)
- **Listening stop button** with play-time tracking
- **Pronunciation drill fix** — replaced inline onclick string interpolation with data-attributes to prevent apostrophe SyntaxError
- **Claude API call removed** (CORS blocked from browser) — uses built-in fallback lesson; placeholder for future Apps Script proxy
- **Speech recognition error handling** improved with console logging and mic permission alerts
- **Lesson complete** links back to hub with "View Progress & Next Lesson" button; shows "Course Day X / 20"
- **Hub enhanced** with completed lessons list (day, topic, time, confidence, date)

### Changed — Full Spanish Translation Coverage
- **41 new translation strings** added to `i18n.js`: step titles, listening/speaking status, recording feedback, review section, completion screen, button text
- **`tr()` runtime helper** added to course page for JS-set `.textContent` strings at A1/A2 level
- **`biText()` applied** to all hardcoded template strings in render functions
- **Course content selectors** added to i18n.js (`.ac-label`, `.ac-heading`, `.ac-body`, `.ai-label`, `.ai-status`)
- **AI prompt modified** to generate `_es` suffix keys for bilingual A1/A2 lessons
- **All render functions updated** to use `biText()` for dynamic AI content

### Changed — Teacher Dashboard Fixes
- **Webhook URL hardcoded** — removed from setup screen and profile form
- **Lesson approvals removed** — sidebar link, panel HTML, pending badge, and all approval JS functions
- **Auto-populate marking** — placement test and lesson marking auto-load when panel is opened
- **Null-safe `updateDashboardStats`** — prevents TypeError when elements are missing
- **Writing answers robust** — tries multiple field name formats, shows "(no response)" for empty
- **CORS error handling** — graceful fallback to demo data with console warnings

### Changed — Infrastructure
- **Webhook URLs synced** across all files to new Apps Script deployment
- **Google Apps Script rewritten** (`apps-script.js`) with `doGet` handler for 5 actions, `safeAppendRow` for column-safe writes, and proper CORS support
- **DDEV local server** configured for development (no more push-to-test)
- **Dead approval code removed** from course page (`requestApproval`, `startPolling`, `checkApproval`, `APPROVAL_CHECK_URL`)
- **Skip placement test** option on hub when teacher allows via Google Sheets Settings

---

## [0.7.1] - 2026-04-05

### Added — Skip Placement Test Option
- Student hub now fetches teacher settings on login to check `allow_skip_test`
- When the test hasn't been taken and the teacher allows it, a "Skip to Course" button appears below the main placement test CTA
- Added `allow_skip_test` field to the Settings tab in `GOOGLE_SHEETS_SCHEMA.md`

---

## [0.7.0] - 2026-04-05

### Changed — Level-Aware Translation System
- Rewrote `src/i18n.js` from a single-mode language toggle to a CEFR level-aware system with 4 distinct modes:
  - **A1/A2 (spanish-primary):** UI displayed in Spanish with English as smaller help text below
  - **B1/B2 and placement test (tap-to-translate):** UI in English; tap/click any translatable text to see a Spanish tooltip that auto-dismisses after 4 seconds
  - **C1 (teacher-gated):** UI in English with a toggle that activates tap-to-translate only after teacher approval via Google Sheets
  - **C2 (english-only):** No translation available; section icons only
- Removed the old floating language selector widget
- Course page calls `I18n.setLevel()` when the student selects their level
- Hub and test pages auto-detect level from localStorage (default: tap-to-translate)

---

## [0.6.0] - 2026-04-05

### Changed — Rebranding & Structural Overhaul
- **Rebranded** the entire platform: company name "Fluentora", product name "FluentPath"
  - Updated all page titles, headings, nav bars, footers, and UI text across all files
  - Renamed localStorage keys from `ep_*` to `fp_*` and `englishpath_*` to `fluentpath_*`
  - Updated Jitsi room prefix from `EnglishPath-` to `FluentPath-`
  - "Examiner Panel" renamed to "Teacher Dashboard" throughout
- **Split landing pages:** `index.html` is now student-only; created `teacher.html` as a separate teacher portal with links to the dashboard and marking tools
- **Required video call:** Jitsi Meet now embeds inline on the cover/landing screen of both `student-initial-test.html` and `student-course.html`; the "Begin" button is disabled until the video call connects
- **Spanish gated by teacher approval:** Language selector is greyed out by default; `i18n.js` checks the Google Sheets Settings tab for `allow_spanish` permission before enabling the Spanish toggle
- **Combined teacher interfaces:** Merged placement test marking into `examiner-panel.html` as a new "Mark Placement Test" sidebar panel with auto-scoring, manual sliders, CEFR calculation, and Google Sheets save — pulls test data from the sheet instead of pasting emails; `teacher.html` updated to single dashboard link
- **Google Sheets schema:** Created `GOOGLE_SHEETS_SCHEMA.md` documenting all 6 tabs (Initial Test Results, Examiner Results, Course Progress, Settings, Lesson Approvals, Lesson Marks) with column definitions and API actions

---

## [0.5.0] - 2026-04-05

### Added — Progress Continuity & Recovery (Option E)
- Created `src/checkpoint.js`, a generic save/load/clear API with a bilingual recovery modal
- **Placement test recovery:** State auto-saved every 5 seconds once the test begins (current screen, all MCQ and text answers, play counts, task choice); on page reload, a modal offers "Resume" or "Start Over"
- **Course lesson recovery:** State auto-saved every 5 seconds once the lesson begins (current step, all answers, AI-generated lesson content, elapsed timer); on page reload, a modal offers "Resume" or "Start Over"
- **Immediate save on navigation:** Checkpoint also saved on every screen/step change for minimal data loss
- **Automatic cleanup:** Checkpoint is cleared on test submission, test restart, and lesson completion
- **Bilingual recovery modal:** Title, message, and buttons shown in English and Spanish with a time-ago indicator ("saved 5 min ago / hace 5 min")
- Recovery modal matches the existing design system (cream/ink/rust, Playfair Display headings)

---

## [0.4.0] - 2026-04-05

### Added — Onboarding & UX Simplification (Option D)
- Created `src/i18n.js`, a self-contained internationalisation system with Spanish (es) translations for all student-facing UI
- **Language selector:** Floating widget on all pages + prominent selector on the hub welcome screen; choice persists in localStorage
- **Spanish translations** covering 120+ strings: buttons, headings, instructions, form labels, placeholders, status messages, activity labels, level names, and confidence ratings
- **Visual section icons:** Automatic emoji icons (📖 Reading, ✍️ Writing, 🎧 Listening, 🗣️ Speaking, etc.) prepended to section headings
- **Bilingual display:** Translations appear as subtle italic hints below the English text, so students learn English while understanding instructions in Spanish
- **Dynamic content support:** MutationObserver re-applies translations when the DOM changes (lesson steps, hub dashboard, etc.)
- **Extensible:** Adding a new language requires only a new key in `TRANSLATIONS` and `LANG_META`
- Included in `index.html`, `student-initial-test.html`, and `student-course.html`

---

## [0.3.0] - 2026-04-05

### Added — Mobile-First Enhancements (Option C)
- Created `src/mobile.css`, a shared stylesheet for all student-facing pages
- **iOS zoom prevention:** All inputs and textareas forced to 16px minimum font-size
- **Touch targets:** MCQ options, buttons, and interactive cards enforce 48px minimum height (WCAG compliant)
- **Sticky bottom navigation:** Lesson Continue/Back buttons anchor to the bottom of the viewport on mobile, always within thumb reach
- **Full-width primary buttons** on mobile for easier tapping
- **Larger spacing** between tappable MCQ options (12px gaps) to prevent mis-taps
- **Slimmer topbar** on mobile (46px) with non-essential info hidden
- **Small phone support** (380px breakpoint) with tighter sizing for iPhone SE and similar
- **Desktop hover enhancements** gated behind `(hover: hover)` media query so touch devices are not affected
- **Touch optimisations:** Eliminated 300ms tap delay and removed default tap highlight on all interactive elements
- Included in `index.html`, `student-initial-test.html`, and `student-course.html`

---

## [0.2.0] - 2026-04-05

### Added — Video Call Integration (Option B)
- Created `src/video-call.js`, a self-contained floating video call component using Jitsi Meet (free, no accounts required)
- Deterministic room names generated from student name + date so teacher and student auto-join the same room
- Floating panel in bottom-right corner: collapsed button state and expanded embedded video state
- Pop-out button to open the call in a full browser tab (better for mobile)
- Integrated into `student-initial-test.html` (activates when test starts)
- Integrated into `student-course.html` (activates when lesson begins after approval)
- Integrated into `examiner-panel.html` (available from the dashboard with student name pre-filled)
- Fixed `index.html` hub links to point to `src/` directory after file reorganisation

---

## [0.1.0] - 2026-04-05

### Added — Student Hub Page (Option A)
- Created `index.html` as a student landing portal with name-based login
- Journey timeline showing three milestones: Placement Test, Level Assignment, Course Progress
- Context-aware CTA button that always points to the student's next action
- Fetches progress from Google Sheets (`?action=get_progress`) with localStorage fallback
- Auto-login for returning students via localStorage
- Added localStorage hooks to `student-initial-test.html` (saves test completion on submit)
- Added localStorage hooks to `student-course.html` (saves CEFR level and lesson day on finish)
- Created `README.md` with full platform documentation
- Moved original files into `src/` directory
