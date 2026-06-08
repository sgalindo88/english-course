# FluentPath — Future Updates

Ideas, enhancements, and design alternatives we've discussed but deferred. Each entry should describe what the change is, why it might be worth doing, and what makes it complex or risky enough that we chose not to do it now.

---

## Lesson Library — Per-Component (Mix-and-Match) Recycling

**Status:** Deferred 2026-04-09 in favour of per-lesson recycling (the lesson library V1).

**What it is:** Instead of recycling whole lessons as atomic units, decompose each lesson into its 7 components (warmup, vocabulary, listening, speaking, practice, writing, review) and store them in 7 separate libraries. Each new lesson is assembled by mixing components from different source lessons — e.g. a vocabulary set from student #2's day 5, a listening passage from student #4's day 5, speaking drills from student #1's day 5, and a freshly generated writing prompt.

**Why it's appealing:**
- Vastly more variety from the same library size. A library of 5 entries per component at each `(level, day)` yields up to 5⁷ = 78 125 unique combinations per day, vs only 5 with whole-lesson recycling.
- The 100%/50%/20% tier ratios become finer-grained — "50% recycled" can literally mean 3-4 components from the library and 3-4 freshly generated within a single lesson.
- A great vocabulary set or listening passage can keep getting reused across many students without the rest of the lesson feeling stale.

**Why we deferred it:**
- **Topical coherence problem.** A vocabulary set about doctors paired with a listening passage about job interviews and a writing prompt about renting an apartment feels disjointed and confusing for the student. Solving this requires either tagging every component with a topic and matching by topic, or running the assembled lesson through Claude for a coherence pass — both add real complexity.
- **Per-component difficulty metadata.** Each component would need its own difficulty fingerprint (vocabulary density only really applies to the vocab component; writing length only applies to writing; listening speed only to listening). The difficulty match algorithm becomes per-component.
- **Schema is 7× the work.** Seven separate library tables, seven match algorithms, seven cache invalidation rules.
- **The variety win is theoretical.** With 5 entries per component you *could* generate 78 125 combinations, but most students only see 20 lessons total. Per-lesson recycling already gives more than enough variety once the library has 5+ entries per `(level, day)`.

**When to revisit:** If real students start reporting that recycled lessons feel repetitive after the library has 10+ entries per `(level, day)`, or if the cost of re-personalization (option C) becomes a meaningful share of API spend.

---

## Lesson Library — Migrate Storage from Sheets to Drive Folder

**Status:** Deferred 2026-04-09 in favour of a new "Lesson Library" sheet on the existing Google Sheet.

**What it is:** Move the lesson library from a sheet tab to a Google Drive folder structure — one JSON file per lesson, organised as `FluentPath Library/<level>/day-<NN>/lesson-<id>.json`. Apps Script reads/writes via `DriveApp`. An index file (or sheet) tracks which lessons exist where, so we don't have to list folders on every read.

**Why it's appealing:**
- Scales much further than Sheets — 10 000+ lessons is no problem (Sheets starts to slow down on `getDataRange().getValues()` once a tab passes ~5 000 rows).
- Cleaner schema — each lesson is a structured JSON file rather than a 3-5 KB string crammed into a cell.
- Easier to back up, share, or migrate (just zip the folder).
- Easier to manually edit a single bad lesson — open the file, edit JSON, save. No spreadsheet escaping pain.
- Removes the long `lesson_json` column from the Settings spreadsheet, which makes the rest of the sheet easier to browse.

**Why we deferred it:**
- **Pre-launch visibility matters more than scale.** Right now we want to *see* the library fill up, eyeball generated lessons for quality, and manually delete bad entries. A sheet tab does that natively in the spreadsheet UI; Drive requires opening files individually.
- **Drive permissions add friction.** The Apps Script project would need a one-time `DriveApp` consent prompt the first time it runs. Not hard, but more steps to deploy.
- **5 000-row Sheets ceiling is years away.** At ~5 lessons per `(level, day)` × 6 levels × 20 days = 600 lessons. Even at the long-term steady state of ~20 lessons per `(level, day)` we're at 2 400 — still well under the slowdown threshold.
- **Migration is straightforward when needed.** Same schema (id, level, day, lesson_json, original_difficulty_json, source_student, created_at), different storage backend. The library API in `apps-script.js` can hide the storage choice behind a single function so the rest of the code doesn't change.

