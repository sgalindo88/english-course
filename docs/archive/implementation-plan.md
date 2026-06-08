# FluentPath — Implementation Plan

**Based on:** [suggestions.md](suggestions.md)
**Goal:** Transform FluentPath from a functional prototype into a production-ready platform
**Approach:** Four phases, each delivering standalone value. No phase depends on a later phase.

---

## Phase 1: Foundation & Security (Week 1-2)

**Goal:** Fix critical security issues, establish code quality standards, and restructure the codebase so all future work is easier.

### Step 1.1 — Add basic authentication to Apps Script
**Files:** `apps-script.js`, `src/config.js`, `src/api.js`
**What to do:**
1. Generate a random 32-character API key. Store it as a Script Property (`APP_SECRET`) alongside `CLAUDE_API_KEY`.
2. In `doGet` and `doPost`, check for a `token` parameter. If missing or mismatched, return `{ error: 'Unauthorized' }` with no data.
3. In `config.js`, add `FP.APP_TOKEN` (loaded from an environment-specific file or injected at build time).
4. In `api.js`, automatically append `&token=<FP.APP_TOKEN>` to every GET request and include `token` in every POST payload.
5. For student endpoints, the token proves the client is legitimate. For teacher endpoints (grading, settings), add a second `teacher_token` that only the teacher knows.
6. **Do not commit tokens to git.** Create a `config.local.js` (gitignored) that overrides `FP.APP_TOKEN`. In production, inject via a build step or manual edit.

**Validation:** Try accessing the webhook URL without a token — should return error. Try with token — should work.

---

### Step 1.2 — Audit and fix innerHTML XSS vectors
**Files:** All HTML files
**What to do:**
1. Search every file for `innerHTML` assignments. There are ~80+ instances across the codebase.
2. For each, verify that all interpolated values pass through `escHtml()`.
3. AI-generated lesson content (`lesson.topic`, `lesson.vocabulary.words[].definition`, etc.) must always be escaped before DOM insertion.
4. Replace `innerHTML` with `textContent` wherever the content is plain text (no HTML tags needed).
5. For complex HTML rendering, ensure the pattern is `escHtml(variable)` not `variable`.

**Validation:** Manually test with a mock lesson containing `<img src=x onerror=alert(1)>` in the topic field. It should render as visible text, not execute.

---

### Step 1.3 — Extract JavaScript from HTML files
**Files:** All 5 HTML files → 5 new JS files
**What to do:**
1. Create new files:
   - `src/hub.js` (from `index.html` inline script, ~370 lines)
   - `src/student-test.js` (from `student-initial-test.html`, ~800+ lines)
   - `src/student-lesson.js` (from `student-course.html`, ~900+ lines)
   - `src/examiner-panel.js` (from `examiner-panel.html`, ~1,500+ lines)
   - `src/teacher-portal.js` (from `teacher.html`, ~30 lines)
2. Move all `<script>` content to the corresponding JS file.
3. Replace inline scripts with `<script src="..."></script>` references.
4. Test each page to ensure nothing broke (script load order matters — keep the same order as the original inline blocks).

**Validation:** Every page loads and functions identically to before.

---

### Step 1.4 — Extract page-specific CSS from HTML files
**Files:** All 5 HTML files → 5 new CSS files + expanded `theme.css`
**What to do:**
1. Identify CSS rules duplicated across files:
   - CSS reset (`* { margin:0; ... }`)
   - Body typography
   - `@keyframes fadeIn`, `@keyframes spin`, `@keyframes pulse`
   - Button styles (`.btn-begin`, `.btn-cta`, `.btn-start`)
   - Card styles (`.card`, `.activity-card`)
   - Badge styles (`.badge-*`)
   - Progress bar styles (`.progress-track`, `.progress-fill`)
   - Form input styles (`.field-group input`, `.fg input`)
   - Screen/panel toggle (`.screen.active`, `.panel.active`)
