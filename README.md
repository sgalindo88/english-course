# FluentPath -- Language Learning & Assessment Platform

[![CI](https://github.com/sgalindo88/english-course/actions/workflows/ci.yml/badge.svg)](https://github.com/sgalindo88/english-course/actions/workflows/ci.yml)

A browser-based English language learning and assessment system by **Fluentora**, designed for **adult immigrants** (ages 20--50) who lack the time or resources for formal schooling. The platform supports **one-on-one tutoring** with live video calls and asynchronous self-study.

Two audiences -- **students** taking tests and completing lessons, and **teachers** marking work and managing course progress. All interfaces share a cohesive visual identity (Playfair Display + Source Serif 4 typography, cream/ink/rust palette) and integrate with Google Sheets, a pluggable AI provider (Gemini / Anthropic / OpenAI), and a student-initiated video call request system.

**Live at:** [sgalindo88.github.io/fluentpath](https://sgalindo88.github.io/fluentpath/)

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Project Structure](#project-structure)
- [File Descriptions](#file-descriptions)
  - [index.html -- Student Hub](#1-indexhtml--student-hub)
  - [teacher.html -- Teacher Portal](#2-teacherhtml--teacher-portal)
  - [student-initial-test.html -- Placement Test](#3-student-initial-testhtml--placement-test)
  - [student-course.html -- Daily Lesson](#4-student-coursehtml--daily-lesson)
  - [examiner-panel.html -- Teacher Dashboard](#5-examiner-panelhtml--teacher-dashboard)
  - [examiner-marking.html -- Standalone Marking (Legacy, moved to `legacy/`)](#6-examiner-markinghtml--standalone-marking-legacy)
- [Shared Utilities](#shared-utilities)
- [Level-Aware Translation System](#level-aware-translation-system)
- [Shared Design System](#shared-design-system)
- [Integration Points](#integration-points)
- [Google Sheets Schema](#google-sheets-schema)
- [Technology Stack](#technology-stack)
- [CEFR Level Reference](#cefr-level-reference)

---

## Architecture Overview

```
  ┌──────────────────┐          ┌──────────────────┐
  │   index.html     │          │  teacher.html     │
  │  (Student Hub)   │          │ (Teacher Portal)  │
  └────────┬─────────┘          └────────┬──────────┘
           │                             │
           │                             ▼
           │                   ┌──────────────────────┐
           │                   │  examiner-panel.html  │
           │                   │  (Teacher Dashboard)  │
           │                   │  - Grade placement test  │
           │                   │  - Grade lessons         │
           │                   │  - Track attendance      │
           │                   │  - Adjust difficulty     │
           │                   └──────────────────────┘
           │
     ┌─────┴──────┐
     │            │
     ▼            ▼
  Phase 1      Phase 2
  Placement    Course
     │            │
     ▼            ▼
  student-     student-
  initial-     course.html
  test.html    (daily lessons)
```

**Phase 1 -- Placement:** Student completes a four-skill proficiency test. The teacher marks it in the dashboard, assigns a CEFR level (A1--C2), and the student is placed into the right course tier. Students can skip the test if the teacher allows it.

**Phase 2 -- Course:** Student works through a 20-day structured course with AI-generated lessons. Each day's lesson is served from the **Lesson Library** when a matching entry exists (recycling activates at 5+ entries per `(level, day)` bucket) or generated fresh by the AI provider if not. Freshly generated lessons are written back to the library so later students benefit from the pool. Lessons generated with teacher-specific `aiInstructions` are never recycled. All lessons are cached per student/day in localStorage so reloads don't re-bill the API. If the API is unavailable, a 5-lesson offline fallback library cycles by day and a banner notifies the student. The teacher marks submissions, tracks attendance, adjusts difficulty, and writes weekly summaries. No approval workflow -- lessons start immediately.

**Video calls** are available on all student pages via an optional floating "Request a Video Call" button; the teacher responds from the dashboard with a meeting link (same mechanism as the teacher dashboard).

---

## Project Structure

> **Two-repo split.** This is the **student app + backend** repo (served at `fluentpath.ca`). The **teacher dashboard** (`teacher.html`, `examiner-panel.*`, `teacher-portal.js`) lives in a separate repo served at `teacher.fluentpath.ca`. Shared frontend files (`config.js`, `api.js`, `utils.js`, `i18n.js`, `call-request.js`, `password-reset.js`, `theme.css`, `mobile.css`) are authored here and propagated to the teacher repo via `npm run sync`. The Apps Script backend (`apps-script.js`) is shared by both and lives only here.

```
fluentpath/
├── index.html                     # Student app (login → hub → journey)
├── sw.js                          # Service worker (offline resilience, app shell)
├── CNAME                          # Custom domain (fluentpath.ca)
├── apps-script.js                 # Google Apps Script backend (deploy via clasp)
├── appsscript.json                # Apps Script manifest (V8 runtime, OAuth scopes)
├── package.json                   # npm project (lint, test, sync, clasp scripts)
├── eslint.config.mjs              # ESLint 9 flat config
├── .github/workflows/ci.yml       # CI (lint + test; optional teacher-repo sync)
├── src/
│   ├── student-initial-test.html  # Placement test (student)
│   ├── student-course.html        # Daily lesson (student)
│   ├── scripts/
│   │   ├── config.js              # Shared config (endpoints, env, session helpers)
│   │   ├── config.local.js        # Dev overrides (gitignored)
│   │   ├── api.js                 # Fetch wrapper (token/session, save overlay, SW)
│   │   ├── utils.js               # Shared formatting utilities
│   │   ├── i18n.js                # Level-aware Spanish translation
│   │   ├── call-request.js        # Student-initiated video-call requests
│   │   ├── password-reset.js      # Shared password-reset modal (forgot / set-new)
│   │   ├── hub.js                 # Student hub: journey, achievements, paywall
│   │   ├── student-test.js        # Placement test logic
│   │   ├── student-lesson.js      # Daily lesson logic (timer, pause, SRS)
│   │   └── checkpoint.js          # Session recovery / auto-save
│   └── styles/                    # theme, mobile, hub, student-test, student-lesson
├── scripts/
│   └── sync-shared.mjs            # Propagate shared files → teacher repo (npm run sync)
├── tests/                         # vitest: utils, apps-script, auth, stripe, password-reset
├── docs/                          # All documentation — see docs/README.md
└── legacy/                        # Deprecated standalone marking page (superseded)
```

---

## File Descriptions

### 1. `index.html` -- Student Hub

**Purpose:** Central landing portal for students. Name-based login, fetches progress from Google Sheets, and displays a journey timeline pointing the student to their next action.

#### Screens

| # | Screen | Description |
|---|--------|-------------|
| 1 | **Welcome** | Name input. Returning students auto-logged-in via localStorage. |
| 2 | **Loading** | Spinner while progress and teacher settings are fetched from Google Sheets. |
| 3 | **Dashboard** | Journey timeline with three milestones and context-aware CTA. |

#### Journey Milestones

| # | Milestone | States |
|---|-----------|--------|
| 1 | **Placement Test** | Not started (CTA + optional "Skip to Course" if teacher allows) / Completed (green, with score) |
| 2 | **Your Level** | Locked / Awaiting review (pending badge) / Assigned (CEFR badge) |
| 3 | **Your Course** | Locked / Ready to begin / In progress (Day X/20 progress bar) / Complete |

#### Key Features

- **Progress tracking** via Google Sheets (`?action=get_progress`) with localStorage fallback
- **Teacher settings check** fetches `allow_skip_test` and `allow_retake_test` from Google Sheets
- **Skip or re-take** placement test options when teacher enables them
- **Completed lessons list** showing day, topic, time spent, confidence, and date
- **Auto-login** for returning students
- **Name validation** -- max 100 characters, letters/accents/hyphens/apostrophes only
- **Context-aware CTA** that always shows the right next action
- **Level-aware translation** via the shared i18n system

---

### 2. `teacher.html` -- Teacher Portal

**Purpose:** Separate landing page for teachers. Fetches registered students from Google Sheets and displays them as selectable cards.

- Branded Fluentora header with "Instructor Access" badge
- **Student picker** -- loads registered student names from the "Students" tab via `get_students` endpoint
- Selecting a student navigates to `src/examiner-panel.html?student={name}`, bypassing the setup screen

---

### 3. `student-initial-test.html` -- Placement Test

**Purpose:** Four-skill English proficiency placement test (Reading, Writing, Listening, Speaking). 80 marks total, 35 auto-graded, 45 requiring teacher review.

#### Screens & Flow

| # | Screen | Description |
|---|--------|-------------|
| 1 | **Cover** | Name, date, optional "Request a Video Call" button |
| 2--3 | **Reading** | Intro + 10 MCQs on reading passages |
| 4--5 | **Writing** | Intro + 4 tasks (passive voice, sentence combining, error correction, short writing) |
| 6--7 | **Listening** | Intro + 4 MCQs, 1 multi-select, 1 dictation (browser TTS audio, 3-play limit) |
| 8--9 | **Speaking** | Intro + 4 speaking prompts with preparation notes |
| 10 | **Submitting** | Loading spinner |
| 11 | **Results** | Time summary and confirmation |

#### Scoring

| Section | Auto | Teacher | Total |
|---------|------|---------|-------|
| Reading (Q1--Q10) | 20 | -- | 20 |
| Writing (Q11--Q14) | -- | 25 | 25 |
| Listening (Q15--Q20) | 10 | 5 | 15 |
| Speaking (Q21--Q24) | -- | 20 | 20 |
| **Total** | **30** | **50** | **80** |

#### Key Features

- **Name auto-filled** from hub, **date read-only** (auto-calculated)
- **Optional video call** -- floating "Request a Video Call" button sends a request to the teacher, who replies with a meeting link; test can begin without connecting
- **Listening stop button** with cumulative play-time tracking (main passage and dictation)
- **Speech recording** on all speaking questions (Q21-Q24) with live transcript and pronunciation feedback
- **Required + skip** -- all writing/speaking text fields are required, with "Skip this question" checkbox
- **Session recovery** -- auto-saves every 5s; bilingual resume/start-over modal on page reload
- **Tap-to-translate** -- default translation mode for the test (B1/B2 style)
- **"Return to FluentPath"** button on results screen (re-take only via teacher-controlled hub setting)
- **Real-time MCQ feedback**, word counter, browser TTS, dual submission (Formspree + Google Sheets)
- **Mobile-optimised** with 48px touch targets, sticky nav, iOS zoom prevention

---

### 4. `student-course.html` -- Daily Lesson

**Purpose:** AI-powered 90-minute daily lesson with 7 sequential activities. Generated by the configured AI provider, personalised to CEFR level and day. No approval workflow -- lessons start immediately.

#### 7-Step Lesson

| Step | Type | Duration | Activities |
|------|------|----------|------------|
| 1 | Warm-Up | 10 min | Free-response prompt |
| 2 | Vocabulary | 20 min | Word cards with TTS + practice writing |
| 3 | Listening | 15 min | TTS passage (3-play limit) + MCQs |
| 4 | Speaking | 20 min | Pronunciation drills (speech recognition) + free conversation |
| 5 | Practice | 15 min | MCQ comprehension check |
| 6 | Writing | 15 min | Guided task with word count |
| 7 | Review | 5 min | Key takeaways + confidence self-assessment |

#### Key Features

- **Name, date, and level auto-filled** from hub; level grid locked when assigned by teacher
- **No approval workflow** -- lessons start immediately
- **Optional video call** -- floating "Request a Video Call" button sends a request to the teacher, who replies with a meeting link; lesson can begin without connecting
- **Level-aware translation** -- A1/A2 gets bilingual AI content via `_es` keys; B1/B2 gets tap-to-translate
- **41+ translated static strings** covering all UI text (step titles, buttons, status, feedback, labels)
- **`tr()` runtime translation** for JS-set text at A1/A2 level
- **Required + skip** -- all text questions required with "Skip this question" checkbox
- **Listening stop button** with cumulative play-time tracking
- **Pronunciation drills** use toggle recording (user clicks to start and stop); `continuous: true` mode prevents auto-cutoff; null-safe cleanup in `finishLesson`
- **Browser compatibility check** -- speaking step detects unsupported browsers, shows bilingual warning, and disables recording buttons
- **AI lesson generation via Apps Script → AI provider** -- each day's lesson is generated fresh by the configured provider (default `gemini-2.5-flash`) for the student's level, day, and topic; cached in localStorage by `fp_lesson_<level>_d<day>` so reloads don't re-bill the API
- **Offline fallback library** -- 5 distinct lesson templates (appointments, shopping, workplace, health, family/community) cycled by `(day - 1) % 5`; an "offline" banner appears when the API is unavailable so the teacher notices
- **Lesson generation timeout** -- 60-second `FP.api.get` abort prevents infinite loading; falls through to the offline library on error
- **Session recovery** -- auto-saves lesson content and progress every 5s
- **Course day tracking** -- uses `fp_last_lesson_day + 1`, not day of month
- **Lesson complete** links back to hub with "View Progress & Next Lesson" (hidden until save finishes); save overlay blocks navigation during save
- **Save verification** -- reads back progress from sheet to confirm the save landed; shows warning if not found
- **Forward-only navigation** -- Back button removed to prevent answer loss
- **90-minute countdown timer** with visual warning when <10 min remain

---

### 5. `examiner-panel.html` -- Teacher Dashboard

**Purpose:** All-in-one teaching dashboard. Manages both placement test marking and daily course operations for one student.

#### Panels

| # | Section | Panel | Description |
|---|---------|-------|-------------|
| -- | -- | **Setup** | Fallback student name entry (normally bypassed via teacher portal student picker) |
| 1 | Lessons | **Dashboard** | Stats grid, progress bars, activity feed, teacher notes |
| 2 | Lessons | **Attendance** | 20-day clickable grid (present/absent/unmarked), synced to Google Sheets |
| 4 | Grading | **Grade Placement Test** | Load test from Google Sheets, auto-score reading/listening, manual sliders for writing/speaking, CEFR calculation, save to Sheets |
| 5 | Grading | **Grade Lessons** | Daily lesson submission grading — Writing tab (warmup + vocab + writing task, 25pts), Speaking tab (transcript + audio drills, 20pts), All Responses tab (listening + comprehension with colour-coded chips), Final Score (all four skills combined) |
| 6 | Marking | **Weekly Summaries** | 4-week skill assessments + AI-generated narrative summaries |
| 7 | Course | **Adjust Difficulty** | 6 sliders (vocabulary, grammar, speaking, writing, listening, sentence complexity) + focus area tags |
| 8 | Course | **Progress Tracker** | Lesson-by-lesson record table, skills snapshot with progress bars |
| 9 | Course | **Lesson Library** | 6 × 20 coverage grid colour-coded by entry count; click any cell to list, preview, or soft-delete library entries; stats: total entries, times recycled, days seeded |
| 10 | Student | **Student Profile** | Settings form (name, email, CEFR level, course month, notes) + permission toggles (allow Spanish, skip test, retake test) synced to Google Sheets |

#### Placement Test Marking (Panel 4)

Pulled directly from the "Initial Test Results" Google Sheets tab (no email pasting required):
- **Auto-scored:** Reading Q1--Q10 and Listening Q15--Q19 with colour-coded chips
- **Manual sliders:** Writing Q11--Q13 (0--5 each), Q14 with 4 sub-criteria (0--2.5 each), Speaking Q21--Q24 (0--5 each), Dictation Q20 (0--5)
- **CEFR calculation:** Automatic level assignment from total score
- **Save to Sheets:** Exports graded results to "Examiner Results" tab

#### Key Features

- **Video call** -- pending call-request panel; teacher pastes a meeting link (Zoom, WhatsApp, Meet, etc.) that the student can then join
- **localStorage persistence** under `fluentpath_teacher` key with auto-save; textarea values (notes, feedback) also restored on reload
- **AI-powered weekly summaries** via Apps Script proxy (server-side AI provider call)
- **Webhook URL hardcoded** -- no user configuration needed
- **No approval workflow** -- lessons start directly, approvals panel removed
- **Auto-populate grading** -- placement test and lesson submissions auto-load when panels open; previously graded scores restored from Google Sheets (individual question scores, breakdowns, notes) with localStorage fallback
- **Lesson picker** -- dropdown populated from `get_all_submissions` endpoint; jump to any submitted day; shows graded/ungraded status per entry
- **Graded/ungraded badge** -- pill badge on submission header shows current grading status
- **All Responses tab** -- listening and comprehension answers displayed as colour-coded chips (green ✓ correct, red ✗ incorrect) matching placement test styling
- **Combined final score** -- lesson total includes Writing (/25) + Speaking (/20) + Listening + Comprehension auto-scores
- **Save overlay** -- full-screen blocking overlay during all async saves (grades, attendance, placement test results)
- **Dashboard stats** -- days completed, attendance %, avg lesson time, lessons graded; recent activity feed with last 5 lessons
- **Google Sheets sync** -- fetches course progress on init, merges with localStorage, syncs CEFR level changes
- **Skills snapshot** -- vocabulary, speaking, writing, and listening progress bars derived from marks and weekly summary ratings
- **Course day tracking** -- uses actual attendance/lesson count, not calendar day
- **Google Sheets integration** for marks and settings (via `safeAppendRow` for column-safe writes; `upsertByStudent` for Examiner Results to avoid duplicates)
- **Course permission toggles** -- allow Spanish UI, skip placement test, retake placement test; synced to Google Sheets Settings tab via `update_settings`
- **Reset grading data** button on the placement test panel for clearing corrupted or stale scoring state
- **Demo data** built in for testing without live data

---

### 6. `examiner-marking.html` -- Standalone Marking (Legacy)

**Moved to `legacy/examiner-marking.html`.** Original standalone placement test marking tool. Still functional but superseded by the "Grade Placement Test" panel in the Teacher Dashboard. Uses the Formspree email import workflow. Not actively maintained — use the dashboard instead.

---

## Shared Utilities

### `config.js` -- Shared Configuration

- **Webhook URL** -- single source of truth for the Google Apps Script endpoint (previously duplicated in 5 files)
- **Formspree endpoint** -- email delivery endpoint
- **CEFR level metadata** -- `FP.LEVELS` with name, theme, and colour for each level (A1--C2)
- **localStorage keys** -- `FP.KEYS` with standardised key names

### `api.js` -- Shared Fetch Wrapper

- **`FP.api.get(url, options)`** -- GET request with 30-second timeout, returns parsed JSON; throws on non-OK response
- **`FP.api.postForm(url, payload, options)`** -- POST form-urlencoded in `no-cors` mode for Google Apps Script webhooks; auto-encodes payload with optional value length limit (`maxValueLength`, default 2 000)
- **`FP.api.postJson(url, payload, options)`** -- POST JSON with readable response (Formspree, Apps Script proxy); returns parsed JSON
- **`FP.showSaveOverlay(msg)`** / **`FP.updateSaveOverlay(msg)`** / **`FP.hideSaveOverlay()`** -- full-screen blocking overlay with spinner; prevents interaction during async saves across all pages
- All methods use `AbortController` with a configurable timeout (default 30 seconds)

### `utils.js` -- Shared Utilities

- **`escHtml()`** -- HTML-escapes a string for safe `innerHTML` insertion (previously duplicated in 3 files)

### `theme.css` -- Shared Design Tokens

- **CSS custom properties** -- all colour variables (ink, paper, cream, rust, gold, etc.) defined once
- **Google Fonts import** -- Playfair Display + Source Serif 4 loaded once instead of per-page

### `call-request.js` -- Video Call Requests

- **`CallRequest.init({page, dayNumber})`** -- wired into the hub, placement test, and daily lesson on `DOMContentLoaded`
- **Student flow:** floating "Request a Video Call" button POSTs `request_video_call`; button becomes "Request pending…" with a manual Refresh link
- **Join link:** when the teacher sends a link, a green banner appears at the top of the page with "Join Call" + Dismiss; the floating button transforms to "Join Teacher's Call"
- **Polling:** on page load + tab focus + manual refresh (no continuous polling); student can Dismiss to clear the request at any time
- **Teacher side:** the dashboard surfaces pending requests and lets the teacher paste a meeting link (Zoom, WhatsApp, Meet, etc.) or Mark as Done

### `mobile.css` -- Mobile-First Enhancements

- **iOS zoom prevention:** 16px minimum font-size on all inputs
- **Touch targets:** 48px minimum height (WCAG compliant)
- **Sticky bottom navigation** on mobile for thumb-reachable Continue/Back buttons
- **Full-width buttons**, slimmer topbar (46px), small-phone breakpoint (380px)
- **Desktop hover enhancements** gated behind `(hover: hover)`

### `i18n.js` -- Level-Aware Spanish Translation

See [Level-Aware Translation System](#level-aware-translation-system) below.

### `checkpoint.js` -- Session Recovery

- **Auto-saves every 5 seconds** plus immediate save on screen/step navigation
- **Bilingual recovery modal** (English + Spanish) with time-ago indicator on page reload
- **60-second auto-resume countdown** with shrinking progress bar -- prevents sessions from staying stuck on the modal if student walks away
- **ESC key dismisses** the modal (resumes by default)
- **Placement test:** Saves screen, all MCQ and text answers, play counts, task choice
- **Course lesson:** Saves step, answers, full AI-generated lesson content, elapsed timer
- **Clears automatically** on successful submission or completion

---

## Level-Aware Translation System

Translation behaviour adapts to the student's CEFR level:

| Level | Mode | Behaviour |
|-------|------|-----------|
| **A1 / A2** | Spanish-primary | UI displayed in Spanish. English shown as smaller italic help text below each element. Placeholders swapped to Spanish. |
| **B1 / B2** | Tap-to-translate | UI in English. Translatable text has a dotted underline. Tap/click shows a dark tooltip with the Spanish translation (auto-dismisses after 4 seconds). |
| **Placement test** | Tap-to-translate | Same as B1/B2 (level not yet known). |
| **C1** | Teacher-gated | UI in English. A small toggle appears in the top-right corner, greyed out until the teacher enables `allow_spanish` in Google Sheets. Once approved, clicking the toggle activates tap-to-translate. |
| **C2** | English-only | No translation features. Section icons still shown as visual cues. |

**120+ translated strings** covering buttons, headings, instructions, form labels, placeholders, status messages, activity labels, level names, and confidence ratings.

**Section icons** (📖 ✍️ 🎧 🗣️ ☀️ 📝 💪 📋) auto-injected next to section headings in all modes.

**MutationObserver** re-applies translations when the DOM changes dynamically (lesson steps, hub dashboard, etc.).

---

## Shared Design System

| Element | Value |
|---------|-------|
| **Background** | `#f5f0e8` (warm cream) |
| **Text** | `#1a1208` (dark ink) |
| **Primary accent** | `#b8471e` (rust) |
| **Secondary accent** | `#c9933a` (gold) |
| **Success** | `#2e6e45` (green) |
| **Info** | `#1e4d8c` (blue) |
| **Borders** | `#c8bfa8` (rule) |
| **Muted text** | `#6b5f4e` |
| **Heading font** | Playfair Display (serif, 400/700) |
| **Body font** | Source Serif 4 (serif, 300/400/600) |
| **Max content width** | 680--900px |
| **Animation** | `fadeIn` 0.25--0.3s ease with `translateY` |
| **Responsive breakpoints** | 380px (small phone), 600px (mobile/tablet) |

Print-inspired, academic, warm -- designed to feel calm and professional for adult learners.

---

## Integration Points

### Google Sheets (via Apps Script Webhook)

| File | Direction | Data |
|------|-----------|------|
| `index.html` | Sends / Receives | Student progress + teacher settings; auto-registers new students in Students tab |
| `teacher.html` | Receives | Student list from Students tab (via `get_students`) |
| `student-initial-test.html` | Sends | Test answers, scores, timing |
| `student-course.html` | Sends / Receives | Lesson requests, approval polling, completion data |
| `examiner-panel.html` | Sends / Receives | Marks, approvals, settings, test results fetch, CEFR level |

**Authentication:** All API requests require an `APP_SECRET` token (set in Script Properties). Teacher-only endpoints (grading, settings, attendance, library management) additionally require a `TEACHER_SECRET`. Tokens are auto-injected by `api.js`. See `src/scripts/config.local.js` for frontend setup.

**Performance:** GET endpoints use `CacheService` (5-minute TTL) for student progress and settings. `TextFinder` is used for targeted row lookups instead of full-sheet scans. POST handlers automatically invalidate the cache for the affected student.

**Validation:** All POST endpoints validate required parameters and return clear error messages for missing/invalid input. Errors are logged server-side in an "Error Log" sheet tab.

Full schema documented in [`docs/google-sheets-schema.md`](docs/google-sheets-schema.md).

### AI Provider (pluggable) -- via Apps Script Proxy

All AI calls run **server-side** through the Apps Script proxy (keeping the API key off the client) and are routed through a small provider-adapter layer. Switch providers by changing Script Properties only — no code change. Supported providers: **Gemini** (default), **Anthropic**, and **OpenAI**.

| File | Usage |
|------|-------|
| `student-course.html` | AI-generated daily lessons via the `generate_lesson` GET action; cached per (level, day) in localStorage |
| `examiner-panel.html` | AI-drafted weekly summary narratives (routed through the Apps Script `ai_summary` action) |

**Setup:** the Apps Script project requires these **Script Properties** (Project Settings → Script Properties → Add):

| Property | Required | Description |
|----------|----------|-------------|
| `AI_API_KEY` | Yes | API key for the chosen provider |
| `APP_SECRET` | Yes | Random 32-char string shared with frontend `config.local.js` |
| `TEACHER_SECRET` | Yes | Separate secret for teacher-only endpoints |
| `AI_PROVIDER` | No | `gemini` (default), `anthropic`, or `openai` |
| `AI_MODEL` | No | Override default model (default: `gemini-2.5-flash`) |

See the header comment in `apps-script.js` for full deployment steps.

### Video Calls (student-initiated request system)

Students request a call via a floating "Request a Video Call" button; the teacher responds from the dashboard with their preferred link (Zoom, WhatsApp, Meet, etc.). See the CHANGELOG `[0.44.0]` entry for the full flow.

| File | Mechanism |
|------|-----------|
| `index.html` | "Request a Video Call" floating button (via `call-request.js`) |
| `student-initial-test.html` | "Request a Video Call" floating button (via `call-request.js`) |
| `student-course.html` | "Request a Video Call" floating button (via `call-request.js`) |
| `examiner-panel.html` | Pending-request panel + Send Link / Mark as Done controls |

### Web Speech API (Browser)

| File | Speech Synthesis | Speech Recognition |
|------|-----------------|-------------------|
| `student-initial-test.html` | Listening passages + dictation audio | -- |
| `student-course.html` | Vocabulary pronunciation + listening passages | Pronunciation drills + free conversation |

### Formspree (Email)

| File | Usage |
|------|-------|
| `student-initial-test.html` | POSTs test results as JSON to Formspree endpoint |
| `examiner-marking.html` | Legacy: parses Formspree emails to import test data |

### localStorage (Client-Side)

| Key | Purpose | Set By |
|-----|---------|--------|
| `fp_student_name` | Student auto-login on hub | Hub, test, course |
| `fp_test_completed` | Test completion flag | Test |
| `fp_cefr_level` | Assigned CEFR level | Course |
| `fp_last_lesson_day` | Course progress (day number) | Course |
| `fp_last_lesson_date` | Last lesson date | Course |
| `fp_course_id` | Active course number (default 1) | Hub |
| `fp_hub_cache` | Cached hub progress + settings | Hub |
| `fp_achievements` | Earned achievement IDs | Hub |
| `fp_ckpt_test` | Placement test checkpoint | checkpoint.js |
| `fp_ckpt_lesson` | Course lesson checkpoint | checkpoint.js |
| `fluentpath_teacher` | Full teacher dashboard state | examiner-panel.js |

---

## Google Sheets Schema

The full database schema is documented in [`docs/google-sheets-schema.md`](docs/google-sheets-schema.md), covering 10 tabs:

| Tab | Purpose |
|-----|---------|
| **Initial Test Results** | Raw student test submissions |
| **Examiner Results** | Graded test results with CEFR levels, individual question scores (`score_q11`--`score_q24`), and per-question notes |
| **Course Progress** | Completed daily lesson records (with `course_id` for multi-course) |
| **Settings** | Teacher preferences, difficulty profiles, notification settings, `course_id` |
| **Lesson Marks** | Graded daily lesson scores (with `course_id`) |
| **Students** | Registered student names and join dates (auto-populated on first hub visit) |
| **Lesson Library** | AI-generated lesson cache for recycling |
| **Attendance** | Per-student attendance JSON and absence notes |
| **Vocabulary Tracker** | SRS word tracking per student (word, intervals, next review date) |
| **Error Log** | Server-side error log with timestamp, action, student, message |

---

## Technology Stack

- **Frontend:** Pure HTML, CSS, and vanilla JavaScript (no frameworks)
- **Code Quality:** ESLint 9 + Prettier + vitest (45 tests); CI/CD via GitHub Actions
- **Backend:** Google Apps Script (web app) with clasp version control (`npm run clasp:deploy`)
- **Offline:** Service worker with cache-first app shell, stale-while-revalidate API, IndexedDB POST queue
- **AI:** Pluggable provider (Gemini / Anthropic / OpenAI) via server-side proxy; default `gemini-2.5-flash` for lessons and summaries
- **Database:** Google Sheets (10 tabs) with CacheService + TextFinder optimisation
- **Styling:** CSS custom properties (WCAG AA), Flexbox, CSS Grid, media queries, shared `mobile.css`
- **Fonts:** Google Fonts (Playfair Display, Source Serif 4)
- **APIs:** AI provider (Gemini / Anthropic / OpenAI), Google Apps Script, Formspree, Web Speech API (TTS + STT)
- **Storage:** localStorage (checkpoints, preferences, achievements), Google Sheets (shared persistence)
- **Translation:** Level-aware Spanish with 4 modes (spanish-primary, tap-to-translate, teacher-gated, english-only)
- **Email:** Formspree (test results) + MailApp (teacher/student notifications)
- **Hosting:** GitHub Pages at [sgalindo88.github.io/fluentpath](https://sgalindo88.github.io/fluentpath/)
- **Local Dev:** DDEV + `npm run dev` with auto-detected staging environment

---

## CEFR Level Reference

| Level | Name | Theme | Description |
|-------|------|-------|-------------|
| **A1** | Beginner | Everyday Survival | Basic greetings, numbers, daily routines |
| **A2** | Elementary | Community & Life | Shopping, directions, social interactions |
| **B1** | Intermediate | The Workplace | Job interviews, emails, workplace communication |
| **B2** | Upper-Intermediate | Career & Society | Presentations, debates, current affairs |
| **C1** | Advanced | Professional Mastery | Academic writing, nuanced discussion, idioms |
| **C2** | Proficiency | Full Fluency | Complex rhetoric, literary analysis, near-native expression |
