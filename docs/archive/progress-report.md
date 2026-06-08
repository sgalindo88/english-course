# FluentPath — Progress Report

**Project:** FluentPath Language Learning & Assessment Platform
**Developer:** Sebastian Galindo
**Report date:** 11 April 2026
**Status:** Production-ready (all 4 implementation phases complete)

---

## Development Timeline

| Day | Date | Commits | Focus |
|-----|------|---------|-------|
| 1 | Apr 5 | 27 | Full platform build — student hub, placement test, daily course, teacher dashboard, mobile support, Spanish translation, session recovery, shared utilities |
| 2 | Apr 6 | 6 | Shared fetch wrapper, hub caching, auto-resume countdown, i18n batching, lesson history pagination, settings toggles |
| 3 | Apr 7 | 2 | Optional video calls (Jitsi Meet), teacher student picker, auto-registration |
| 4 | Apr 9 | 1 | Claude API lesson generation wired through Apps Script with teacher difficulty profiles |
| 5 | Apr 10 | 1 | Lesson library recycling system with coverage grid in teacher dashboard |
| 6 | Apr 11 | 1 | Grading panel overhaul, student save reliability fixes, hub display fixes, attendance persistence, save overlay system |
| 7 | Apr 11 | — | Phase 1–4 implementation: security, performance, UX features, production hardening (see Implementation Phases below) |

---

## Codebase Size

| File | Lines | Purpose |
|------|------:|---------|
| `src/scripts/examiner-panel.js` | 2,367 | Teacher dashboard logic |
| `apps-script.js` | 2,002 | Google Apps Script backend (15 GET + 9 POST endpoints) |
| `src/scripts/student-lesson.js` | 1,756 | Daily lesson logic (7-step flow, timer, pause, SRS) |
| `src/scripts/i18n.js` | 866 | Level-aware Spanish translation (120+ strings) |
| `src/examiner-panel.html` | 823 | Teacher dashboard markup |
| `src/styles/student-test.css` | 778 | Placement test styles |
| `src/scripts/student-test.js` | 757 | Placement test logic |
| `src/scripts/video-call.js` | 549 | Jitsi Meet integration |
| `src/student-initial-test.html` | 541 | Placement test markup |
| `src/scripts/hub.js` | 449 | Student hub logic + achievements |
| `src/styles/student-lesson.css` | 348 | Daily lesson styles |
| `src/styles/examiner-panel.css` | 343 | Teacher dashboard styles |
| `src/styles/mobile.css` | 296 | Mobile-first responsive enhancements |
| `src/scripts/checkpoint.js` | 274 | Session recovery / auto-save |
| `sw.js` | 244 | Service worker (offline resilience) |
| `src/scripts/api.js` | 240 | Shared fetch wrapper + save overlay + SW registration |
| `src/student-course.html` | 172 | Daily lesson markup |
| `src/styles/hub.css` | 127 | Student hub styles + achievements |
| `index.html` | 109 | Student hub markup |
| `src/scripts/utils.js` | 77 | Shared utilities (7 functions) |
| `src/scripts/config.js` | 58 | Shared configuration + course constants |
| `src/styles/teacher-portal.css` | 42 | Teacher portal styles |
| `teacher.html` | 39 | Teacher portal markup |
| `src/styles/theme.css` | 35 | Shared design tokens (WCAG AA compliant) |
| `tests/utils.test.js` | — | 23 unit tests for utility functions |
| `tests/apps-script.test.js` | — | 22 unit tests for backend functions |
| **Total** | **~13,300** | |

---

## Platform Overview

FluentPath is a browser-based English learning platform for adult immigrants, supporting one-on-one tutoring with a teacher dashboard and self-paced student lessons.

### Student-Facing Pages

| Page | Description | Status |
|------|-------------|--------|
| **Student Hub** (`index.html`) | Name-based login, journey timeline with 3 milestones (test → level → course), completed lessons list, achievement badges | Complete |
| **Placement Test** (`student-initial-test.html`) | 4-skill test (Reading, Writing, Listening, Speaking), 80 marks, auto-scored MCQs, session recovery, keyboard accessible | Complete |
| **Daily Lesson** (`student-course.html`) | 7-step AI-generated lesson (warmup → vocab → listening → speaking → practice → writing → review), pausable 90-min timer, vocabulary SRS | Complete |

### Teacher-Facing Pages