2. Move all shared rules to `theme.css` (or a new `base.css` imported by `theme.css`).
3. Create page-specific CSS files:
   - `src/hub.css`
   - `src/student-test.css`
   - `src/student-lesson.css`
   - `src/examiner-panel.css`
4. Move remaining inline `<style>` blocks to these files.
5. Update HTML `<link>` tags.

**Validation:** Visual regression check — every page looks identical.

---

### Step 1.5 — Add ESLint and Prettier
**Files:** New: `.eslintrc.json`, `.prettierrc`, `package.json`
**What to do:**
1. `npm init -y`
2. `npm install --save-dev eslint prettier eslint-config-prettier`
3. Create `.eslintrc.json`:
   ```json
   {
     "env": { "browser": true, "es2020": true },
     "extends": ["eslint:recommended", "prettier"],
     "rules": { "no-unused-vars": "warn", "no-undef": "warn" }
   }
   ```
4. Create `.prettierrc`: `{ "singleQuote": true, "trailingComma": "es5" }`
5. Add scripts to `package.json`:
   ```json
   "scripts": {
     "lint": "eslint src/ *.js",
     "format": "prettier --write src/ *.js *.html"
   }
   ```
6. Run `npm run lint` and fix errors. Run `npm run format` and commit the result.
7. Convert all `var` declarations to `const`/`let` where appropriate.

**Validation:** `npm run lint` passes with zero errors.

---

### Step 1.6 — Consolidate utility functions
**Files:** `src/utils.js`
**What to do:**
1. Move `formatDate(str, style)` from `index.html` and `examiner-panel.html` into `utils.js`.
2. Move `formatLessonDate(raw)` into `utils.js`.
3. Move `timeAgo(timestamp)` from `checkpoint.js` into `utils.js` (keep the import in checkpoint.js).
4. Move `formatTimeSpent(val)` from `index.html` into `utils.js`.
5. Add to `config.js`:
   ```javascript
   FP.COURSE_DAYS = 20;
   FP.TEST_TOTAL_MARKS = 80;
   FP.LESSON_DURATION_MIN = 90;
   ```
6. Replace all hard-coded `20`, `80`, `90` with the config constants.
7. Remove duplicated function definitions from HTML/JS files.

**Validation:** Search for `function formatDate` — should exist in only one file.

---

### Step 1.7 — Remove legacy file and unused config
**Files:** `src/examiner-marking.html`, `.ddev/`
**What to do:**
1. Move `examiner-marking.html` to `legacy/examiner-marking.html`.
2. Add a note in README under "Legacy" section.
3. Remove the `.ddev/` directory entirely.
4. Add a `"dev": "npx serve ."` script to `package.json` for local development.

**Validation:** `npm run dev` starts a local server. All pages work.

---

**Phase 1 Deliverables:**
- Authenticated API (token-based)
- XSS-safe rendering
- Clean file structure (JS and CSS separated from HTML)
- Linting and formatting enforced
- Shared utilities consolidated
- Magic numbers extracted to config

---

## Phase 2: Performance & Reliability (Week 3-4)

**Goal:** Make the app faster, more resilient to failures, and add basic testing.

### Step 2.1 — Optimise Apps Script read performance
**Files:** `apps-script.js`
**What to do:**
1. **Add CacheService caching** to frequently-read data:
   ```javascript
   function getCachedStudentData(studentName, sheetName) {
     var cache = CacheService.getScriptCache();
     var key = sheetName + '_' + studentName.toLowerCase();
     var cached = cache.get(key);
     if (cached) return JSON.parse(cached);
     // ... read from sheet ...
     cache.put(key, JSON.stringify(result), 300); // 5 min TTL
     return result;
   }
   ```
2. **Use TextFinder** instead of scanning all rows:
   ```javascript
   function findRowByStudent(sheet, studentName, nameCol) {
     var finder = sheet.createTextFinder(studentName)
       .matchCase(false)
       .matchEntireCell(true);
     var range = finder.findNext();
     if (!range) return null;
     var row = range.getRow();
     return sheet.getRange(row, 1, 1, sheet.getLastColumn()).getValues()[0];
   }
   ```
