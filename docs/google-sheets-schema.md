# FluentPath -- Google Sheets Schema

This document defines the structure for the Google Sheets workbook that stores all platform data. The Google Apps Script web app reads and writes these tabs via HTTP requests.

---

## Tab 1: Initial Test Results

Populated by `student-initial-test.html` when a student submits their placement test.

| Column | Type | Description | Example |
|--------|------|-------------|---------|
| submitted_at | DateTime | When the test was submitted | 2026-04-05T14:30:00Z |
| candidate_name | String | Student's full name | Maria Gonzalez |
| test_date | Date | Date the test was taken | 2026-04-05 |
| start_time | Time | When the student began | 14:00:05 |
| end_time | Time | When the student finished | 14:42:18 |
| duration | String | Formatted duration | 42m 13s |
| reading_score | String | Auto-scored reading total | 16 / 20 |
| listening_score | String | Auto-scored listening total | 8 / 15 |
| auto_total | String | Combined auto-scored marks | 24 / 35 |
| writing_score | String | Pending or graded | Pending examiner review (/ 25) |
| speaking_score | String | Pending or graded | Pending examiner review (/ 20) |
| mcq_answers | Text | Detailed MCQ results per question | Q1: B ✓\nQ2: A ✗ (correct: C)... |
| q11_passive_voice | Text | Student's text response | The cake was eaten by the children |
| q12_combined_sentence | Text | Student's text response | Although it was raining... |
| q13_error_correction | Text | Student's text response | She doesn't have any money |
| q14_writing_task | Text | Extended writing (120-150 words) | Dear friend, I am writing to... |
| q20_dictation | Text | Dictation transcription | The university library will be... |
| q21_speaking_notes | Text | Speaking prep notes (Part A intro) | I will talk about my family... |
| q22_speaking_notes | Text | Speaking prep notes (Part A topics) | My favourite hobby is... |
| q23_speaking_notes | Text | Speaking prep notes (Part B extended) | I think technology is... |
| q24_speaking_notes | Text | Speaking prep notes (Part C discussion) | In my opinion, education... |

---

## Tab 2: Examiner Results

Populated by the Teacher Dashboard when the teacher finishes marking a placement test.

| Column | Type | Description | Example |
|--------|------|-------------|---------|
| graded_at | DateTime | When marking was completed | 2026-04-05T16:00:00Z |
| candidate_name | String | Student's full name | Maria Gonzalez |
| test_date | Date | Date the test was taken | 2026-04-05 |
| examiner | String | Teacher's name | Mr. Johnson |
| reading_score | String | Reading section score | 16 / 20 |
| writing_score | String | Writing section score | 18 / 25 |
| listening_score | String | Listening section score | 12 / 15 |
| speaking_score | String | Speaking section score | 14 / 20 |
| total_score | String | Overall score | 60 / 80 |
| cefr_level | String | Assigned CEFR level | C1 |
| examiner_feedback | Text | Overall feedback narrative | Strong reading skills, needs work on... |
| notes_q11 | Text | Examiner notes for Q11 | Good passive construction, minor... |
| notes_q12 | Text | Examiner notes for Q12 | |
| notes_q13 | Text | Examiner notes for Q13 | |
| notes_q14 | Text | Examiner notes for Q14 | |
| notes_q21 | Text | Examiner notes for Q21 | |
| notes_q22 | Text | Examiner notes for Q22 | |
| notes_q23 | Text | Examiner notes for Q23 | |
| notes_q24 | Text | Examiner notes for Q24 | |

---

## Tab 3: Course Progress

Populated by `student-course.html` when a student completes a daily lesson.

| Column | Type | Description | Example |
|--------|------|-------------|---------|
| submitted_at | DateTime | When the lesson was completed | 2026-04-06T15:30:00Z |
| action | String | Always "save_progress" | save_progress |
| student_name | String | Student's full name | Maria Gonzalez |
| level | String | CEFR level (A1-C2) | B1 |
| lesson_date | Date | Date of the lesson | 2026-04-06 |
| day_number | Number | Lesson day (1-20) | 3 |
| start_time | Time | Lesson start time | 14:00:00 |
| end_time | Time | Lesson end time | 15:28:00 |
| time_spent_min | Number | Duration in minutes | 88 |
| topic | String | Lesson topic | Asking for Directions |
| confidence | String | Student self-assessment | Good |
| writing_response | Text | Student's writing (max 2000 chars) | Today I learned about... |
| student_notes | Text | Review notes (max 1000 chars) | I need to practice the... |
| warmup_response | Text | Warm-up answer (max 500 chars) | I usually go to work by... |
| speaking_transcript | Text | Free speaking transcript (max 1000) | I think that public transport... |
| answers_json | Text | All answers as JSON (max 3000 chars) | {"warmup":"...","listening_q1":0,...} |