| Page | Description | Status |
|------|-------------|--------|
| **Teacher Portal** (`teacher.html`) | Student picker, links to dashboard | Complete |
| **Teacher Dashboard** (`examiner-panel.html`) | 12-panel all-in-one: class overview, dashboard stats, attendance, grade placement test, grade lessons (quick grading + next ungraded), weekly summaries, difficulty adjustment, progress tracker, lesson library, student profile (with notifications + course promotion + data export) | Complete |
| **Standalone Marking** (`legacy/examiner-marking.html`) | Legacy placement test marking tool | Deprecated (moved to `legacy/`) |

---

## Features Completed

### Student Experience
- Name-based login with auto-fill across pages
- Placement test with real-time MCQ feedback, word counter, speech recording
- AI-generated daily lessons personalised to CEFR level (A1–C2) and day (1–20)
- Vocabulary spaced repetition (SRS) — review words from previous lessons integrated into new lessons at 1/3/7/14-day intervals
- Lesson library recycling (reuses past lessons when 5+ exist per level/day bucket)
- Offline fallback library (5 hand-curated lessons) when API is unavailable
- Pronunciation drills with user-controlled recording (toggle start/stop)
- Listening comprehension with play-count limits and cumulative play-time
- Forward-only lesson navigation (prevents answer loss)
- Timer pause with overlay + auto-pause on tab switch (tracks active vs. total time)
- Save verification (reads back from sheet to confirm save landed)
- Session recovery with auto-save every 5 seconds and bilingual resume modal
- beforeunload warning when leaving an in-progress lesson or test
- Level-aware Spanish translation (4 modes: bilingual, tap-to-translate, teacher-gated, English-only)
- Achievement badges (First Steps, Level Up, Day One, 5-Day Streak, Halfway There, Graduate) with unlock toasts
- Multi-course support — students can be promoted to Course 2, 3, etc. at higher levels
- Optional video calls via Jitsi Meet
- Mobile-optimised with 48px touch targets, sticky nav, iOS zoom prevention
- Keyboard navigation — MCQ options, vocabulary cards, and navigation all keyboard-accessible with visible focus indicators
- WCAG AA colour contrast for all text

### Teacher Experience
- **Class overview** — sortable table of all students with status colour coding (green/yellow/red), attendance %, ungraded count, and click-to-navigate
- Student picker with auto-registration
- Grade placement test: auto-scored reading/listening, manual sliders for writing/speaking, CEFR calculation
- Grade lessons: Writing tab, Speaking tab, All Responses tab, Final Score — with "Next Ungraded" button and keyboard shortcuts (Ctrl+S save, Ctrl+→ next)
- Lesson picker dropdown to navigate between submitted days
- Graded/ungraded badge on submission header
- Attendance tracking synced to Google Sheets (20-day grid with absence notes)
- Weekly skill summaries with AI-generated narrative
- Difficulty adjustment (6 sliders + focus area tags) synced per student
- Progress tracker with warmup, vocab, listening, practice, writing, speaking, and attendance columns
- Skills snapshot with progress bars
- Lesson library management with coverage grid, preview, and soft-delete
- Course permission toggles (allow Spanish, skip test, retake test)
- Email notifications — opt-in alerts when students submit tests or complete lessons; student notified when test is graded
- Student data export — download full student report as JSON or CSV
- Course promotion — promote students to next course/level with one click
- Save overlay blocking interaction during all async saves
- Email results to student with full score breakdown
- Lazy-loaded panels — dashboard loads one API call; panel data fetches on first visit

### Backend (Google Apps Script)
- 24 API endpoints (15 GET, 9 POST) via dispatch tables
- Token-based authentication (APP_SECRET + TEACHER_SECRET)
- Input validation on all POST endpoints (requireParam, validateScore)
- CacheService caching (5-min TTL) with automatic invalidation on writes
- TextFinder for targeted row lookups (replaces full-sheet scans)
- Server-side error logging to Error Log sheet tab
- Claude API proxy for lesson generation and weekly summaries
- Vocabulary spaced repetition (track, review, advance SRS intervals)
- Lesson library with recycling, deduplication, and difficulty rewriting
- Email notifications via MailApp (teacher + student)
- Student report compilation endpoint
- Class overview endpoint (all students in one call)
- Health monitoring endpoint (unauthenticated, for uptime monitors)
- Daily backup function (copies spreadsheet, prunes to 7 most recent)
- Multi-course support (course_id filtering + promote_student)
- Column-safe writes (`ensureSheetHeaders` + `safeAppendRow`)
- Upsert pattern for settings, attendance, and examiner results