3. **Invalidate cache on write:** After any `doPost` write, delete the relevant cache entries.
4. **Optimise `getLibraryEntries`:** Only read columns `id`, `level`, `day`, `is_active`, `original_difficulty_json`, `times_served` — skip the large `lesson_json` column.

**Validation:** Measure response times before and after. Target: `get_progress` under 2 seconds for 100+ rows.

---

### Step 2.2 — Lazy-load teacher dashboard panels
**Files:** `src/examiner-panel.js`
**What to do:**
1. On initial load, only fetch student name and basic stats (one API call).
2. Each panel tab click triggers data fetch on first visit:
   ```javascript
   var panelLoaded = {};
   function showPanel(name) {
     // ... switch panels ...
     if (!panelLoaded[name]) {
       panelLoaded[name] = true;
       loadPanelData(name); // fetches data, renders content
     }
   }
   ```
3. Show a loading spinner in each panel while data loads.
4. Cache fetched data so tab switching is instant after first load.

**Validation:** Initial dashboard load makes 1 API call instead of 5+. Network waterfall shows requests only when panels are clicked.

---

### Step 2.3 — Refactor `doGet`/`doPost` to dispatch tables
**Files:** `apps-script.js`
**What to do:**
1. Create handler maps:
   ```javascript
   var GET_HANDLERS = {
     get_progress:          function(p) { return handleGetProgress(p.student); },
     get_settings:          function(p) { return handleGetSettings(p.student); },
     get_test_results:      function(p) { return handleGetTestResults(p.student); },
     get_latest_submission: function(p) { return handleGetLatestSubmission(p.student, p.day); },
     get_all_submissions:   function(p) { return handleGetAllSubmissions(p.student); },
     get_students:          function(p) { return handleGetStudents(); },
     get_attendance:        function(p) { return handleGetAttendance(p.student); },
     generate_lesson:       function(p) { return handleGenerateLesson(p.level, parseInt(p.day,10), p.topic, String(p.spanish||'').toLowerCase()==='true', p.student); },
     get_library:           function(p) { return handleGetLibrary(); },
     get_library_entry:     function(p) { return handleGetLibraryEntry(p.id); },
     get_audio:             function(p) { return handleGetAudio(p.id); },
   };
   ```
2. Replace the if-else chain in `doGet` with:
   ```javascript
   var handler = GET_HANDLERS[action];
   result = handler ? handler(e.parameter) : { error: 'Unknown action: ' + action };
   ```
3. Do the same for `doPost`.

**Validation:** All endpoints work identically. Adding a new endpoint is one line in the handler map + the handler function.

---

### Step 2.4 — Add input validation to POST endpoints
**Files:** `apps-script.js`
**What to do:**
1. Create validation helpers:
   ```javascript
   function requireParam(params, key) {
     if (!params[key] || !String(params[key]).trim()) throw new Error('Missing required parameter: ' + key);
     return String(params[key]).trim();
   }
   function validateScore(value, min, max) {
     var n = parseFloat(value);
     if (isNaN(n) || n < min || n > max) throw new Error('Score out of range: ' + value);
     return n;
   }
   ```
2. Apply to each POST handler:
   - `save_progress`: require `student_name`, `day_number`, `level`
   - `save_marks`: require `student_name`, `day_number`, validate score ranges
   - `update_settings`: require `student_name`
   - Placement test submission: require `candidate_name`

**Validation:** POST with missing required fields returns a clear error message.

---

### Step 2.5 — Add error logging to Apps Script
**Files:** `apps-script.js`
**What to do:**
1. Create a `logError(action, student, message, params)` function:
   ```javascript
   function logError(action, student, message, params) {
     var sheet = getOrCreateSheet('Error Log', ['timestamp','action','student','message','params']);
     sheet.appendRow([new Date().toISOString(), action, student || '', message, JSON.stringify(params || {})]);
   }
   ```
