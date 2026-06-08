# Future Update — Supabase Migration

**Status:** Deferred
**Estimated effort:** 45–60 hours (1–2 month sprint)
**Recommended trigger:** ~20 paying students, or when adding a second teacher, or when real-time features become important

---

## Overview

Migrate the FluentPath backend from **Google Apps Script + Google Sheets** to **[Supabase](https://supabase.com/)** (Postgres + Auth + Storage + Edge Functions).

---

## Scope

### What would change
- **All 24 API endpoints** in `apps-script.js` — either migrate to Supabase client calls or rewrite as Supabase Edge Functions
- **Authentication** — Supabase Auth replaces the APP_SECRET/TEACHER_SECRET token system (real user accounts with email/password or magic links)
- **Sheet schema** → Postgres tables (10 tables mirroring the current Google Sheets tabs)
- **Claude API proxy** — needs to stay server-side (Supabase Edge Function, or keep Apps Script just for this one call)
- **Audio storage** — Google Drive → Supabase Storage

### What stays the same
- All frontend HTML/CSS/JS structure
- The lesson content, placement test, and grading logic
- Service worker, i18n, achievements, accessibility
- clasp/Apps Script tooling stays ONLY if you keep Claude API calls there

---

## Effort estimate

| Phase | Work | Time |
|-------|------|------|
| Schema design | 10 Postgres tables with foreign keys, RLS policies | 4–6 hours |
| Supabase setup | Project, auth providers, RLS, storage buckets, API keys | 2–3 hours |
| Backend migration | Rewrite 24 handler functions as direct Supabase client calls or Edge Functions | 12–16 hours |
| Auth integration | Replace token system with Supabase Auth (login pages, session management, RLS) | 6–8 hours |
| Frontend API layer | Replace `FP.api.get/post` calls with `supabase.from().select()` etc. | 6–8 hours |
| Data migration | Export current Google Sheets → Supabase import scripts | 3–4 hours |
| Claude API proxy | Move to Supabase Edge Function (or keep in Apps Script) | 2–4 hours |
| Audio storage | Migrate upload/download to Supabase Storage | 3–4 hours |
| Testing | Update 45 tests, E2E verification | 4–6 hours |
| **Total** | | **~45–60 hours** |

---

## Benefits

- **Real SQL** — proper queries, joins, indexes (no more `TextFinder` tricks or full-sheet scans)
- **True authentication** — per-user login, session tokens, Row Level Security policies
- **Scalability** — Postgres handles 10,000× more data than Google Sheets
- **Real-time subscriptions** — teacher dashboard could update live when students submit
- **Better performance** — no 5–10s Apps Script cold starts
- **Free tier covers your scale** — 500MB database, 1GB storage, 50k monthly active users
- **Professional backups** — automated daily, point-in-time recovery

---

## Drawbacks

- **Teacher loses spreadsheet view** — can no longer open Google Sheets to manually review data (would need to build an admin view or use Supabase Studio)
- **More moving parts** — another service to maintain, monitor, debug
- **Learning curve** — RLS policies, Supabase Auth, SQL basics
- **Migration risk** — any bug in the migration could lose student data
- **Can't easily go back** — once committed, rolling back to Google Sheets is painful

---

## Recommended phased approach

### Phase A — Parallel Mirror (4 weeks)
Stand up Supabase in parallel. Read-only mirror of Google Sheets, nothing writes to it yet. Build the schema, test queries, migrate data weekly.

### Phase B — Auth in a New Dashboard (2 weeks)
Add Supabase Auth to a *new* version of the teacher dashboard. Students still use the Google Sheets backend.

### Phase C — Gradual Endpoint Migration (3 weeks)
Migrate endpoints one at a time. Keep the Apps Script webhook as a fallback. Use feature flags to switch between backends per endpoint.

### Phase D — Cut-over Weekend (1 week)
Freeze Google Sheets, final export/import, switch all traffic, monitor.

---

## Recommendation

**For current scale (2 students, pre-launch, single teacher), Supabase is overkill.**

### Reasons to defer
- Current system works and has been through 4 phases of hardening
- Platform is pre-launch — optimise for speed of iteration, not scale
- Google Sheets is actually a *feature* — manual data inspection/repair is valuable during early development
- Supabase migration is a 1–2 month project that would delay real teaching

### Reasons to do it
- Want per-student login with email/password (current name-based "login" is fragile)
- Planning to onboard 10+ teachers (current single-teacher model doesn't scale)
- Want real-time features (teacher sees student progress live)
- Planning to charge for the platform (need proper auth + audit trails)

**Trigger point:** start serious planning when you have ~20 paying students OR a second teacher joins OR you need real-time/login features.

---

## Pre-migration quick win

Before committing to the full migration, consider designing the Supabase schema (tables + RLS policies) as a **reference document**. This is a 30-minute task that:
- Forces you to think through the data model
- Gives you a concrete artifact to review
- Reveals any issues with the current Google Sheets structure
- Doesn't commit you to anything

---

## Supabase schema (preliminary sketch)

```sql
-- Users (students + teachers)
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE,
  full_name TEXT NOT NULL,
  role TEXT CHECK (role IN ('student', 'teacher')) NOT NULL,
  date_joined TIMESTAMPTZ DEFAULT NOW()
);

-- Student settings (one row per student)
CREATE TABLE student_settings (
  student_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  teacher_id UUID REFERENCES users(id),
  cefr_level TEXT,
  course_id INT DEFAULT 1,
  allow_spanish BOOLEAN DEFAULT false,
  allow_skip_test BOOLEAN DEFAULT false,
  allow_retake_test BOOLEAN DEFAULT false,
  difficulty_json JSONB,
  notes TEXT,
  notify_on_test BOOLEAN DEFAULT false,
  notify_on_submission BOOLEAN DEFAULT false,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Placement test submissions
CREATE TABLE placement_tests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID REFERENCES users(id),
  submitted_at TIMESTAMPTZ DEFAULT NOW(),
  mcq_answers JSONB,
  text_answers JSONB,
  reading_score INT,
  listening_score INT,
  writing_score INT,
  speaking_score INT,
  total_score INT,
  cefr_level TEXT,
  graded_at TIMESTAMPTZ,
  graded_by UUID REFERENCES users(id),
  notes_json JSONB
);

-- Daily lesson submissions
CREATE TABLE lesson_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID REFERENCES users(id),
  course_id INT DEFAULT 1,
  day_number INT NOT NULL,
  level TEXT NOT NULL,
  lesson_date DATE,
  submitted_at TIMESTAMPTZ DEFAULT NOW(),
  time_spent_min INT,
  paused_time_min INT,
  topic TEXT,
  confidence TEXT,
  writing_response TEXT,
  warmup_response TEXT,
  speaking_transcript TEXT,
  answers_json JSONB,
  speaking_audio_json JSONB,
  UNIQUE (student_id, course_id, day_number)
);

-- Lesson marks (teacher grading)
CREATE TABLE lesson_marks (
  submission_id UUID PRIMARY KEY REFERENCES lesson_submissions(id) ON DELETE CASCADE,
  graded_at TIMESTAMPTZ DEFAULT NOW(),
  teacher_id UUID REFERENCES users(id),
  writing_score INT,
  speaking_score INT,
  total_score TEXT,
  writing_breakdown JSONB,
  speaking_breakdown JSONB,
  overall_feedback TEXT
);

-- Attendance (one row per student, JSONB for day map)
CREATE TABLE attendance (
  student_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  attendance_json JSONB DEFAULT '{}'::JSONB,
  absence_notes TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Lesson library (AI-generated, reusable)
CREATE TABLE lesson_library (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  level TEXT NOT NULL,
  day INT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  source_student_id UUID REFERENCES users(id),
  original_difficulty_json JSONB,
  lesson_json JSONB NOT NULL,
  is_active BOOLEAN DEFAULT true,
  times_served INT DEFAULT 0
);
CREATE INDEX idx_library_level_day ON lesson_library (level, day) WHERE is_active = true;

-- Vocabulary tracker (SRS)
CREATE TABLE vocabulary_tracker (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID REFERENCES users(id) ON DELETE CASCADE,
  word TEXT NOT NULL,
  level TEXT,
  day_introduced DATE,
  last_reviewed DATE,
  review_count INT DEFAULT 0,
  next_review_date DATE,
  UNIQUE (student_id, word)
);

-- Error log
CREATE TABLE error_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  action TEXT,
  student_id UUID,
  message TEXT,
  params_json JSONB
);

-- Row Level Security policies (examples)
ALTER TABLE lesson_submissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Students see own submissions" ON lesson_submissions
  FOR SELECT USING (student_id = auth.uid());
CREATE POLICY "Teachers see all submissions" ON lesson_submissions
  FOR SELECT USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'teacher'));
CREATE POLICY "Students insert own submissions" ON lesson_submissions
  FOR INSERT WITH CHECK (student_id = auth.uid());
```

---

## References

- Supabase docs: https://supabase.com/docs
- Supabase Auth: https://supabase.com/docs/guides/auth
- Row Level Security: https://supabase.com/docs/guides/auth/row-level-security
- Edge Functions: https://supabase.com/docs/guides/functions
- Pricing: https://supabase.com/pricing (free tier likely sufficient for 50–100 students)