**When to revisit:** When the Lesson Library sheet passes ~3 000 rows OR when generation latency starts being dominated by the library read (currently ~1-2 s on a generation that takes 5-15 s for Claude).

---

## Lesson Library — Tagged Recycling of Custom-Instructed Lessons

**Status:** Deferred 2026-04-09 in favour of "lessons generated with non-empty `aiInstructions` are never written to the library" (the simpler fix to the construction-worker-vs-nurse failure mode).

**What it is:** Instead of refusing to write custom-instructed lessons to the library, store them tagged with their original `aiInstructions` text. When the matcher considers a tagged entry, it only serves it to a new student whose own `aiInstructions` is "similar enough" — using string-similarity heuristics or a small Claude call to compare two pieces of free text.

**Why it's appealing:**
- Tier-3 students whose teachers wrote custom instructions still contribute back to the library, instead of those Claude calls being effectively wasted.
- A construction-worker lesson generated for student #4 could legitimately serve student #19 if student #19 is also a construction worker.
- The library grows faster, especially for levels where most teachers write custom instructions.

**Why we deferred it:**
- **Free-text similarity is genuinely hard.** Does "use construction vocabulary, hard hats, scaffolding" match "construction worker, building sites"? An LLM can answer reliably, but that's a separate Claude call on every library lookup — expensive enough to defeat the cost savings of recycling. String-similarity heuristics (Jaccard, token overlap) miss synonyms and paraphrases.
- **The win is small in the realistic case.** Most students with custom instructions are likely to be unique enough that no good match exists anyway. We'd be paying the implementation and runtime cost for matches that rarely fire.
- **Failure modes are subtle and hard to detect.** A near-miss match (e.g. "construction" vs "carpentry") could serve a lesson that's *almost* right but jarring. Teachers won't catch this until students complain.
- **Option (b) is good enough.** Refusing to recycle custom-instructed lessons is a small library-size cost in exchange for a clean guarantee: no recycled lesson ever bleeds another student's custom context.

**When to revisit:** If usage data shows that >30% of generated lessons have non-empty `aiInstructions` (so we're losing meaningful library contributions), AND we can prototype a similarity check cheap enough not to dominate the cost of recycling.

---

## Video Call Requests — Platform Picker and Saved Defaults

**Status:** Deferred 2026-04-12 in favour of a simple free-text link input (the call-request system V1).

**What it is:** When the teacher sends a call link in response to a student request, enhance the interface with either:
- A **dropdown picker** ("Zoom" / "WhatsApp" / "Google Meet" / "Other") that sets an icon/label the student sees alongside the link
- **Saved default links** stored in the teacher's settings (e.g. "My Zoom room" and "My WhatsApp number") — click one to send instantly, or fall back to a free-text field for one-off links

**Why it's appealing:**
- Students see at a glance which platform they're about to open — reduces confusion ("is this a Zoom link or WhatsApp?")
- Teachers don't have to paste the same Zoom link 20 times a week
- Could track per-student preferred platform based on usage history
- Platform icon in the student's banner would feel more polished than a bare "Join Call" button

**Why we deferred it:**
- **Free-text input covers 95% of cases.** Teachers just paste whatever link they already have open in another tab.
- **Saving default links adds UI surface** — need edit/delete controls, a settings section, validation, etc. Not worth it until the teacher is sending 5+ call links per day.
- **Platform detection can be automatic.** If we want the icon, a simple regex on the URL (`zoom.us`, `meet.google.com`, `wa.me`, `whatsapp.com`) can infer the platform without asking the teacher to choose.

**When to revisit:** When the teacher reports that pasting the same link repeatedly is a real friction, OR when we have multiple teachers each with their own default room.