2. Call it in every catch block in `doGet` and `doPost`.
3. Add a `get_errors` endpoint for the teacher dashboard to view recent errors (last 50).
4. Add an "Error Log" panel to the teacher dashboard (behind the existing panels, low-key).

**Validation:** Trigger an error (e.g., request with invalid params). Check the Error Log sheet for the entry.

---

### Step 2.6 — Add unit tests for core logic
**Files:** New: `tests/` directory, `tests/utils.test.js`, `tests/scoring.test.js`, `tests/library.test.js`
**What to do:**
1. `npm install --save-dev vitest`
2. Add to `package.json`: `"test": "vitest run"`
3. Write tests for:
   - `escHtml()` — basic escaping, null input, XSS payloads
   - `formatDate()` — various date formats, invalid input
   - `recycleProbability()` — boundary cases (0, 4, 5, 9, 10, 100)
   - `findLibraryMatch()` — strict match, lenient match, no match, focus tag overlap
   - `nearDuplicateExists()` — exact duplicate, near duplicate, different
   - CEFR score thresholds — boundary values
   - MCQ scoring logic — all correct, all wrong, partial
4. For Apps Script functions, create a test harness that mocks `SpreadsheetApp`:
   ```javascript
   // tests/apps-script-mock.js
   globalThis.SpreadsheetApp = { getActiveSpreadsheet: () => mockSpreadsheet };
   ```

**Validation:** `npm test` runs all tests and passes.

---

### Step 2.7 — Add `beforeunload` warning and error states
**Files:** `src/student-lesson.js`, `src/student-test.js`, `src/hub.js`
**What to do:**
1. In lesson and test pages, add:
   ```javascript
   window.addEventListener('beforeunload', function(e) {
     if (lessonInProgress) { e.preventDefault(); }
   });
   ```
2. Remove the handler on successful submission.
3. Add network error UI: when `FP.api.get()` fails, show a banner:
   ```html
   <div class="error-banner">
     Could not reach the server. <button onclick="retry()">Try again</button>
   </div>
   ```
4. In the hub, show an "Offline — showing cached data" notice when the API call fails and localStorage fallback is used.

**Validation:** Close tab during lesson — browser prompts. Disconnect network — error banner appears.

---

**Phase 2 Deliverables:**
- 2-5x faster API responses (caching + targeted reads)
- Lazy-loaded dashboard (faster initial load)
- Input validation on all writes
- Server-side error logging
- Unit tests for core logic
- Better error handling UX

---

## Phase 3: UX & Features (Week 5-7)

**Goal:** Add the most impactful features for both students and teachers.

### Step 3.1 — Multi-student class overview for teachers
**Files:** `src/examiner-panel.html`, `src/examiner-panel.js`, `apps-script.js`
**What to do:**
1. Add a new Apps Script endpoint `get_class_overview`:
   ```javascript
   function handleGetClassOverview() {
     // For each student: name, level, days completed, last active,
     // ungraded count, attendance %, latest score
     // Returns array of student summaries
   }
   ```
2. Add a new "Class Overview" panel to the teacher dashboard (make it the first panel).
3. Render a table with columns: Student, Level, Progress (bar), Last Active, Ungraded, Attendance %, Action.
4. Colour-code rows: green (on track), yellow (1+ days behind or ungraded work), red (3+ days behind or absent 3+ consecutive days).
5. Click a student row → switch to their individual dashboard.
6. Add sort buttons for each column header.
7. Add a "Needs Attention" filter toggle that shows only yellow/red students.

**Validation:** Teacher opens dashboard → sees all students at a glance → clicks one → detailed view loads.

---