---

## Tab 4: Settings (NEW)

Teacher preferences that student pages check at runtime. One row per student.

| Column | Type | Description | Example |
|--------|------|-------------|---------|
| student_name | String | Student's full name (lookup key) | Maria Gonzalez |
| teacher_name | String | Teacher's full name | Mr. Johnson |
| cefr_level | String | Assigned CEFR level | B1 |
| allow_spanish | Boolean | Allow Spanish UI hints (C1 only) | TRUE |
| allow_skip_test | Boolean | Allow student to skip placement test | FALSE |
| allow_retake_test | Boolean | Allow student to re-take placement test | FALSE |
| course_month | Number | Current month in course (1-6) | 1 |
| updated_at | DateTime | Last update timestamp | 2026-04-05T10:00:00Z |
| webhook_url | String | Google Apps Script URL | https://script.google.com/... |
| notes | Text | Teacher notes about student | Struggles with pronunciation... |

### How student pages use the Settings tab

Student pages make a GET request on load:
```
?action=get_settings&student=Maria+Gonzalez
```

Expected JSON response:
```json
{
  "found": true,
  "allow_spanish": true,
  "allow_skip_test": false,
  "cefr_level": "B1",
  "teacher_name": "Mr. Johnson"
}
```

The teacher dashboard writes to this tab when toggling settings:
```
POST action=update_settings&student_name=Maria+Gonzalez&allow_spanish=true
```

---

## Tab 5: Lesson Approvals (EXISTING -- used by course approval workflow)

Managed by the teacher dashboard and polled by the course page.

| Column | Type | Description | Example |
|--------|------|-------------|---------|
| lesson_id | String | Unique lesson identifier | lesson-maria-2026-04-06 |
| student_name | String | Student's full name | Maria Gonzalez |
| level | String | CEFR level | B1 |
| lesson_date | Date | Requested lesson date | 2026-04-06 |
| day_number | Number | Lesson day (1-20) | 3 |
| status | String | pending / approved / rejected | approved |
| requested_at | DateTime | When student requested | 2026-04-06T13:55:00Z |
| decided_at | DateTime | When teacher approved/rejected | 2026-04-06T14:00:00Z |
| teacher_code | String | Teacher identifier | mr-johnson |
| topic | String | Lesson topic (if generated) | Asking for Directions |

---

## Tab 6: Lesson Marks (EXISTING -- used by teacher dashboard marking)

Written by the teacher dashboard when marking a student's daily lesson.

| Column | Type | Description | Example |
|--------|------|-------------|---------|
| graded_at | DateTime | When marking was completed | 2026-04-06T18:00:00Z |
| teacher_name | String | Teacher's name | Mr. Johnson |
| student_name | String | Student's full name | Maria Gonzalez |
| lesson_date | Date | Date of the lesson | 2026-04-06 |
| day_number | Number | Lesson day (1-20) | 3 |
| level | String | CEFR level | B1 |
| writing_score | String | Writing section score | 18 / 25 |
| speaking_score | String | Speaking section score | 15 / 20 |
| total_score | String | Combined score | 33 / 45 |
| writing_breakdown | Text | JSON of component scores | {"task":6,"grammar":5,...} |
| speaking_breakdown | Text | JSON of component scores | {"fluency":4,"pron":4,...} |
| overall_feedback | Text | Teacher's narrative feedback | Good improvement in vocabulary... |

---

## Google Apps Script Actions Reference

All actions are sent to the same webhook URL. POST uses `application/x-www-form-urlencoded`. GET returns JSON.

| Action | Method | Source | Tab | Description |
|--------|--------|--------|-----|-------------|
| (none) | POST | student-initial-test | Initial Test Results | Submit test answers |
| (none) | POST | examiner-marking | Examiner Results | Submit graded test |
| request_approval | POST | student-course | Lesson Approvals | Student requests lesson |
| check_approval | GET | student-course | Lesson Approvals | Poll for approval status |
| save_progress | POST | student-course | Course Progress | Save completed lesson |
| get_pending | GET | examiner-panel | Lesson Approvals | Fetch pending queue |
| update_approval | POST | examiner-panel | Lesson Approvals | Approve/reject lesson |
| save_marks | POST | examiner-panel | Lesson Marks | Save lesson grades |
| get_progress | GET | index.html | Multiple | Fetch student journey status |
| get_settings | GET | student pages | Settings | Check teacher preferences |
| update_settings | POST | examiner-panel | Settings | Update teacher preferences |
| get_test_results | GET | examiner-panel | Initial Test Results | Pull test submissions for marking |