### Infrastructure
- **File structure:** HTML (markup only) / CSS (`src/styles/`) / JS (`src/scripts/`) cleanly separated
- **Code quality:** ESLint 9 + Prettier + 45 vitest unit tests; CI/CD via GitHub Actions
- **Offline resilience:** Service worker with cache-first app shell, stale-while-revalidate API, POST queue in IndexedDB
- **Deployment:** clasp for Apps Script version control (`npm run clasp:deploy`)
- **Staging environment:** auto-detected dev/production mode with DEV banner; optional dev webhook URL
- **Security:** Token-based auth, XSS-hardened innerHTML (escHtml with single-quote escaping), ARIA attributes
- **Accessibility:** Keyboard navigation, focus management, aria-live regions, WCAG AA contrast, text labels on colour-coded feedback
- Google Sheets as database (10 tabs: Initial Test Results, Examiner Results, Course Progress, Settings, Lesson Marks, Students, Lesson Library, Attendance, Vocabulary Tracker, Error Log)
- Dual submission for placement test (Formspree email + Google Sheets)
- Audio recording upload to Google Drive via Apps Script proxy

---

## Google Sheets Database

| Tab | Rows Written By | Purpose |
|-----|----------------|---------|
| Initial Test Results | Student (test submission) | Raw placement test answers and auto-scores |
| Examiner Results | Teacher (grading) | Graded test results with CEFR level and per-question breakdowns |
| Course Progress | Student (lesson completion) | Daily lesson records with answers, writing, speaking, audio, course_id |
| Settings | Teacher (profile/difficulty) | Per-student preferences, difficulty profiles, notification settings, course_id |
| Lesson Marks | Teacher (grading) | Graded daily lesson scores and feedback, course_id |
| Students | Auto (first hub visit) | Registered student names and join dates |
| Lesson Library | Auto (lesson generation) | AI-generated lesson cache for recycling |
| Attendance | Teacher (attendance panel) | Per-student attendance JSON and absence notes |
| Vocabulary Tracker | Auto (lesson completion) | SRS word tracking per student (word, intervals, next review date) |
| Error Log | Auto (on errors) | Server-side error log with timestamp, action, student, message |

---

## Technology Stack

- **Frontend:** Pure HTML, CSS, and vanilla JavaScript (no frameworks)
- **Code Quality:** ESLint 9 + Prettier + vitest (45 tests); CI/CD via GitHub Actions
- **Backend:** Google Apps Script (web app deployment) with clasp version control
- **AI:** Claude API (Haiku for lessons, Sonnet for summaries) via server-side proxy
- **Database:** Google Sheets (10 tabs) with CacheService + TextFinder optimisation
- **Offline:** Service worker with cache-first app shell, stale-while-revalidate API, IndexedDB POST queue
- **Video:** Jitsi Meet (optional, floating panel)
- **Speech:** Web Speech API (TTS for listening, STT for speaking drills)
- **Email:** Formspree (placement test results) + MailApp (notifications)
- **Audio Storage:** Google Drive (speaking recordings as base64 uploads)
- **Hosting:** GitHub Pages
- **Local Dev:** DDEV + `npm run dev`

---

## Implementation Phases Completed

### Phase 1: Foundation & Security
- Token-based API authentication (APP_SECRET + TEACHER_SECRET)
- innerHTML XSS hardening (escHtml with single-quote escaping)
- JavaScript extracted from HTML into `src/scripts/`
- CSS extracted from HTML into `src/styles/`
- ESLint 9 + Prettier configured
- Utility functions consolidated into `utils.js`
- Legacy examiner-marking moved to `legacy/`

### Phase 2: Performance & Reliability
- Apps Script dispatch tables (GET_HANDLERS + POST_HANDLERS)
- Input validation on all POST endpoints
- CacheService + TextFinder read optimisation
- Error logging to Error Log sheet tab
- Lazy-loaded teacher dashboard panels
- beforeunload warnings + offline banner on hub
- 45 unit tests (vitest)

### Phase 3: UX & Features
- Multi-student class overview with sortable table
- Email notification system (teacher + student)
- Student data export (JSON/CSV) + daily backup
- Keyboard navigation + WCAG AA accessibility
- Timer pause + auto-pause on tab switch
- Quick grading workflow (Next Ungraded + keyboard shortcuts)
- Vocabulary spaced repetition (1/3/7/14-day SRS)

### Phase 4: Polish & Scale
- Service worker for offline resilience
- CI/CD with GitHub Actions
- clasp for Apps Script version control
- Health monitoring endpoint
- Gamification / achievement badges
- Staging environment (dev/production auto-detection)
- Multi-course support (course_id + promotion)