### Step 3.2 — Email notification system
**Files:** `apps-script.js`
**What to do:**
1. Add a "Notification Settings" section to the Settings sheet: `teacher_email`, `notify_on_submission`, `notify_on_test`.
2. At the end of the placement test POST handler, if `notify_on_test` is true:
   ```javascript
   MailApp.sendEmail({
     to: teacherEmail,
     subject: 'FluentPath: ' + studentName + ' submitted placement test',
     htmlBody: '<p>' + studentName + ' has submitted their placement test and is awaiting grading.</p>' +
               '<p><a href="https://sgalindo88.github.io/fluentpath/teacher.html">Open Dashboard</a></p>'
   });
   ```
3. At the end of `save_progress`, if `notify_on_submission` is true, send a similar email.
4. When the teacher grades a test and assigns a CEFR level, add an optional student notification (requires storing student email in Settings).
5. Add a "Notification Preferences" section to the Student Profile panel.

**Validation:** Student submits a test → teacher receives email within 1 minute.

---

### Step 3.3 — Student data export and backup
**Files:** `apps-script.js`, `src/examiner-panel.js`
**What to do:**
1. Add a `get_student_report` endpoint that compiles all data for a student into a structured JSON:
   ```javascript
   function handleGetStudentReport(studentName) {
     return {
       student: studentName,
       generated_at: new Date().toISOString(),
       placement_test: handleGetTestResults(studentName),
       course_progress: handleGetAllSubmissions(studentName),
       marks: getMarksForStudent(studentName),
       attendance: handleGetAttendance(studentName),
       settings: handleGetSettings(studentName),
     };
   }
   ```
2. In the Student Profile panel, add a "Download Report" button.
3. On click, fetch the report JSON and convert to a downloadable file:
   - **CSV option:** Flatten the data into rows and trigger a download
   - **JSON option:** Pretty-print and trigger a download
4. Add an automated backup: create a time-triggered function in Apps Script that copies the spreadsheet to a "Backups" folder daily:
   ```javascript
   function dailyBackup() {
     var ss = SpreadsheetApp.getActiveSpreadsheet();
     var folder = getOrCreateSubfolder(DriveApp.getRootFolder(), 'FluentPath Backups');
     var name = 'FluentPath Backup ' + new Date().toISOString().split('T')[0];
     ss.copy(name).moveTo(folder);
     // Keep only last 7 backups
   }
   ```

**Validation:** Click "Download Report" → file downloads with complete student data. Check Drive → backup folder has daily copies.

---

### Step 3.4 — Keyboard navigation and accessibility
**Files:** All page CSS and JS files
**What to do:**
1. **MCQ options:** Add `tabindex="0"`, `role="button"`, `aria-label`. Handle `keydown` Enter/Space to select.
2. **Navigation buttons:** Ensure all Continue/Back buttons are focusable and keyboard-operable (they already are as `<button>`, verify tab order).
3. **Vocabulary cards:** Add `tabindex="0"`, keyboard toggle for reveal.
4. **Step transitions:** After each step change, `focus()` the first interactive element.
5. **ARIA live regions:** Wrap MCQ feedback, status messages, and timer in `aria-live="polite"` containers.
6. **Colour contrast:** Increase `--muted` from `#6b5f4e` to `#5a5040` to achieve WCAG AA 4.5:1 ratio on `--paper`.
7. **MCQ feedback:** Add text labels alongside colour (e.g., "Correct" / "Incorrect" text after the icon).
8. **Focus indicators:** Ensure all interactive elements have visible focus outlines (not `outline: none`).

**Validation:** Navigate the entire placement test and a lesson using only keyboard. Use a screen reader (VoiceOver on Mac) to verify labels and announcements.

---

### Step 3.5 — Timer pause and smart auto-pause
**Files:** `src/student-lesson.js`, `src/student-lesson.css`
**What to do:**
1. Add a pause button next to the timer:
   ```html
   <button class="nav-pause" onclick="togglePause()">⏸</button>
   ```
2. On pause: stop the timer, show a translucent overlay with "Paused — click Resume to continue", prevent step navigation.
3. On resume: restart the timer from where it left off, remove overlay.
4. Auto-pause when tab is hidden:
   ```javascript
   document.addEventListener('visibilitychange', function() {
     if (document.hidden && !paused) togglePause();
   });
   ```
5. Track total paused time separately so the teacher can see actual active time vs. total elapsed time.

**Validation:** Pause during a lesson, switch tabs, come back — timer shows correct remaining time.

---

### Step 3.6 — Quick grading workflow for teachers
**Files:** `src/examiner-panel.js`, `src/examiner-panel.html`
**What to do:**
1. Add a "Quick Grade" button that shows all gradable fields in a single scrollable view (no tabs):
   - Writing response + score slider
   - Speaking transcript + score slider
   - Auto-scored sections shown as read-only
   - Overall feedback textarea
   - Combined total displayed live
   - Save button at the bottom
2. Add a "Next Ungraded" button:
   ```javascript
   function goNextUngraded() {
     var submissions = /* cached all_submissions */;
     var next = submissions.find(s => !s.has_marks);
     if (next) loadSubmission(next.day_number);
     else showStatus('All lessons graded!');
   }
   ```
3. Add keyboard shortcuts: `Ctrl+S` to save grades, `Ctrl+→` for next ungraded.

**Validation:** Teacher can grade a lesson in under 2 minutes using the quick grade view. "Next Ungraded" correctly skips already-graded lessons.

---

### Step 3.7 — Vocabulary spaced repetition
**Files:** `apps-script.js`, `src/student-lesson.js`
**What to do:**
1. Add a `Vocabulary Tracker` sheet tab: `student_name, word, level, day_introduced, last_reviewed, review_count, next_review_date`.
2. When a lesson is submitted, extract vocabulary words and write them to the tracker.
3. When generating a new lesson, query the tracker for words due for review:
   ```javascript
   function getReviewWords(studentName, today) {
     // Simple SRS: review after 1, 3, 7, 14 days
     var sheet = getOrCreateSheet('Vocabulary Tracker', [...]);
     var rows = sheetToObjects(sheet);
     return rows.filter(r =>
       r.student_name === studentName &&
       new Date(r.next_review_date) <= today
     ).slice(0, 3); // max 3 review words per lesson
   }
   ```
4. Include review words in the Claude prompt: "Include these review vocabulary words from previous lessons: [word1, word2, word3]. Integrate them into today's activities naturally."
5. After the lesson, update `last_reviewed` and `next_review_date` in the tracker.

**Validation:** Student completes Day 1 (learns "appointment"). On Day 2, "appointment" appears in a review context. On Day 4, it appears again. After Day 8, it stops appearing (retained).

---

**Phase 3 Deliverables:**
- Class overview dashboard for teachers
- Email notifications on key events
- Data export and automated backups
- Full keyboard/screen reader accessibility
- Timer pause functionality
- Faster grading workflow
- Vocabulary spaced repetition

---

## Phase 4: Polish & Scale (Week 8-10)

**Goal:** Production hardening, monitoring, and features that prepare for growth.

### Step 4.1 — Add service worker for offline resilience
**Files:** New: `sw.js`, update all HTML files
**What to do:**
1. Create a service worker that caches:
   - All HTML, CSS, JS files (app shell)
   - Last API response for each endpoint (stale-while-revalidate)
2. Register the service worker in each HTML file:
   ```javascript
   if ('serviceWorker' in navigator) {
     navigator.serviceWorker.register('/sw.js');
   }
   ```
3. Queue failed POST requests in IndexedDB. Replay when connectivity returns.
4. Show an "Offline" banner when the service worker is serving cached responses.

**Validation:** Load a lesson, go offline, reload — lesson content is still available from cache. Submit a lesson offline — it queues. Go online — it submits.

---

### Step 4.2 — CI/CD with GitHub Actions
**Files:** New: `.github/workflows/ci.yml`
**What to do:**
1. Create a workflow triggered on push and PR:
   ```yaml
   name: CI
   on: [push, pull_request]
   jobs:
     lint-and-test:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - uses: actions/setup-node@v4
           with: { node-version: 20 }
         - run: npm ci
         - run: npm run lint
         - run: npm test
   ```
2. Add a deploy step on merge to main (if not using automatic GitHub Pages).
3. Add a badge to README showing build status.

**Validation:** Push a commit with a lint error → CI fails. Fix and push → CI passes.

---

### Step 4.3 — Add `clasp` for Apps Script version control
**Files:** New: `.clasp.json`, `appsscript.json`
**What to do:**
1. `npm install --save-dev @google/clasp`
2. `npx clasp login` and `npx clasp clone <script-id>`
3. Add `"deploy": "npx clasp push && npx clasp deploy"` to `package.json`.
4. Add `clasp push` to the CI pipeline (with service account credentials as GitHub secrets).
5. Version each deployment with a description matching the git commit.

**Validation:** Edit `apps-script.js` locally → `npm run deploy` → changes are live.

---

### Step 4.4 — Health monitoring endpoint
**Files:** `apps-script.js`
**What to do:**
1. Add a `health` action to `doGet`:
   ```javascript
   function handleHealth() {
     var checks = {};
     try {
       SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Students');
       checks.sheets = 'ok';
     } catch (e) { checks.sheets = 'error: ' + e.message; }
     
     var props = PropertiesService.getScriptProperties();
     checks.claude_key = props.getProperty('CLAUDE_API_KEY') ? 'set' : 'missing';
     checks.timestamp = new Date().toISOString();
     checks.status = (checks.sheets === 'ok' && checks.claude_key === 'set') ? 'healthy' : 'degraded';
     return checks;
   }
   ```
2. Set up a free uptime monitor (UptimeRobot, Better Stack) to ping `?action=health` every 5 minutes.
3. Configure email alerts on failure.

**Validation:** Ping the health endpoint → returns `{ status: 'healthy' }`. Intentionally break something → monitor sends alert.

---

### Step 4.5 — Gamification and achievement system
**Files:** `src/hub.js`, `index.html`, `apps-script.js`
**What to do:**
1. Add an "Achievements" section to the hub dashboard, below the journey timeline.
2. Define achievements:
   - "First Steps" — Complete placement test
   - "5-Day Streak" — Complete 5 consecutive days
   - "Perfect Listener" — Score 100% on listening MCQs
   - "Word Collector" — Learn 50+ vocabulary words
   - "Halfway There" — Complete Day 10
   - "Graduate" — Complete Day 20
3. Calculate achievements from existing data (progress, marks, attendance):
   ```javascript
   function calculateAchievements(progress, marks) {
     var achievements = [];
     if (progress.test_completed) achievements.push({ id: 'first_steps', name: 'First Steps', icon: '🎯' });
     // ... etc
     return achievements;
   }
   ```
4. Display as a horizontal badge row with earned badges in colour and unearned badges greyed out.
5. Show a congratulatory toast when a new achievement is unlocked.

**Validation:** Complete 5 consecutive days → "5-Day Streak" badge appears with a toast.

---

### Step 4.6 — Staging environment
**Files:** `src/config.js`, `apps-script.js`
**What to do:**
1. Create a second Google Sheet ("FluentPath - Dev").
2. Create a second Apps Script deployment linked to the dev sheet.
3. Update `config.js`:
   ```javascript
   FP.ENV = location.hostname === 'sgalindo88.github.io' ? 'production' : 'development';
   FP.WEBHOOK_URL = FP.ENV === 'production'
     ? 'https://script.google.com/macros/s/PRODUCTION_ID/exec'
     : 'https://script.google.com/macros/s/DEV_ID/exec';
   ```
4. For local development (`localhost`), always use the dev endpoint.
5. Add a visual "DEV" banner in development mode so it's obvious which environment you're using.

**Validation:** `npm run dev` → pages use dev endpoint. Push to GitHub Pages → uses production.

---

### Step 4.7 — Multi-course support
**Files:** `apps-script.js`, `src/hub.js`, `index.html`, `src/student-lesson.js`
**What to do:**
1. Add a `course_id` field to Course Progress, Lesson Marks, and Settings sheets.
2. Default: `course_id = 1` for all existing data.
3. When a student completes Day 20, the teacher can "promote" them:
   - Set a new CEFR level in Settings
   - Increment `course_id`
   - The hub shows "Course 2 — Level B2" with a fresh 20-day timeline
4. Past courses are viewable in a "History" section of the hub.
5. The `get_progress` endpoint filters by `course_id`.
6. The teacher can see all courses for a student in the Progress Tracker panel.

**Validation:** Student completes 20 days → teacher promotes → student sees a new empty timeline at the next level → old progress is preserved in history.

---

**Phase 4 Deliverables:**
- Offline-capable with service worker
- Automated CI/CD pipeline
- Apps Script version control via clasp
- Health monitoring and alerts
- Achievement/gamification system
- Staging environment
- Multi-course support

---

## Timeline Summary

| Phase | Focus | Duration | Key Wins |
|-------|-------|----------|----------|
| **Phase 1** | Foundation & Security | Week 1-2 | Auth, XSS fixes, clean file structure, linting |
| **Phase 2** | Performance & Reliability | Week 3-4 | Faster APIs, lazy loading, tests, error logging |
| **Phase 3** | UX & Features | Week 5-7 | Class overview, notifications, accessibility, SRS |
| **Phase 4** | Polish & Scale | Week 8-10 | Offline support, CI/CD, gamification, multi-course |

Each phase is independently deployable. If time is limited, Phase 1 alone makes the platform significantly more secure and maintainable.

---

## Dependencies Between Steps

```
Phase 1 (all steps are independent of each other):
  1.1 Auth ──────────────────────────────────┐
  1.2 XSS audit ─────────────────────────────┤
  1.3 Extract JS ────────────┐               ├── Phase 2 builds on clean structure
  1.4 Extract CSS ───────────┤               │
  1.5 ESLint/Prettier ──────→ depends on 1.3 │
  1.6 Utils consolidation ───────────────────┤
  1.7 Cleanup ───────────────────────────────┘

Phase 2:
  2.1 Optimise Sheets ─── independent
  2.2 Lazy-load panels ─── depends on 1.3 (JS extracted)
  2.3 Dispatch tables ──── independent
  2.4 Input validation ─── independent
  2.5 Error logging ────── independent
  2.6 Unit tests ───────── depends on 1.3, 1.6 (functions in importable files)
  2.7 Error states ─────── depends on 1.3

Phase 3:
  3.1 Class overview ──── depends on 2.1 (performance), 2.3 (dispatch)
  3.2 Notifications ───── depends on 2.5 (error logging pattern)
  3.3 Data export ─────── independent
  3.4 Accessibility ───── depends on 1.3, 1.4
  3.5 Timer pause ─────── depends on 1.3
  3.6 Quick grading ───── depends on 1.3
  3.7 Spaced repetition ─ depends on 2.1

Phase 4:
  4.1 Service worker ──── depends on 1.3 (file structure)
  4.2 CI/CD ────────────── depends on 1.5, 2.6 (lint + tests)
  4.3 clasp ────────────── independent
  4.4 Health monitoring ── independent
  4.5 Gamification ─────── depends on 1.3
  4.6 Staging env ─────── independent
  4.7 Multi-course ─────── depends on 2.1, 3.1
```

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Breaking existing functionality during refactor | High | High | Extract code exactly as-is first, refactor second. Test every page after each step. |
| Google Apps Script quota exceeded during testing | Medium | Medium | Use the staging sheet. Monitor quota usage in Script Properties. |
| Students lose progress during migration | Low | Critical | Never modify sheet structure in place. Add new columns, don't rename old ones. |
| Claude API costs increase with SRS | Low | Low | SRS words are included in the existing prompt, not a separate API call. |
| File size increases with extracted JS/CSS | Low | Low | The total bytes are the same; HTTP/2 multiplexing handles many small files efficiently. |
