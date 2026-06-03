/* ═══════════════════════════════════════════════════════════════
   FluentPath — Google Apps Script (Web App)
   ─────────────────────────────────────────────────────────────
   Deployment:
     1. Open script.google.com → create or edit project
     2. Paste this entire file into Code.gs
     3. Set Script Properties (Project Settings → gear icon → Script Properties):
          AI_API_KEY:      (API key for your chosen AI provider)
          APP_SECRET:      (random 32-char string — shared with frontend config.local.js)
          TEACHER_SECRET:  (separate random string — only given to teachers)
        Optional:
          AI_PROVIDER:     gemini (default) | anthropic | openai
          AI_MODEL:        model id (default: gemini-2.5-flash)
     4. Deploy → New deployment → Web app
        - Execute as: Me
        - Who has access: Anyone
     5. Copy the deployment URL and use it in the platform
     6. In the frontend, create src/scripts/config.local.js (gitignored) and set
        FP.APP_TOKEN and FP.TEACHER_TOKEN to match the Script Properties

   Handles all GET (reads + AI lesson generation) and POST (writes) for FluentPath.
   ═══════════════════════════════════════════════════════════════ */

// ══════════════════════════════════════════════════════
// AI PROVIDER CONFIG (pluggable)
// ──────────────────────────────────────────────────────
// Switch providers via Script Properties — no code change:
//   AI_PROVIDER : 'gemini' (default) | 'anthropic' | 'openai'
//   AI_API_KEY  : the key for that provider
//   AI_MODEL    : model id (default: gemini-2.5-flash)
// Each adapter knows how to build the request and pull the text
// out of that provider's response shape.
// ══════════════════════════════════════════════════════
var AI_DEFAULT_MODEL = 'gemini-2.5-flash';
var AI_MAX_TOKENS = 4096;

var AI_PROVIDERS = {
  gemini: {
    buildRequest: function(apiKey, model, prompt, maxTokens) {
      return {
        url: 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent',
        options: {
          method:      'post',
          contentType: 'application/json',
          headers:     { 'x-goog-api-key': apiKey },
          payload:     JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { maxOutputTokens: maxTokens }
          }),
          muteHttpExceptions: true
        }
      };
    },
    extractText: function(body) {
      var c = body && body.candidates && body.candidates[0];
      var parts = c && c.content && c.content.parts;
      return parts && parts[0] && parts[0].text;
    },
    extractError: function(body, code) {
      return (body && body.error && body.error.message) || ('HTTP ' + code);
    }
  },

  anthropic: {
    buildRequest: function(apiKey, model, prompt, maxTokens) {
      return {
        url: 'https://api.anthropic.com/v1/messages',
        options: {
          method:      'post',
          contentType: 'application/json',
          headers:     { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
          payload:     JSON.stringify({ model: model, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }),
          muteHttpExceptions: true
        }
      };
    },
    extractText: function(body) {
      var c = body && body.content && body.content[0];
      return c && c.type === 'text' && c.text;
    },
    extractError: function(body, code) {
      return (body && body.error && body.error.message) || ('HTTP ' + code);
    }
  },

  openai: {
    buildRequest: function(apiKey, model, prompt, maxTokens) {
      return {
        url: 'https://api.openai.com/v1/chat/completions',
        options: {
          method:      'post',
          contentType: 'application/json',
          headers:     { 'Authorization': 'Bearer ' + apiKey },
          payload:     JSON.stringify({ model: model, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }),
          muteHttpExceptions: true
        }
      };
    },
    extractText: function(body) {
      var c = body && body.choices && body.choices[0];
      return c && c.message && c.message.content;
    },
    extractError: function(body, code) {
      return (body && body.error && body.error.message) || ('HTTP ' + code);
    }
  }
};

// Single entry point for all AI generation. Reads the active provider/key/model
// from Script Properties, dispatches to the matching adapter, and returns the
// generated text. Throws on misconfiguration or API error.
function aiGenerate(prompt) {
  var props    = PropertiesService.getScriptProperties();
  var apiKey   = props.getProperty('AI_API_KEY');
  if (!apiKey) throw new Error('AI_API_KEY not set in Script Properties');

  var provider = (props.getProperty('AI_PROVIDER') || 'gemini').toLowerCase();
  var adapter  = AI_PROVIDERS[provider];
  if (!adapter) throw new Error('Unknown AI_PROVIDER "' + provider + '" (expected gemini, anthropic, or openai)');

  var model = props.getProperty('AI_MODEL') || AI_DEFAULT_MODEL;
  var req   = adapter.buildRequest(apiKey, model, prompt, AI_MAX_TOKENS);

  var resp = UrlFetchApp.fetch(req.url, req.options);
  var code = resp.getResponseCode();
  var body = JSON.parse(resp.getContentText());

  if (code >= 400) throw new Error('AI API error (' + provider + '): ' + adapter.extractError(body, code));

  var text = adapter.extractText(body);
  if (!text) throw new Error('AI API returned no text content (' + provider + ')');
  return text;
}

// Strip a leading/trailing markdown code fence the model may have added around JSON.
function stripJsonFences(text) {
  return String(text).replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
}

// ══════════════════════════════════════════════════════
// AUTHENTICATION
// ══════════════════════════════════════════════════════

/**
 * Validate the request token against Script Properties.
 * - APP_SECRET  → required for all requests (student + teacher)
 * - TEACHER_SECRET → required only for teacher/write endpoints
 *
 * Setup: Project Settings → Script Properties → Add:
 *   APP_SECRET:     (random 32-char string shared with the frontend)
 *   TEACHER_SECRET: (separate secret known only to the teacher)
 */
function validateToken(params) {
  var props = PropertiesService.getScriptProperties();
  var appSecret = props.getProperty('APP_SECRET');
  // If no APP_SECRET is configured yet, skip validation (first-run grace)
  if (!appSecret) return true;
  var token = String(params['token'] || '').trim();
  return token === appSecret;
}

function validateTeacherToken(params) {
  var props = PropertiesService.getScriptProperties();
  var teacherSecret = props.getProperty('TEACHER_SECRET');
  // If no TEACHER_SECRET is configured, fall back to APP_SECRET check only
  if (!teacherSecret) return validateToken(params);
  var token = String(params['teacher_token'] || '').trim();
  return token === teacherSecret && validateToken(params);
}

/** Actions that require teacher-level auth */
var TEACHER_ACTIONS = {
  'save_marks': true,
  'update_settings': true,
  'save_attendance': true,
  'delete_library_entry': true,
  'ai_summary': true,
  'promote_student': true,
  'send_call_link': true
  // Note: update_call_status is student-callable too (they can dismiss)
  // Note: request_video_call is student-callable (only needs app token)
};

/** POST actions that write Examiner Results (no explicit action field) */
function isExaminerPost(params) {
  return (params['sheet_name'] || '').trim() === 'Examiner Results';
}

// ══════════════════════════════════════════════════════
// INPUT VALIDATION
// ══════════════════════════════════════════════════════

/** Require a non-empty string parameter. Throws on missing/blank. */
function requireParam(params, key) {
  var val = params[key];
  if (val === undefined || val === null || !String(val).trim()) {
    throw new Error('Missing required parameter: ' + key);
  }
  return String(val).trim();
}

/** Validate a numeric score within [min, max]. Returns the number. */
function validateScore(value, min, max) {
  var n = parseFloat(value);
  if (isNaN(n) || n < min || n > max) {
    throw new Error('Score out of range (' + min + '–' + max + '): ' + value);
  }
  return n;
}

/** Validate a date string is non-empty and plausible. */
function validateDate(value) {
  if (!value || !String(value).trim()) return '';
  var d = new Date(String(value).trim());
  if (isNaN(d.getTime())) throw new Error('Invalid date: ' + value);
  return String(value).trim();
}

// ══════════════════════════════════════════════════════
// CACHING (CacheService)
// ══════════════════════════════════════════════════════

var CACHE_TTL = 300; // 5 minutes

/** Get cached JSON for a key, or null if not found / expired. */
function cacheGet(key) {
  try {
    var raw = CacheService.getScriptCache().get(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

/** Store a JSON-serialisable value in the script cache. */
function cachePut(key, value) {
  try {
    CacheService.getScriptCache().put(key, JSON.stringify(value), CACHE_TTL);
  } catch (e) { /* quota exceeded or unavailable */ }
}

/** Invalidate cache entries related to a student (called after writes). */
function cacheInvalidateStudent(studentName) {
  if (!studentName) return;
  var lower = String(studentName).toLowerCase().trim();
  var keys = [
    'progress_' + lower,
    'settings_' + lower,
    'attendance_' + lower,
    'test_results_' + lower,
    'all_submissions_' + lower
  ];
  try { CacheService.getScriptCache().removeAll(keys); } catch (e) {}
}

// ══════════════════════════════════════════════════════
// EMAIL NOTIFICATIONS
// ══════════════════════════════════════════════════════

/**
 * Load notification settings for a student from the Settings sheet.
 * Returns { teacherEmail, studentEmail, notifyOnTest, notifyOnSubmission }
 */
function getNotificationSettings(studentName) {
  var row = findLastByStudent('Settings', HEADERS['Settings'], studentName);
  if (!row) return null;
  return {
    teacherEmail:        String(row['teacher_email'] || '').trim(),
    studentEmail:        String(row['student_email'] || '').trim(),
    notifyOnTest:        String(row['notify_on_test']).toLowerCase() === 'true',
    notifyOnSubmission:  String(row['notify_on_submission']).toLowerCase() === 'true',
    notifyOnCallRequest: String(row['notify_on_call_request']).toLowerCase() !== 'false', // default ON
    cefrLevel:           String(row['cefr_level'] || '').trim(),
  };
}

/**
 * Send a notification email. Silently fails if MailApp is unavailable or
 * the email is empty — notifications are best-effort, never blocking.
 */
function sendNotificationEmail(to, subject, htmlBody) {
  if (!to) return;
  try {
    MailApp.sendEmail({ to: to, subject: subject, htmlBody: htmlBody });
  } catch (e) {
    logError('notification', to, 'Email send failed: ' + e.message, { subject: subject });
  }
}

/** Notify the teacher that a student submitted a placement test. */
function notifyTeacherTestSubmitted(studentName) {
  var ns = getNotificationSettings(studentName);
  if (!ns || !ns.notifyOnTest || !ns.teacherEmail) return;
  sendNotificationEmail(
    ns.teacherEmail,
    'FluentPath: ' + studentName + ' submitted placement test',
    '<p><strong>' + studentName + '</strong> has submitted their placement test and is awaiting grading.</p>' +
    '<p><a href="https://sgalindo88.github.io/fluentpath/teacher.html">Open Dashboard</a></p>'
  );
}

/** Notify the teacher that a student completed a lesson. */
function notifyTeacherLessonSubmitted(studentName, dayNumber) {
  var ns = getNotificationSettings(studentName);
  if (!ns || !ns.notifyOnSubmission || !ns.teacherEmail) return;
  sendNotificationEmail(
    ns.teacherEmail,
    'FluentPath: ' + studentName + ' completed Day ' + dayNumber,
    '<p><strong>' + studentName + '</strong> has completed Day ' + dayNumber + ' and is ready for grading.</p>' +
    '<p><a href="https://sgalindo88.github.io/fluentpath/teacher.html">Open Dashboard</a></p>'
  );
}

/** Notify the teacher that a student has requested a video call. */
function notifyTeacherCallRequest(studentName, page, dayNumber) {
  var ns = getNotificationSettings(studentName);
  if (!ns || !ns.notifyOnCallRequest || !ns.teacherEmail) return;
  var pageLabel = page === 'hub' ? 'the student hub'
                : page === 'test' ? 'the placement test'
                : page === 'lesson' ? ('Day ' + (dayNumber || '?') + ' lesson')
                : page;
  var ts = new Date().toLocaleString();
  var cefr = ns.cefrLevel ? ' (level ' + ns.cefrLevel + ')' : '';
  sendNotificationEmail(
    ns.teacherEmail,
    'FluentPath: ' + studentName + ' requested a video call',
    '<p><strong>' + studentName + '</strong>' + cefr + ' has requested a video call.</p>' +
    '<ul>' +
      '<li>Page: ' + pageLabel + '</li>' +
      '<li>Requested at: ' + ts + '</li>' +
    '</ul>' +
    '<p><a href="https://sgalindo88.github.io/fluentpath/src/examiner-panel.html?student=' +
      encodeURIComponent(studentName) + '">Open ' + studentName + '\'s dashboard</a></p>'
  );
}

/** Notify the student that their placement test has been graded. */
function notifyStudentTestGraded(studentName, cefrLevel) {
  var ns = getNotificationSettings(studentName);
  if (!ns || !ns.studentEmail) return;
  sendNotificationEmail(
    ns.studentEmail,
    'FluentPath: Your placement test has been graded',
    '<p>Your teacher has reviewed your placement test.</p>' +
    '<p>Your level: <strong>' + (cefrLevel || 'TBD') + '</strong></p>' +
    '<p><a href="https://sgalindo88.github.io/fluentpath/">View your progress</a></p>'
  );
}

// ══════════════════════════════════════════════════════
// ERROR LOGGING
// ══════════════════════════════════════════════════════

/** Log an error to the Error Log sheet for server-side debugging. */
function logError(action, student, message, params) {
  try {
    var sheet = getOrCreateSheet('Error Log', ['timestamp', 'action', 'student', 'message', 'params']);
    sheet.appendRow([
      new Date().toISOString(),
      action || '',
      student || '',
      message || '',
      JSON.stringify(params || {}).substring(0, 2000)
    ]);
  } catch (e) { /* logging itself failed — nothing we can do */ }
}

// ══════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════

/** Get a sheet by name, creating it with headers if it doesn't exist */
function getOrCreateSheet(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (headers && headers.length > 0) {
      sheet.appendRow(headers);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    }
  }
  return sheet;
}

/** Read all rows from a sheet and return as array of objects */
function sheetToObjects(sheet) {
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  var headers = data[0];
  var results = [];
  for (var i = 1; i < data.length; i++) {
    var obj = {};
    for (var j = 0; j < headers.length; j++) {
      obj[String(headers[j]).trim()] = data[i][j];
    }
    results.push(obj);
  }
  return results;
}

/** Find the last row matching a student name (case-insensitive).
 *  Uses TextFinder for targeted lookup instead of scanning every row. */
function findLastByStudent(sheetName, headers, studentName) {
  var sheet = getOrCreateSheet(sheetName, headers);
  if (sheet.getLastRow() < 2) return null;

  // Determine which column holds the name
  var headerRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(function(h) { return String(h).trim(); });
  var nameColumns = ['candidate_name', 'student_name', 'name'];
  var nameColIdx = -1;
  for (var k = 0; k < nameColumns.length; k++) {
    nameColIdx = headerRow.indexOf(nameColumns[k]);
    if (nameColIdx >= 0) break;
  }
  if (nameColIdx < 0) return null;

  // Use TextFinder to locate matching rows (faster than scanning all data)
  var nameRange = sheet.getRange(2, nameColIdx + 1, sheet.getLastRow() - 1, 1);
  var finder = nameRange.createTextFinder(String(studentName).trim())
    .matchCase(false)
    .matchEntireCell(true);
  var matches = finder.findAll();
  if (matches.length === 0) return null;

  // Take the last match and read the full row
  var lastMatch = matches[matches.length - 1];
  var rowNum = lastMatch.getRow();
  var rowData = sheet.getRange(rowNum, 1, 1, headerRow.length).getValues()[0];

  // Build object from headers
  var obj = {};
  for (var j = 0; j < headerRow.length; j++) {
    obj[headerRow[j]] = rowData[j];
  }
  return obj;
}

/**
 * Ensure the sheet's header row contains every column in `expectedHeaders`.
 * Missing columns are appended on the right (existing columns and data are
 * left in place). Returns the actual header row after extension.
 */
function ensureSheetHeaders(sheet, expectedHeaders) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(expectedHeaders);
    sheet.getRange(1, 1, 1, expectedHeaders.length).setFontWeight('bold');
    return expectedHeaders.slice();
  }
  var actual = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(function(h) { return String(h).trim(); });
  var missing = expectedHeaders.filter(function(h) { return actual.indexOf(h) < 0; });
  if (missing.length === 0) return actual;

  var startCol = actual.length + 1;
  sheet.getRange(1, startCol, 1, missing.length).setValues([missing]);
  sheet.getRange(1, startCol, 1, missing.length).setFontWeight('bold');
  return actual.concat(missing);
}

/** Upsert a row: update if student exists, insert if not.
 *  Matches data fields against the sheet's ACTUAL header row (not the
 *  HEADERS constant) so adding new columns to HEADERS doesn't misalign
 *  rows in existing sheets. Auto-extends the sheet with any missing columns. */
function upsertByStudent(sheetName, headers, studentName, data) {
  var sheet = getOrCreateSheet(sheetName, headers);
  var actualHeaders = ensureSheetHeaders(sheet, headers);

  var nameColIndex = -1;
  var nameColumns = ['student_name', 'candidate_name', 'name'];
  for (var k = 0; k < nameColumns.length; k++) {
    nameColIndex = actualHeaders.indexOf(nameColumns[k]);
    if (nameColIndex >= 0) break;
  }

  var target = String(studentName).toLowerCase().trim();
  var existingRow = -1;

  if (nameColIndex >= 0 && sheet.getLastRow() > 1) {
    var nameValues = sheet.getRange(2, nameColIndex + 1, sheet.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < nameValues.length; i++) {
      if (String(nameValues[i][0]).toLowerCase().trim() === target) {
        existingRow = i + 2; // 1-based, skipping header row
        break;
      }
    }
  }

  // Build the row using ACTUAL sheet headers — preserves alignment if the
  // sheet has extra columns or a different order than the constant.
  var rowData = actualHeaders.map(function(h) {
    return data[h] !== undefined ? data[h] : '';
  });

  if (existingRow > 0) {
    sheet.getRange(existingRow, 1, 1, rowData.length).setValues([rowData]);
  } else {
    sheet.appendRow(rowData);
  }
}


// ══════════════════════════════════════════════════════
// SHEET DEFINITIONS (headers for each tab)
// ══════════════════════════════════════════════════════

var HEADERS = {
  'Initial Test Results': [
    'submitted_at', 'candidate_name', 'test_date', 'start_time', 'end_time', 'duration',
    'reading_score', 'listening_score', 'auto_total',
    'writing_score', 'speaking_score', 'mcq_answers',
    'q11_passive_voice', 'q12_combined_sentence', 'q13_error_correction',
    'q14_writing_task', 'q20_dictation',
    'q21_speaking_notes', 'q22_speaking_notes',
    'q23_speaking_notes', 'q24_speaking_notes'
  ],
  'Examiner Results': [
    'graded_at', 'candidate_name', 'test_date', 'examiner',
    'reading_score', 'writing_score', 'listening_score', 'speaking_score',
    'total_score', 'cefr_level',
    'examiner_feedback',
    'score_q11', 'score_q12', 'score_q13', 'score_q14', 'score_q20',
    'score_q21', 'score_q22', 'score_q23', 'score_q24',
    'notes_q11', 'notes_q12', 'notes_q13', 'notes_q14',
    'notes_q21', 'notes_q22', 'notes_q23', 'notes_q24'
  ],
  'Course Progress': [
    'submitted_at', 'action', 'student_name', 'level',
    'lesson_date', 'day_number', 'start_time', 'end_time',
    'time_spent_min', 'topic', 'confidence',
    'writing_response', 'student_notes', 'warmup_response',
    'speaking_transcript', 'answers_json', 'speaking_audio_json',
    'course_id'
  ],
  'Settings': [
    'student_name', 'teacher_name', 'cefr_level',
    'allow_spanish', 'allow_skip_test', 'allow_retake_test',
    'course_month', 'updated_at', 'notes',
    'difficulty_json',
    'teacher_email', 'student_email',
    'notify_on_test', 'notify_on_submission', 'notify_on_call_request',
    'course_id'
  ],
  'Lesson Marks': [
    'graded_at', 'teacher_name', 'student_name',
    'lesson_date', 'day_number', 'level',
    'writing_score', 'speaking_score', 'total_score',
    'writing_breakdown', 'speaking_breakdown', 'overall_feedback',
    'course_id'
  ],
  'Students': [
    'student_name', 'date_joined'
  ],
  'Attendance': [
    'student_name', 'attendance_json', 'absence_notes', 'updated_at'
  ],
  'Lesson Library': [
    'id', 'level', 'day', 'created_at', 'source_student',
    'original_difficulty_json', 'lesson_json', 'is_active', 'times_served'
  ],
  'Vocabulary Tracker': [
    'student_name', 'word', 'level', 'day_introduced',
    'last_reviewed', 'review_count', 'next_review_date'
  ],
  'Video Call Requests': [
    'id', 'student_name', 'requested_at', 'page', 'day_number',
    'call_link', 'link_sent_at', 'status'
  ]
};


// ══════════════════════════════════════════════════════
// doGET — dispatch table for all read requests
// ══════════════════════════════════════════════════════

var GET_HANDLERS = {
  get_progress:          function(p) { return handleGetProgress(p.student, p.course_id); },
  get_settings:          function(p) { return handleGetSettings(p.student); },
  get_test_results:      function(p) { return handleGetTestResults(p.student); },
  get_latest_submission: function(p) { return handleGetLatestSubmission(p.student, (p.day || '').trim()); },
  get_all_submissions:   function(p) { return handleGetAllSubmissions(p.student); },
  get_students:          function(_) { return handleGetStudents(); },
  get_attendance:        function(p) { return handleGetAttendance(p.student); },
  generate_lesson:       function(p) { return handleGenerateLesson(p.level, parseInt(p.day, 10), p.topic, String(p.spanish || '').toLowerCase() === 'true', p.student); },
  get_library:           function(_) { return handleGetLibrary(); },
  get_library_entry:     function(p) { return handleGetLibraryEntry(p.id); },
  get_audio:             function(p) { return handleGetAudio(p.id); },
  get_errors:            function(_) { return handleGetErrors(); },
  get_student_report:    function(p) { return handleGetStudentReport(p.student); },
  get_class_overview:    function(_) { return handleGetClassOverview(); },
  health:                function(_) { return handleHealth(); },
  get_active_call_request: function(p) { return handleGetActiveCallRequest(p.student); },
  get_call_requests:     function(_) { return handleGetCallRequests(); },
};

function doGet(e) {
  var action = (e.parameter.action || '').trim();
  var student = (e.parameter.student || '').trim();

  // ── Auth check (skip for health endpoint — uptime monitors can't authenticate) ──
  if (action !== 'health' && !validateToken(e.parameter)) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: 'Unauthorized' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  var result;
  try {
    var handler = GET_HANDLERS[action];
    result = handler ? handler(e.parameter) : { error: 'Unknown action: ' + action };
  } catch (err) {
    logError(action, student, err.message, e.parameter);
    result = { error: err.message };
  }

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}


// ── GET: get_progress ──────────────────────────────────
// Returns the student's journey status for the hub page (cached 5 min).
// Optional course_id filters to a specific course (default: current from Settings, fallback 1).
function handleGetProgress(studentName, courseId) {
  if (!studentName) return { found: false };

  // Determine active course_id from Settings if not explicitly provided
  if (!courseId) {
    var settingsRow = findLastByStudent('Settings', HEADERS['Settings'], studentName);
    courseId = (settingsRow && settingsRow['course_id']) ? String(settingsRow['course_id']).trim() : '1';
  }
  courseId = String(courseId).trim() || '1';

  var cacheKey = 'progress_' + String(studentName).toLowerCase().trim() + '_c' + courseId;
  var cached = cacheGet(cacheKey);
  if (cached) return cached;

  var result = {
    found: false,
    test_completed: false,
    test_date: null,
    cefr_level: null,
    total_score: null,
    lessons_completed: 0,
    last_lesson_date: null,
    lessons: [],
    course_id: courseId
  };

  // Check if placement test was taken
  var testRow = findLastByStudent('Initial Test Results', HEADERS['Initial Test Results'], studentName);
  if (testRow) {
    result.found = true;
    result.test_completed = true;
    result.test_date = testRow['test_date'] || testRow['date'] || null;
  }

  // Check if test has been graded (CEFR level assigned)
  var gradedRow = findLastByStudent('Examiner Results', HEADERS['Examiner Results'], studentName);
  if (gradedRow) {
    result.found = true;
    result.cefr_level = gradedRow['cefr_level'] || null;
    result.total_score = gradedRow['total_score'] || null;
  }

  // Check course progress
  var progressSheet = getOrCreateSheet('Course Progress', HEADERS['Course Progress']);
  var progressRows = sheetToObjects(progressSheet);
  var target = String(studentName).toLowerCase().trim();
  var lessons = [];

  // Read Lesson Marks to join writing_score + speaking_score by day (filtered by course_id)
  var marksSheet = getOrCreateSheet('Lesson Marks', HEADERS['Lesson Marks']);
  var marksRows = sheetToObjects(marksSheet);
  var marksByDay = {};
  for (var m = 0; m < marksRows.length; m++) {
    if (String(marksRows[m]['student_name'] || '').toLowerCase().trim() !== target) continue;
    var mCourse = String(marksRows[m]['course_id'] || '1').trim();
    if (mCourse !== courseId) continue;
    marksByDay[String(marksRows[m]['day_number'])] = marksRows[m];
  }

  for (var i = 0; i < progressRows.length; i++) {
    var name = String(progressRows[i]['student_name'] || '').toLowerCase().trim();
    // Filter by student and course_id (rows without course_id default to '1')
    var rowCourseId = String(progressRows[i]['course_id'] || '1').trim();
    if (name === target && rowCourseId === courseId) {
      result.found = true;
      var dayKey = String(progressRows[i]['day_number'] || '');
      var dayMarks = marksByDay[dayKey];
      lessons.push({
        day: progressRows[i]['day_number'],
        topic: progressRows[i]['topic'] || '',
        date: progressRows[i]['lesson_date'] || '',
        time_spent: progressRows[i]['time_spent_min'] || '',
        confidence: progressRows[i]['confidence'] || '',
        writing_score: dayMarks ? (dayMarks['writing_score'] || null) : null,
        speaking_score: dayMarks ? (dayMarks['speaking_score'] || null) : null,
        answers_json: progressRows[i]['answers_json'] || ''
      });
    }
  }

  // Sort lessons by day number ascending
  lessons.sort(function(a, b) { return parseInt(a.day || 0) - parseInt(b.day || 0); });
  result.lessons = lessons;
  result.lessons_completed = lessons.length;
  if (lessons.length > 0) {
    result.last_lesson_date = lessons[lessons.length - 1].date;
  }

  // Auto-register student in Students tab if not already present
  var studentsSheet = getOrCreateSheet('Students', HEADERS['Students']);
  var studentsRows = sheetToObjects(studentsSheet);
  var alreadyRegistered = false;
  for (var s = 0; s < studentsRows.length; s++) {
    var sName = studentsRows[s]['student_name'] || studentsRows[s]['Student Name'] || '';
    if (String(sName).toLowerCase().trim() === target) {
      alreadyRegistered = true;
      break;
    }
  }
  if (!alreadyRegistered) {
    studentsSheet.appendRow([studentName, new Date().toISOString().split('T')[0]]);
  }

  cachePut(cacheKey, result);
  return result;
}


// ── GET: get_students ─────────────────────────────────
// Returns list of all registered students
function handleGetStudents() {
  var sheet = getOrCreateSheet('Students', HEADERS['Students']);
  var rows = sheetToObjects(sheet);
  var students = [];
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var name = row['student_name'] || row['Student Name'] || '';
    var joined = row['date_joined'] || row['Date joined'] || '';
    // Format Date objects to YYYY-MM-DD string
    if (joined instanceof Date) {
      joined = joined.toISOString().split('T')[0];
    }
    if (name) {
      students.push({ name: String(name), date_joined: String(joined) });
    }
  }
  return { found: true, students: students };
}


// ── GET: get_class_overview ───────────────────────────
// Returns a summary row for every registered student (for the Class Overview panel)
function handleGetClassOverview() {
  var studentsSheet = getOrCreateSheet('Students', HEADERS['Students']);
  var studentRows = sheetToObjects(studentsSheet);
  if (studentRows.length === 0) return { found: true, students: [] };

  // Pre-load all shared sheets once (avoid per-student reads)
  var examinerRows    = sheetToObjects(getOrCreateSheet('Examiner Results', HEADERS['Examiner Results']));
  var progressRows    = sheetToObjects(getOrCreateSheet('Course Progress', HEADERS['Course Progress']));
  var marksRows       = sheetToObjects(getOrCreateSheet('Lesson Marks', HEADERS['Lesson Marks']));
  var attendanceRows  = sheetToObjects(getOrCreateSheet('Attendance', HEADERS['Attendance']));

  // Index by student (lowercase), trying multiple possible header names
  function indexByStudent(rows, nameKeys) {
    var keys = Array.isArray(nameKeys) ? nameKeys : [nameKeys];
    var map = {};
    rows.forEach(function(r) {
      var n = '';
      for (var k = 0; k < keys.length; k++) {
        n = String(r[keys[k]] || '').trim();
        if (n) break;
      }
      if (!n) return;
      var lower = n.toLowerCase();
      if (!map[lower]) map[lower] = [];
      map[lower].push(r);
    });
    return map;
  }
  var examByStudent    = indexByStudent(examinerRows, ['candidate_name', 'Candidate Name']);
  var progByStudent    = indexByStudent(progressRows, ['student_name', 'Student Name']);
  var marksByStudent   = indexByStudent(marksRows, ['student_name', 'Student Name']);
  var attendByStudent  = indexByStudent(attendanceRows, ['student_name', 'Student Name']);

  var result = [];
  for (var i = 0; i < studentRows.length; i++) {
    var name = String(studentRows[i]['student_name'] || studentRows[i]['Student Name'] || '').trim();
    if (!name) continue;
    var key = name.toLowerCase().trim();

    // Level
    var exams = examByStudent[key] || [];
    var level = '';
    if (exams.length > 0) {
      var lastExam = exams[exams.length - 1];
      level = lastExam['cefr_level'] || lastExam['CEFR Level'] || '';
    }

    // Course progress
    var lessons = progByStudent[key] || [];
    var daysCompleted = lessons.length;
    var lastActive = '';
    if (lessons.length > 0) {
      var dates = lessons.map(function(l) { return l['lesson_date'] || l['Lesson Date'] || l['submitted_at'] || ''; }).filter(Boolean);
      if (dates.length > 0) lastActive = dates[dates.length - 1];
    }

    // Ungraded count
    var marks = marksByStudent[key] || [];
    var gradedDays = {};
    marks.forEach(function(m) { gradedDays[String(m['day_number'])] = true; });
    var ungradedCount = lessons.filter(function(l) { return !gradedDays[String(l['day_number'])]; }).length;

    // Attendance %
    var attendRows = attendByStudent[key] || [];
    var attendPct = 0;
    if (attendRows.length > 0) {
      try {
        var aj = JSON.parse(attendRows[attendRows.length - 1]['attendance_json'] || '{}');
        var total = Object.keys(aj).length;
        var present = Object.values(aj).filter(function(v) { return v === 'present'; }).length;
        attendPct = total > 0 ? Math.round(present / total * 100) : 0;
      } catch (e) { /* parse error */ }
    }

    // Status: green (on track), yellow (needs attention), red (falling behind)
    var status = 'green';
    if (ungradedCount > 0 || daysCompleted === 0) status = 'yellow';
    if (ungradedCount >= 3 || (daysCompleted === 0 && !level)) status = 'red';

    result.push({
      name: name,
      level: level,
      days_completed: daysCompleted,
      last_active: lastActive,
      ungraded: ungradedCount,
      attendance_pct: attendPct,
      status: status,
    });
  }

  return { found: true, students: result };
}


// ── GET: get_attendance ───────────────────────────────
// Returns the attendance record for a student
function handleGetAttendance(studentName) {
  if (!studentName) return { found: false };
  var row = findLastByStudent('Attendance', HEADERS['Attendance'], studentName);
  if (!row) return { found: false };
  return {
    found: true,
    attendance_json: row['attendance_json'] || '{}',
    absence_notes: row['absence_notes'] || ''
  };
}


// ── GET: get_settings ──────────────────────────────────
// Returns teacher preferences for a student (cached 5 min)
function handleGetSettings(studentName) {
  if (!studentName) return { found: false };
  var cacheKey = 'settings_' + String(studentName).toLowerCase().trim();
  var cached = cacheGet(cacheKey);
  if (cached) return cached;

  var row = findLastByStudent('Settings', HEADERS['Settings'], studentName);
  if (!row) return { found: false };

  var result = {
    found: true,
    allow_spanish: String(row['allow_spanish']).toLowerCase() === 'true',
    allow_skip_test: String(row['allow_skip_test']).toLowerCase() === 'true',
    allow_retake_test: String(row['allow_retake_test']).toLowerCase() === 'true',
    cefr_level: row['cefr_level'] || null,
    teacher_name: row['teacher_name'] || null
  };
  cachePut(cacheKey, result);
  return result;
}


// ── GET: get_test_results ──────────────────────────────
// Returns the student's placement test submission AND any existing graded results
function handleGetTestResults(studentName) {
  if (!studentName) return { found: false };

  var row = findLastByStudent('Initial Test Results', HEADERS['Initial Test Results'], studentName);
  if (!row) return { found: false };

  row['found'] = true;

  // Also check if the test has already been graded (Examiner Results)
  var graded = findLastByStudent('Examiner Results', HEADERS['Examiner Results'], studentName);
  if (graded) {
    row['graded'] = true;
    row['graded_reading_score'] = graded['reading_score'] || '';
    row['graded_writing_score'] = graded['writing_score'] || '';
    row['graded_listening_score'] = graded['listening_score'] || '';
    row['graded_speaking_score'] = graded['speaking_score'] || '';
    row['graded_total_score'] = graded['total_score'] || '';
    row['graded_cefr_level'] = graded['cefr_level'] || '';
    row['graded_feedback'] = graded['examiner_feedback'] || '';
    // Individual question notes
    row['graded_notes_q11'] = graded['notes_q11'] || '';
    row['graded_notes_q12'] = graded['notes_q12'] || '';
    row['graded_notes_q13'] = graded['notes_q13'] || '';
    row['graded_notes_q14'] = graded['notes_q14'] || '';
    row['graded_notes_q21'] = graded['notes_q21'] || '';
    row['graded_notes_q22'] = graded['notes_q22'] || '';
    row['graded_notes_q23'] = graded['notes_q23'] || '';
    row['graded_notes_q24'] = graded['notes_q24'] || '';
    // Individual question scores (if saved)
    row['graded_q11'] = graded['score_q11'] || '';
    row['graded_q12'] = graded['score_q12'] || '';
    row['graded_q13'] = graded['score_q13'] || '';
    row['graded_q14'] = graded['score_q14'] || '';
    row['graded_q20'] = graded['score_q20'] || '';
    row['graded_q21'] = graded['score_q21'] || '';
    row['graded_q22'] = graded['score_q22'] || '';
    row['graded_q23'] = graded['score_q23'] || '';
    row['graded_q24'] = graded['score_q24'] || '';
  }

  return row;
}


// ── GET: get_latest_submission ─────────────────────────
// Returns the most recent lesson submission (prefers ungraded; falls back to latest graded)
// Also includes existing marks if the submission has been graded
function handleGetLatestSubmission(studentName, optionalDay) {
  if (!studentName) return { found: false };

  // Get all course progress rows for this student
  var progressSheet = getOrCreateSheet('Course Progress', HEADERS['Course Progress']);
  var progressRows = sheetToObjects(progressSheet);
  var target = String(studentName).toLowerCase().trim();

  // Get all graded days for this student (with their marks data)
  var marksSheet = getOrCreateSheet('Lesson Marks', HEADERS['Lesson Marks']);
  var marksRows = sheetToObjects(marksSheet);
  var gradedDays = {};
  for (var j = 0; j < marksRows.length; j++) {
    if (String(marksRows[j]['student_name'] || '').toLowerCase().trim() === target) {
      gradedDays[String(marksRows[j]['day_number'])] = marksRows[j];
    }
  }

  // If a specific day was requested, return that submission directly
  if (optionalDay) {
    var requestedDay = String(optionalDay);
    for (var d = 0; d < progressRows.length; d++) {
      var dName = String(progressRows[d]['student_name'] || '').toLowerCase().trim();
      if (dName === target && String(progressRows[d]['day_number'] || '') === requestedDay) {
        var specific = progressRows[d];
        specific['found'] = true;
        var sMarks = gradedDays[requestedDay];
        if (sMarks) {
          specific['has_marks'] = true;
          specific['marks_writing_score'] = sMarks['writing_score'] || '';
          specific['marks_speaking_score'] = sMarks['speaking_score'] || '';
          specific['marks_total_score'] = sMarks['total_score'] || '';
          specific['marks_writing_breakdown'] = sMarks['writing_breakdown'] || '';
          specific['marks_speaking_breakdown'] = sMarks['speaking_breakdown'] || '';
          specific['marks_overall_feedback'] = sMarks['overall_feedback'] || '';
        }
        return specific;
      }
    }
    return { found: false };
  }

  // Find the latest ungraded submission; track latest overall as fallback
  var latestUngraded = null;
  var latestOverall = null;
  for (var i = 0; i < progressRows.length; i++) {
    var name = String(progressRows[i]['student_name'] || '').toLowerCase().trim();
    if (name === target) {
      latestOverall = progressRows[i];
      var dayNum = String(progressRows[i]['day_number'] || '');
      if (!gradedDays[dayNum]) {
        latestUngraded = progressRows[i];
      }
    }
  }

  // Prefer ungraded; fall back to latest submission
  var latest = latestUngraded || latestOverall;
  if (!latest) return { found: false };

  latest['found'] = true;

  // Attach existing marks if this day has been graded
  var dayKey = String(latest['day_number'] || '');
  var marks = gradedDays[dayKey];
  if (marks) {
    latest['has_marks'] = true;
    latest['marks_writing_score'] = marks['writing_score'] || '';
    latest['marks_speaking_score'] = marks['speaking_score'] || '';
    latest['marks_total_score'] = marks['total_score'] || '';
    latest['marks_writing_breakdown'] = marks['writing_breakdown'] || '';
    latest['marks_speaking_breakdown'] = marks['speaking_breakdown'] || '';
    latest['marks_overall_feedback'] = marks['overall_feedback'] || '';
  }

  return latest;
}


// ── GET: get_all_submissions ──────────────────────────
// Returns a lightweight list of all submitted lessons for a student
function handleGetAllSubmissions(studentName) {
  if (!studentName) return { found: false };

  var progressSheet = getOrCreateSheet('Course Progress', HEADERS['Course Progress']);
  var progressRows = sheetToObjects(progressSheet);
  var target = String(studentName).toLowerCase().trim();

  var marksSheet = getOrCreateSheet('Lesson Marks', HEADERS['Lesson Marks']);
  var marksRows = sheetToObjects(marksSheet);
  var gradedDays = {};
  for (var j = 0; j < marksRows.length; j++) {
    if (String(marksRows[j]['student_name'] || '').toLowerCase().trim() === target) {
      gradedDays[String(marksRows[j]['day_number'])] = true;
    }
  }

  var submissions = [];
  for (var i = 0; i < progressRows.length; i++) {
    var name = String(progressRows[i]['student_name'] || '').toLowerCase().trim();
    if (name === target) {
      var dayNum = String(progressRows[i]['day_number'] || '');
      submissions.push({
        day_number: dayNum,
        topic: progressRows[i]['topic'] || '',
        lesson_date: progressRows[i]['lesson_date'] || '',
        has_marks: !!gradedDays[dayNum]
      });
    }
  }

  return { found: true, submissions: submissions };
}


// ── GET: generate_lesson ───────────────────────────────
// Checks the Lesson Library first (decisions 3–6, 9); falls back to fresh
// AI generation when needed. Returns { found, lesson, source } where
// source is 'library' | 'rewrite' | 'fresh'.
function handleGenerateLesson(level, day, topic, allowSpanish, studentName) {
  if (!level || !day || !topic) {
    return { error: 'Missing required parameter (level, day, topic)' };
  }

  if (!PropertiesService.getScriptProperties().getProperty('AI_API_KEY')) {
    return { error: 'AI_API_KEY not set in Script Properties' };
  }

  // Load teacher's difficulty profile for this student (if any)
  var difficulty = null;
  if (studentName) {
    var settingsRow = findLastByStudent('Settings', HEADERS['Settings'], studentName);
    if (settingsRow && settingsRow['difficulty_json']) {
      try { difficulty = JSON.parse(String(settingsRow['difficulty_json'])); }
      catch (parseErr) { console.warn('Could not parse difficulty_json for ' + studentName + ': ' + parseErr.message); }
    }
  }

  // Decision 5: non-empty aiInstructions → skip library entirely (serve fresh, no write-back)
  var hasCustomInstructions = !!(difficulty && (difficulty.aiInstructions || '').trim().length > 0);

  // ── Library lookup (non-blocking — any failure falls through to fresh generation) ──
  if (!hasCustomInstructions) {
    try {
      var entries      = getLibraryEntries(level, day);
      var recycleChance = recycleProbability(entries.length);

      if (entries.length > 0 && Math.random() < recycleChance) {
        var match = findLibraryMatch(entries, difficulty || {});
        if (match && match.lesson) {
          try { incrementTimesServed(match.id); } catch (e) {}
          return { found: true, lesson: match.lesson, source: 'library' };
        }

        // Option C: no direct match — rewrite closest entry for this difficulty
        var closest = findClosestEntry(entries, difficulty || {});
        if (closest && closest.lesson) {
          try {
            var rewritten = rewriteLessonForDifficulty(closest.lesson, difficulty || {}, level, day);
            try { addToLibrary(level, day, rewritten, difficulty || {}, studentName); } catch (e) {}
            return { found: true, lesson: rewritten, source: 'rewrite' };
          } catch (rewriteErr) {
            console.warn('Option-C rewrite failed, generating fresh: ' + rewriteErr.message);
            // fall through to fresh generation below
          }
        }
      }
    } catch (libLookupErr) {
      console.warn('Library lookup failed (non-fatal), generating fresh: ' + libLookupErr.message);
      // fall through to fresh generation — the library never blocks a lesson
    }
  }

  // ── Fresh generation ────────────────────────────────
  var prompt = buildLessonPrompt(level, day, topic, allowSpanish, difficulty, studentName);

  try {
    // Strip markdown code fences if the model wrapped the JSON despite instructions
    var text = stripJsonFences(aiGenerate(prompt));

    var lesson;
    try { lesson = JSON.parse(text); }
    catch (parseErr) { return { error: 'Could not parse lesson JSON: ' + parseErr.message }; }

    // Decision 6: custom-instructed lessons never enter the library
    if (!hasCustomInstructions) {
      try { addToLibrary(level, day, lesson, difficulty || {}, studentName); } catch (e) {
        console.warn('Library write failed (non-fatal): ' + e.message);
      }
    }

    return { found: true, lesson: lesson, source: 'fresh' };
  } catch (err) {
    return { error: 'Lesson generation failed: ' + err.message };
  }
}

/** Build the lesson prompt sent to the AI provider. Mirrors the structure expected by student-course.html. */
function buildLessonPrompt(level, day, topic, allowSpanish, difficulty, studentName) {
  var levelInfo = {
    'A1': { name: 'Beginner',           theme: 'Everyday Survival' },
    'A2': { name: 'Elementary',         theme: 'Community & Life' },
    'B1': { name: 'Intermediate',       theme: 'The Workplace' },
    'B2': { name: 'Upper-Intermediate', theme: 'Career & Society' },
    'C1': { name: 'Advanced',           theme: 'Professional Mastery' },
    'C2': { name: 'Proficiency',        theme: 'Full Fluency' }
  };
  var info = levelInfo[level] || levelInfo['B1'];
  var minWordsMap = { A1: 20, A2: 40, B1: 80, B2: 120, C1: 180, C2: 250 };
  var minWords = minWordsMap[level] || 80;

  var prompt =
    'You are an expert English language teacher designing a lesson for an adult immigrant learner.\n\n' +
    'LEVEL: ' + level + ' (' + info.name + ') — Theme: ' + info.theme + '\n' +
    'DAY: ' + day + ' of 20\n' +
    'FOCUS: vocabulary, pronunciation, speaking (also include listening and writing tasks)\n' +
    "TODAY'S TOPIC: " + topic + '\n\n' +
    'Generate a complete 90-minute lesson plan in JSON format. Return ONLY valid JSON, no markdown, no explanation.\n\n' +
    'JSON structure:\n' +
    '{\n' +
    '  "topic": "lesson topic title",\n' +
    '  "objective": "one sentence: what the student will be able to do after this lesson",\n' +
    '  "warmup": {\n' +
    '    "title": "warm-up title",\n' +
    '    "instruction": "instruction for student",\n' +
    '    "prompt": "a simple question or task to get them thinking"\n' +
    '  },\n' +
    '  "vocabulary": {\n' +
    '    "title": "vocabulary set title",\n' +
    '    "instruction": "how to use these words",\n' +
    '    "words": [\n' +
    '      { "word": "", "pronunciation": "/phonetic/", "partOfSpeech": "", "definition": "", "exampleSentence": "" }\n' +
    '    ]\n' +
    '  },\n' +
    '  "listening": {\n' +
    '    "title": "listening title",\n' +
    '    "instruction": "instruction",\n' +
    '    "audioText": "a paragraph (3-5 sentences) to be read aloud — realistic dialogue or monologue",\n' +
    '    "questions": [\n' +
    '      { "id": "l1", "question": "", "options": ["A","B","C","D"], "correct": 0 },\n' +
    '      { "id": "l2", "question": "", "options": ["A","B","C","D"], "correct": 1 }\n' +
    '    ]\n' +
    '  },\n' +
    '  "speaking": {\n' +
    '    "title": "speaking/pronunciation title",\n' +
    '    "instruction": "instruction",\n' +
    '    "drills": [\n' +
    '      { "id": "s1", "phrase": "phrase to practice", "tip": "pronunciation tip" },\n' +
    '      { "id": "s2", "phrase": "phrase to practice", "tip": "pronunciation tip" }\n' +
    '    ],\n' +
    '    "conversationPrompt": "an open-ended speaking prompt for the student to respond to"\n' +
    '  },\n' +
    '  "practice": {\n' +
    '    "title": "practice activity title",\n' +
    '    "instruction": "instruction",\n' +
    '    "questions": [\n' +
    '      { "id": "p1", "question": "", "options": ["A","B","C","D"], "correct": 0 },\n' +
    '      { "id": "p2", "question": "", "options": ["A","B","C","D"], "correct": 2 },\n' +
    '      { "id": "p3", "question": "", "options": ["A","B","C","D"], "correct": 1 }\n' +
    '    ]\n' +
    '  },\n' +
    '  "writing": {\n' +
    '    "title": "writing title",\n' +
    '    "instruction": "instruction",\n' +
    '    "prompt": "writing prompt",\n' +
    '    "minWords": ' + minWords + '\n' +
    '  },\n' +
    '  "review": {\n' +
    '    "title": "review title",\n' +
    '    "keyTakeaways": ["takeaway 1", "takeaway 2", "takeaway 3"]\n' +
    '  }\n' +
    '}\n\n' +
    'Include 4-6 vocabulary words, 2 listening questions, 2 speaking drills, and 3 practice questions. ' +
    'Make the content REALISTIC and USEFUL for someone who works full time. Use everyday situations: work, shopping, ' +
    'health, family, neighbours, renting, public transport, etc. Level ' + level + ' appropriately. ' +
    "Each day's lesson must be NEW and DIFFERENT — do not reuse words, phrases, or scenarios from a generic template.";

  // Fold in teacher-set difficulty profile, focus areas, and free-form instructions
  var guidance = buildTeacherGuidanceBlock(difficulty, level, minWords);
  if (guidance) {
    prompt += '\n\n' + guidance;
  }

  if (allowSpanish && (level === 'A1' || level === 'A2')) {
    prompt += '\n\nIMPORTANT: This student speaks Spanish. For EVERY text field (title, instruction, prompt, ' +
      'question, conversationPrompt, tip, definition, exampleSentence, keyTakeaways), add a Spanish translation ' +
      'using an "_es" suffix key. For example:\n' +
      '  "title": "Think About Your Day",\n' +
      '  "title_es": "Piensa en Tu Día",\n' +
      '  "definition": "a meeting arranged in advance",\n' +
      '  "definition_es": "una reunión organizada con anticipación"\n' +
      'Include "_es" keys for ALL user-facing strings. Vocabulary words themselves stay in English ' +
      '(they are learning English), but definitions and example sentences need "_es" translations.';
  }

  // Inject review words for spaced repetition
  if (studentName) {
    var reviewWords = getReviewWords(studentName);
    if (reviewWords.length > 0) {
      var wordList = reviewWords.map(function(r) { return r.word; }).join(', ');
      prompt += '\n\nSPACED REPETITION: Include these review vocabulary words from previous lessons: ' +
        wordList + '. Integrate them naturally into today\'s warm-up, practice questions, or writing prompt ' +
        '— do NOT add them to the vocabulary section (they are review, not new words).';
    }
  }

  return prompt;
}

// ══════════════════════════════════════════════════════
// VOCABULARY SPACED REPETITION
// ══════════════════════════════════════════════════════

/** SRS intervals in days: review after 1, 3, 7, 14 days. */
var SRS_INTERVALS = [1, 3, 7, 14];

/**
 * Get up to 3 words due for review for a student.
 * A word is due when today >= next_review_date.
 */
function getReviewWords(studentName) {
  var sheet = getOrCreateSheet('Vocabulary Tracker', HEADERS['Vocabulary Tracker']);
  if (sheet.getLastRow() < 2) return [];

  var rows = sheetToObjects(sheet);
  var target = String(studentName).toLowerCase().trim();
  var today = new Date();
  today.setHours(0, 0, 0, 0);

  var due = rows.filter(function(r) {
    if (String(r['student_name'] || '').toLowerCase().trim() !== target) return false;
    if (!r['next_review_date']) return false;
    var nextDate = new Date(r['next_review_date']);
    return !isNaN(nextDate.getTime()) && nextDate <= today;
  });

  // Sort by oldest due first, take 3
  due.sort(function(a, b) {
    return new Date(a['next_review_date']) - new Date(b['next_review_date']);
  });
  return due.slice(0, 3);
}

/**
 * Save vocabulary words learned in a lesson to the tracker.
 * Skips words already tracked for this student.
 */
function saveVocabularyWords(studentName, words, level, dayNumber) {
  if (!studentName || !words || !words.length) return;
  var sheet = getOrCreateSheet('Vocabulary Tracker', HEADERS['Vocabulary Tracker']);
  ensureSheetHeaders(sheet, HEADERS['Vocabulary Tracker']);

  // Find existing words for this student
  var existing = new Set();
  if (sheet.getLastRow() > 1) {
    var rows = sheetToObjects(sheet);
    var target = String(studentName).toLowerCase().trim();
    rows.forEach(function(r) {
      if (String(r['student_name'] || '').toLowerCase().trim() === target) {
        existing.add(String(r['word'] || '').toLowerCase().trim());
      }
    });
  }

  var today = new Date().toISOString().split('T')[0];
  var nextReview = new Date();
  nextReview.setDate(nextReview.getDate() + SRS_INTERVALS[0]); // first review after 1 day

  words.forEach(function(w) {
    var word = String(w).trim();
    if (!word || existing.has(word.toLowerCase())) return;
    sheet.appendRow([
      studentName,
      word,
      level || '',
      today,          // day_introduced
      '',             // last_reviewed (empty until first review)
      0,              // review_count
      nextReview.toISOString().split('T')[0]  // next_review_date
    ]);
  });
}

/**
 * Mark review words as reviewed after a lesson that included them.
 * Advances each word to the next SRS interval.
 */
function markWordsReviewed(studentName, words) {
  if (!studentName || !words || !words.length) return;
  var sheet = getOrCreateSheet('Vocabulary Tracker', HEADERS['Vocabulary Tracker']);
  if (sheet.getLastRow() < 2) return;

  var headerRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(function(h) { return String(h).trim(); });
  var colIdx = {};
  HEADERS['Vocabulary Tracker'].forEach(function(c) { colIdx[c] = headerRow.indexOf(c); });

  var target = String(studentName).toLowerCase().trim();
  var wordSet = {};
  words.forEach(function(w) { wordSet[String(w).toLowerCase().trim()] = true; });
  var today = new Date().toISOString().split('T')[0];

  var dataRange = sheet.getRange(2, 1, sheet.getLastRow() - 1, headerRow.length);
  var data = dataRange.getValues();
  var changed = false;

  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    if (String(row[colIdx['student_name']] || '').toLowerCase().trim() !== target) continue;
    if (!wordSet[String(row[colIdx['word']] || '').toLowerCase().trim()]) continue;

    var count = parseInt(row[colIdx['review_count']], 10) || 0;
    count++;
    var intervalIdx = Math.min(count, SRS_INTERVALS.length) - 1;
    var next = new Date();
    next.setDate(next.getDate() + SRS_INTERVALS[intervalIdx]);

    data[i][colIdx['last_reviewed']] = today;
    data[i][colIdx['review_count']] = count;
    data[i][colIdx['next_review_date']] = next.toISOString().split('T')[0];
    changed = true;
  }

  if (changed) {
    dataRange.setValues(data);
  }
}

/** Translate the teacher's 1-5 difficulty sliders, focus tags, and free-form
 *  AI instructions into a TEACHER GUIDANCE block appended to the lesson prompt.
 *  Returns null if there's nothing to add. */
function buildTeacherGuidanceBlock(difficulty, level, defaultMinWords) {
  if (!difficulty || typeof difficulty !== 'object') return null;

  var profile = difficulty.difficultyProfile || {};
  var focusTags = difficulty.focusTags || [];
  var instructions = (difficulty.aiInstructions || '').trim();

  var hasProfile = Object.keys(profile).length > 0;
  var hasFocus = focusTags && focusTags.length > 0;
  var hasInstructions = instructions.length > 0;
  if (!hasProfile && !hasFocus && !hasInstructions) return null;

  // Map a 1-5 slider to a short qualitative descriptor
  function describe(val, axis) {
    var n = parseInt(val, 10);
    if (!n || n < 1 || n > 5) return null;
    var scale = {
      1: 'much lower than ' + level + ' standard',
      2: 'slightly lower than ' + level + ' standard',
      3: 'standard for ' + level,
      4: 'slightly higher than ' + level + ' standard',
      5: 'much higher than ' + level + ' standard'
    };
    return axis + ': ' + scale[n] + ' (level ' + n + '/5)';
  }

  var lines = [];

  if (hasProfile) {
    var labels = {
      vocabulary_density:  'Vocabulary density (number of new words)',
      sentence_complexity: 'Sentence complexity in examples',
      speaking_duration:   'Speaking task length',
      writing_length:      'Writing task minimum length',
      listening_speed:     'Listening passage pacing',
      grammar_complexity:  'Grammar structures introduced'
    };
    Object.keys(labels).forEach(function(key) {
      if (profile[key] != null) {
        var line = describe(profile[key], labels[key]);
        if (line) lines.push('- ' + line);
      }
    });

    // Concrete numeric overrides where they apply
    if (profile.vocabulary_density) {
      var vd = parseInt(profile.vocabulary_density, 10);
      var vocabCount = { 1: 3, 2: 4, 3: 5, 4: 6, 5: 8 }[vd];
      if (vocabCount) lines.push('- Use exactly ' + vocabCount + ' vocabulary words.');
    }
    if (profile.writing_length) {
      var wl = parseInt(profile.writing_length, 10);
      var ratio = { 1: 0.6, 2: 0.8, 3: 1.0, 4: 1.3, 5: 1.6 }[wl];
      if (ratio) {
        var adjusted = Math.round(defaultMinWords * ratio);
        lines.push('- Set writing.minWords to ' + adjusted + '.');
      }
    }
  }

  if (hasFocus) {
    lines.push('- Focus areas to emphasise this lesson: ' + focusTags.join(', ') + '.');
  }

  if (hasInstructions) {
    lines.push('- Additional teacher instructions: ' + instructions);
  }

  return 'TEACHER GUIDANCE (override defaults above where they conflict):\n' + lines.join('\n');
}


// ══════════════════════════════════════════════════════
// LESSON LIBRARY — helpers
// ══════════════════════════════════════════════════════

var SLIDER_KEYS = [
  'vocabulary_density', 'sentence_complexity', 'speaking_duration',
  'writing_length', 'listening_speed', 'grammar_complexity'
];

/**
 * Returns the probability (0–1) that a given library coverage count should
 * trigger a recycle attempt rather than fresh generation (decision 3).
 *   0–4  → 0   (100% fresh — seed phase)
 *   5–9  → 0.5 (50% recycle)
 *   10+  → 0.8 (80% recycle)
 */
function recycleProbability(entryCount) {
  if (entryCount < 5)  return 0;
  if (entryCount < 10) return 0.5;
  return 0.8;
}

/** Load all active entries for a (level, day) bucket.
 *  Reads only the metadata columns first (skipping the large lesson_json).
 *  The lesson JSON is loaded lazily via entry.loadLesson() when needed. */
function getLibraryEntries(level, day) {
  var sheet  = getOrCreateSheet('Lesson Library', HEADERS['Lesson Library']);
  if (sheet.getLastRow() < 2) return [];

  // Read header row to find column indices
  var headerRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(function(h) { return String(h).trim(); });
  var colIdx = {};
  ['id', 'level', 'day', 'is_active', 'original_difficulty_json', 'times_served', 'created_at', 'source_student', 'lesson_json'].forEach(function(c) {
    colIdx[c] = headerRow.indexOf(c);
  });

  // Read all data rows (including lesson_json — needed for serving)
  var dataRange = sheet.getRange(2, 1, sheet.getLastRow() - 1, headerRow.length);
  var allRows = dataRange.getValues();

  var targetLevel = String(level).trim();
  var targetDay   = parseInt(day, 10);
  var result = [];

  for (var i = 0; i < allRows.length; i++) {
    var row = allRows[i];
    if (String(row[colIdx['level']]).trim() !== targetLevel) continue;
    if (parseInt(row[colIdx['day']], 10) !== targetDay) continue;
    if (String(row[colIdx['is_active']]).trim() === 'false') continue;
    var entry = {
      id:             String(row[colIdx['id']]).trim(),
      level:          row[colIdx['level']],
      day:            row[colIdx['day']],
      created_at:     row[colIdx['created_at']],
      source_student: row[colIdx['source_student']],
      times_served:   parseInt(row[colIdx['times_served']], 10) || 0,
      difficulty:     null,
      lesson:         null
    };
    try { var dj = row[colIdx['original_difficulty_json']]; if (dj) entry.difficulty = JSON.parse(String(dj)); } catch (e) {}
    try { var lj = row[colIdx['lesson_json']];              if (lj) entry.lesson     = JSON.parse(String(lj)); } catch (e) {}
    result.push(entry);
  }
  return result;
}

/**
 * Walk strict → lenient → null (decision 4).
 * Strict:  all 6 sliders within ±1; if incoming difficulty has focusTags, ≥1 must overlap.
 * Lenient: Manhattan distance across all 6 sliders ≤ 4; focus tags ignored.
 */
function findLibraryMatch(entries, difficulty) {
  var profile  = (difficulty && difficulty.difficultyProfile) ? difficulty.difficultyProfile : {};
  var incoming = (difficulty && difficulty.focusTags)         ? difficulty.focusTags          : [];

  function sv(prof, k) { return parseInt(prof[k], 10) || 3; }

  // Strict pass
  for (var i = 0; i < entries.length; i++) {
    var ep     = (entries[i].difficulty && entries[i].difficulty.difficultyProfile) ? entries[i].difficulty.difficultyProfile : {};
    var efTags = (entries[i].difficulty && entries[i].difficulty.focusTags)         ? entries[i].difficulty.focusTags          : [];
    var strictOk = SLIDER_KEYS.every(function(k) { return Math.abs(sv(profile, k) - sv(ep, k)) <= 1; });
    var tagOk    = (incoming.length === 0) || incoming.some(function(t) { return efTags.indexOf(t) >= 0; });
    if (strictOk && tagOk) return entries[i];
  }

  // Lenient pass
  for (var j = 0; j < entries.length; j++) {
    var ep2  = (entries[j].difficulty && entries[j].difficulty.difficultyProfile) ? entries[j].difficulty.difficultyProfile : {};
    var dist = SLIDER_KEYS.reduce(function(sum, k) { return sum + Math.abs(sv(profile, k) - sv(ep2, k)); }, 0);
    if (dist <= 4) return entries[j];
  }

  return null;
}

/**
 * True if any existing entry at this (level, day) has all 6 sliders
 * identical to `difficulty` — prevents near-duplicate writes (decision 9).
 * Only used on the write path; not for serving.
 */
function nearDuplicateExists(entries, difficulty) {
  var profile = (difficulty && difficulty.difficultyProfile) ? difficulty.difficultyProfile : {};
  function sv(prof, k) { return parseInt(prof[k], 10) || 3; }
  return entries.some(function(e) {
    var ep = (e.difficulty && e.difficulty.difficultyProfile) ? e.difficulty.difficultyProfile : {};
    return SLIDER_KEYS.every(function(k) { return sv(profile, k) === sv(ep, k); });
  });
}

/** Return the entry with the smallest Manhattan distance from `difficulty` (used for option C). */
function findClosestEntry(entries, difficulty) {
  var profile = (difficulty && difficulty.difficultyProfile) ? difficulty.difficultyProfile : {};
  function sv(prof, k) { return parseInt(prof[k], 10) || 3; }
  var best = null, bestDist = Infinity;
  for (var i = 0; i < entries.length; i++) {
    var ep   = (entries[i].difficulty && entries[i].difficulty.difficultyProfile) ? entries[i].difficulty.difficultyProfile : {};
    var dist = SLIDER_KEYS.reduce(function(sum, k) { return sum + Math.abs(sv(profile, k) - sv(ep, k)); }, 0);
    if (dist < bestDist) { bestDist = dist; best = entries[i]; }
  }
  return best;
}

/**
 * Append a lesson to the library, subject to the near-duplicate dedup check (decision 9).
 * Returns true if written, false if skipped (duplicate exists).
 */
function addToLibrary(level, day, lesson, difficulty, sourceStudent) {
  var entries = getLibraryEntries(level, day);
  if (nearDuplicateExists(entries, difficulty || {})) return false;

  var id = 'lib_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
  safeAppendRow('Lesson Library', HEADERS['Lesson Library'], {
    id:                       id,
    level:                    String(level),
    day:                      String(day),
    created_at:               new Date().toISOString(),
    source_student:           sourceStudent || '',
    original_difficulty_json: JSON.stringify(difficulty || {}),
    lesson_json:              JSON.stringify(lesson),
    is_active:                'true',
    times_served:             '0'
  });
  return true;
}

/** Increment the times_served counter for a library entry by id. */
function incrementTimesServed(entryId) {
  var sheet  = getOrCreateSheet('Lesson Library', HEADERS['Lesson Library']);
  var actual = ensureSheetHeaders(sheet, HEADERS['Lesson Library']);
  var idCol  = actual.indexOf('id');
  var tsCol  = actual.indexOf('times_served');
  if (idCol < 0 || tsCol < 0 || sheet.getLastRow() < 2) return;
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, actual.length).getValues();
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][idCol]).trim() === String(entryId).trim()) {
      sheet.getRange(i + 2, tsCol + 1).setValue((parseInt(data[i][tsCol], 10) || 0) + 1);
      return;
    }
  }
}

/**
 * Option C: rewrite a source lesson for a new difficulty profile via the AI provider.
 * Cheaper than full generation — the topic, structure, and activities stay identical.
 */
function rewriteLessonForDifficulty(sourceLesson, targetDifficulty, level, day) {
  var defaultMinWords = { A1: 20, A2: 40, B1: 80, B2: 120, C1: 180, C2: 250 }[level] || 80;
  var guidance        = buildTeacherGuidanceBlock(targetDifficulty, level, defaultMinWords);

  var prompt =
    'You are an English language teacher. Adjust the following lesson plan to match a new difficulty profile.\n\n' +
    'Keep the topic, theme, and activity structure identical. Only change vocabulary level, sentence complexity, ' +
    'writing minimum word count, speaking task length, listening passage pacing, and grammar structures.\n\n' +
    'Return ONLY valid JSON in the exact same schema as the input. No markdown, no explanation.\n\n' +
    'SOURCE LESSON:\n' + JSON.stringify(sourceLesson) + '\n\n' +
    (guidance ? 'TARGET DIFFICULTY:\n' + guidance + '\n\n' : '') +
    'LEVEL: ' + level + '  DAY: ' + day;

  return JSON.parse(stripJsonFences(aiGenerate(prompt)));
}


// ── GET: get_library ──────────────────────────────────
// Returns all active library entries grouped by (level, day) with counts and
// serve statistics. lesson_json is deliberately excluded — fetch individually
// via get_library_entry when previewing.
function handleGetLibrary() {
  var sheet   = getOrCreateSheet('Lesson Library', HEADERS['Lesson Library']);
  var rows    = sheetToObjects(sheet);
  var grouped = {};
  var totalEntries  = 0;
  var totalRecycled = 0;

  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (String(r['is_active']).trim() === 'false') continue;
    var lvl = String(r['level'] || '').trim();
    var dayNum = parseInt(r['day'], 10);
    if (!lvl || isNaN(dayNum) || dayNum < 1) continue;
    var key = lvl + '_' + String(dayNum);
    if (!grouped[key]) {
      grouped[key] = { level: lvl, day: dayNum, count: 0, timesServed: 0, entries: [] };
    }
    var ts = parseInt(r['times_served'], 10) || 0;
    grouped[key].count++;
    grouped[key].timesServed += ts;
    totalEntries++;
    totalRecycled += ts;

    grouped[key].entries.push({
      id:                       String(r['id']).trim(),
      created_at:               String(r['created_at'] || ''),
      source_student:           String(r['source_student'] || ''),
      times_served:             ts,
      original_difficulty_json: String(r['original_difficulty_json'] || '')
    });
  }

  return { found: true, totalEntries: totalEntries, totalRecycled: totalRecycled, groups: Object.values(grouped) };
}

// ── GET: get_library_entry ────────────────────────────
// Returns the full row (including lesson_json) for a single entry by id.
function handleGetLibraryEntry(id) {
  if (!id) return { found: false, error: 'Missing id' };
  var sheet = getOrCreateSheet('Lesson Library', HEADERS['Lesson Library']);
  var rows  = sheetToObjects(sheet);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i]['id']).trim() === String(id).trim()) {
      return { found: true, entry: rows[i] };
    }
  }
  return { found: false };
}

// ── POST: delete_library_entry ────────────────────────
// Soft-deletes a library entry by setting is_active = 'false'.
function handleDeleteLibraryEntry(id) {
  if (!id) return { result: 'error', message: 'Missing id' };
  var sheet     = getOrCreateSheet('Lesson Library', HEADERS['Lesson Library']);
  var actual    = ensureSheetHeaders(sheet, HEADERS['Lesson Library']);
  var idCol     = actual.indexOf('id');
  var activeCol = actual.indexOf('is_active');
  if (idCol < 0 || activeCol < 0) return { result: 'error', message: 'Missing columns' };
  if (sheet.getLastRow() < 2) return { result: 'error', message: 'Not found' };
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, actual.length).getValues();
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][idCol]).trim() === String(id).trim()) {
      sheet.getRange(i + 2, activeCol + 1).setValue('false');
      return { result: 'success' };
    }
  }
  return { result: 'error', message: 'Entry not found' };
}


// ══════════════════════════════════════════════════════
// doPOST — handles all write requests
// ══════════════════════════════════════════════════════

/**
 * Safely append a row to a sheet, matching params to the sheet's
 * ACTUAL header row (not the HEADERS constant). This prevents
 * column misalignment when sheets have old/different headers.
 * Auto-extends the sheet with any missing columns from expectedHeaders.
 */
function safeAppendRow(sheetName, expectedHeaders, params) {
  var sheet = getOrCreateSheet(sheetName, expectedHeaders);
  var actualHeaders = ensureSheetHeaders(sheet, expectedHeaders);

  // Build the row by matching params to actual column headers
  var row = actualHeaders.map(function(header) {
    return params[header] || '';
  });

  sheet.appendRow(row);
}


// ── GET: get_audio ────────────────────────────────────
// Returns a Drive audio file as base64 for inline playback
function handleGetAudio(fileId) {
  if (!fileId) return { error: 'No file ID provided' };
  try {
    var file = DriveApp.getFileById(fileId);
    var blob = file.getBlob();
    return {
      found: true,
      data: Utilities.base64Encode(blob.getBytes()),
      mime: blob.getContentType() || 'audio/webm'
    };
  } catch (err) {
    return { error: 'Could not read audio file: ' + err.message };
  }
}


// ── GET: get_errors ──────────────────────────────────
// Returns the last 50 error log entries (teacher endpoint)
function handleGetErrors() {
  var sheet = getOrCreateSheet('Error Log', ['timestamp', 'action', 'student', 'message', 'params']);
  if (sheet.getLastRow() < 2) return { found: true, errors: [] };
  var rows = sheetToObjects(sheet);
  // Most recent first, limited to 50
  rows.reverse();
  return { found: true, errors: rows.slice(0, 50) };
}

// ══════════════════════════════════════════════════════
// VIDEO CALL REQUESTS
// ══════════════════════════════════════════════════════

/** Student requests a video call. Returns the request id. */
function handleRequestVideoCall(studentName, page, dayNumber) {
  var sheet = getOrCreateSheet('Video Call Requests', HEADERS['Video Call Requests']);
  var id = Utilities.getUuid();
  var row = {
    id: id,
    student_name: studentName,
    requested_at: new Date().toISOString(),
    page: page || 'hub',
    day_number: dayNumber || '',
    call_link: '',
    link_sent_at: '',
    status: 'pending'
  };
  safeAppendRow('Video Call Requests', HEADERS['Video Call Requests'], row);
  notifyTeacherCallRequest(studentName, page, dayNumber);
  return { result: 'success', id: id };
}

/** Get the active (pending or sent) call request for a student. */
function handleGetActiveCallRequest(studentName) {
  if (!studentName) return { found: false };
  var sheet = getOrCreateSheet('Video Call Requests', HEADERS['Video Call Requests']);
  if (sheet.getLastRow() < 2) return { found: false };
  var rows = sheetToObjects(sheet);
  var target = String(studentName).toLowerCase().trim();
  // Find most recent active request (pending or sent, not done/dismissed)
  for (var i = rows.length - 1; i >= 0; i--) {
    var r = rows[i];
    if (String(r['student_name'] || '').toLowerCase().trim() !== target) continue;
    var status = String(r['status'] || '').trim();
    if (status === 'pending' || status === 'sent') {
      return {
        found: true,
        id: r['id'],
        status: status,
        call_link: r['call_link'] || '',
        requested_at: r['requested_at'],
        link_sent_at: r['link_sent_at'] || ''
      };
    }
  }
  return { found: false };
}

/** Get all call requests (for teacher dashboard). */
function handleGetCallRequests() {
  var sheet = getOrCreateSheet('Video Call Requests', HEADERS['Video Call Requests']);
  if (sheet.getLastRow() < 2) return { found: true, requests: [] };
  var rows = sheetToObjects(sheet);
  // Only return non-done/dismissed, most recent first
  var active = rows.filter(function(r) {
    var s = String(r['status'] || '').trim();
    return s === 'pending' || s === 'sent';
  });
  active.reverse();
  return { found: true, requests: active };
}

/** Teacher sends a call link to a pending request. */
function handleSendCallLink(requestId, callLink) {
  if (!requestId || !callLink) throw new Error('Missing requestId or callLink');
  var sheet = getOrCreateSheet('Video Call Requests', HEADERS['Video Call Requests']);
  var headerRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(function(h) { return String(h).trim(); });
  var idCol = headerRow.indexOf('id');
  if (idCol < 0) throw new Error('id column not found');
  var finder = sheet.getRange(2, idCol + 1, sheet.getLastRow() - 1, 1)
    .createTextFinder(String(requestId).trim())
    .matchEntireCell(true);
  var match = finder.findNext();
  if (!match) throw new Error('Request not found: ' + requestId);
  var rowNum = match.getRow();
  var linkCol = headerRow.indexOf('call_link') + 1;
  var sentCol = headerRow.indexOf('link_sent_at') + 1;
  var statusCol = headerRow.indexOf('status') + 1;
  sheet.getRange(rowNum, linkCol).setValue(callLink);
  sheet.getRange(rowNum, sentCol).setValue(new Date().toISOString());
  sheet.getRange(rowNum, statusCol).setValue('sent');
  return { result: 'success' };
}

/** Update call request status (mark done / dismissed). */
function handleUpdateCallStatus(requestId, newStatus) {
  if (!requestId || !newStatus) throw new Error('Missing requestId or newStatus');
  if (['done', 'dismissed'].indexOf(newStatus) < 0) throw new Error('Invalid status');
  var sheet = getOrCreateSheet('Video Call Requests', HEADERS['Video Call Requests']);
  var headerRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(function(h) { return String(h).trim(); });
  var idCol = headerRow.indexOf('id');
  var finder = sheet.getRange(2, idCol + 1, sheet.getLastRow() - 1, 1)
    .createTextFinder(String(requestId).trim())
    .matchEntireCell(true);
  var match = finder.findNext();
  if (!match) throw new Error('Request not found: ' + requestId);
  sheet.getRange(match.getRow(), headerRow.indexOf('status') + 1).setValue(newStatus);
  return { result: 'success' };
}


// ── GET: health ──────────────────────────────────────
// Returns system health status — use with an uptime monitor
function handleHealth() {
  var checks = {};

  // Check Google Sheets access
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var students = ss.getSheetByName('Students');
    checks.sheets = students ? 'ok' : 'ok (no Students tab yet)';
    checks.sheet_name = ss.getName();
  } catch (e) {
    checks.sheets = 'error: ' + e.message;
  }

  // Check Script Properties
  var props = PropertiesService.getScriptProperties();
  checks.ai_key = props.getProperty('AI_API_KEY') ? 'set' : 'missing';
  checks.ai_provider = (props.getProperty('AI_PROVIDER') || 'gemini').toLowerCase();
  checks.app_secret = props.getProperty('APP_SECRET') ? 'set' : 'missing';

  // Metadata
  checks.timestamp = new Date().toISOString();
  checks.status = (checks.sheets === 'ok' && checks.ai_key === 'set' && checks.app_secret === 'set')
    ? 'healthy' : 'degraded';

  return checks;
}


// ── GET: get_student_report ───────────────────────────
// Compiles all data for a student into a single report object
function handleGetStudentReport(studentName) {
  if (!studentName) return { error: 'Missing student name' };
  return {
    found: true,
    student: studentName,
    generated_at: new Date().toISOString(),
    placement_test: handleGetTestResults(studentName),
    settings: handleGetSettings(studentName),
    attendance: handleGetAttendance(studentName),
    course_progress: handleGetAllSubmissions(studentName),
    marks: getMarksForStudent(studentName),
  };
}

/** Return all lesson marks rows for a student. */
function getMarksForStudent(studentName) {
  var sheet = getOrCreateSheet('Lesson Marks', HEADERS['Lesson Marks']);
  if (sheet.getLastRow() < 2) return [];
  var rows = sheetToObjects(sheet);
  var target = String(studentName).toLowerCase().trim();
  return rows.filter(function(r) {
    return String(r['student_name'] || '').toLowerCase().trim() === target;
  });
}

// ── DAILY BACKUP ─────────────────────────────────────
// Run this as a time-driven trigger (Edit → Triggers → Add → dailyBackup → Day timer).
// Copies the entire spreadsheet to a "FluentPath Backups" folder in Drive.
// Keeps only the last 7 backups.
function dailyBackup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var root = DriveApp.getRootFolder();
  var folder = getOrCreateSubfolder(root, 'FluentPath Backups');
  var dateSuffix = new Date().toISOString().split('T')[0];
  var backupName = 'FluentPath Backup ' + dateSuffix;

  // Copy the spreadsheet
  var copy = ss.copy(backupName);
  copy.moveTo(folder);

  // Prune old backups: keep only the 7 most recent
  var files = folder.getFilesByType(MimeType.GOOGLE_SHEETS);
  var all = [];
  while (files.hasNext()) {
    var f = files.next();
    all.push({ file: f, date: f.getDateCreated() });
  }
  all.sort(function(a, b) { return b.date - a.date; });
  for (var i = 7; i < all.length; i++) {
    all[i].file.setTrashed(true);
  }

  Logger.log('Backup created: ' + backupName + ' (' + all.length + ' total, kept 7)');
}

// ══════════════════════════════════════════════════════
// AUDIO STORAGE — Google Drive helpers
// ══════════════════════════════════════════════════════

/** Return (or create) a sub-folder by name inside a parent folder */
function getOrCreateSubfolder(parent, name) {
  var iter = parent.getFoldersByName(name);
  if (iter.hasNext()) return iter.next();
  return parent.createFolder(name);
}

/** Resolve the destination folder: FluentPath Audios / <student> / Lesson <day> */
function getAudioFolder(studentName, lessonDay) {
  var root = DriveApp.getRootFolder();
  var rootAudio = getOrCreateSubfolder(root, 'FluentPath Audios');
  var studentFolder = getOrCreateSubfolder(rootAudio, studentName);
  return getOrCreateSubfolder(studentFolder, 'Lesson ' + lessonDay);
}

/**
 * handle action=save_audio  (POST, JSON body)
 * Body: {
 *   student_name, day_number,
 *   recordings: { s1: {data:<base64>, ext:'webm'}, s2: {...}, conversation: {...} },
 *   scores:     { s1: 0.85, s2: 0.72, ... }
 * }
 * Returns: { result:'success', audio_json: '{"s1":"<id>", ...}' }
 */
function handleSaveAudio(body) {
  var studentName = body.student_name || 'Unknown';
  var dayNumber   = body.day_number   || '0';
  var recordings  = body.recordings   || {};
  var scores      = body.scores       || {};

  var keys = Object.keys(recordings);
  if (keys.length === 0) {
    return { result: 'error', message: 'No recordings received. The request body may not have been parsed correctly.' };
  }

  var folder;
  try {
    folder = getAudioFolder(studentName, dayNumber);
  } catch (driveErr) {
    return { result: 'error', message: 'Drive folder creation failed: ' + driveErr.message + '. Run authorizeScript() in the Apps Script editor and create a new deployment.' };
  }

  var audioJson = {};
  var errors = [];

  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    var rec = recordings[key];
    if (!rec || !rec.data) continue;

    var ext  = rec.ext || 'webm';
    var mime = ext === 'mp4' ? 'audio/mp4' : 'audio/webm';
    var filename = key + '.' + ext;

    try {
      var decoded = Utilities.base64Decode(rec.data);
      var blob    = Utilities.newBlob(decoded, mime, filename);
      var file    = folder.createFile(blob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      audioJson[key] = file.getId();
    } catch (fileErr) {
      errors.push(key + ': ' + fileErr.message);
    }
  }

  // Store accuracy scores alongside file IDs
  var scoreKeys = Object.keys(scores);
  for (var si = 0; si < scoreKeys.length; si++) {
    audioJson[scoreKeys[si] + '_score'] = scores[scoreKeys[si]];
  }

  var audioJsonStr = JSON.stringify(audioJson);

  var result = { result: 'success', audio_json: audioJsonStr };
  if (errors.length > 0) result.warnings = errors;
  return result;
}


// ══════════════════════════════════════════════════════
// doPOST — dispatch table for all write requests
// ══════════════════════════════════════════════════════

/**
 * POST handlers return either:
 *  - { _json: object } → send that object as the JSON response (for handlers that build their own result)
 *  - undefined/void    → send { result: 'success' }
 */
var POST_HANDLERS = {
  save_audio: function(params, e) {
    var audioBody;
    if (e.postData && e.postData.contents) {
      try { audioBody = JSON.parse(e.postData.contents); } catch (err) { audioBody = null; }
    }
    if (!audioBody || !audioBody.recordings) {
      throw new Error('Could not parse audio request body. postData type: ' + (e.postData ? e.postData.type : 'none'));
    }
    return { _json: handleSaveAudio(audioBody) };
  },

  // Teacher weekly-summary AI draft (gated by TEACHER_ACTIONS). Prompt arrives as
  // a JSON body { prompt }; routes through the pluggable AI provider.
  ai_summary: function(params, e) {
    var prompt;
    if (e && e.postData && e.postData.contents) {
      try { prompt = JSON.parse(e.postData.contents).prompt; } catch (parseErr) { prompt = null; }
    }
    prompt = prompt || params['prompt'];
    if (!prompt) throw new Error('Missing prompt for ai_summary');
    return { _json: { summary: aiGenerate(prompt) } };
  },

  save_progress: function(params) {
    var name = requireParam(params, 'student_name');
    var day = requireParam(params, 'day_number');
    var level = requireParam(params, 'level');
    safeAppendRow('Course Progress', HEADERS['Course Progress'], params);
    cacheInvalidateStudent(name);
    notifyTeacherLessonSubmitted(name, day);
    // Save vocabulary words if provided (extracted from lesson content by frontend)
    if (params['vocabulary_words']) {
      try {
        var words = JSON.parse(params['vocabulary_words']);
        if (Array.isArray(words)) {
          saveVocabularyWords(name, words, level, parseInt(day, 10));
          // Mark any review words as reviewed
          var reviewWords = getReviewWords(name);
          if (reviewWords.length > 0) {
            markWordsReviewed(name, reviewWords.map(function(r) { return r.word; }));
          }
        }
      } catch (e) { /* vocabulary tracking is best-effort */ }
    }
  },

  save_marks: function(params) {
    var name = requireParam(params, 'student_name');
    requireParam(params, 'day_number');
    safeAppendRow('Lesson Marks', HEADERS['Lesson Marks'], params);
    cacheInvalidateStudent(name);
  },

  save_attendance: function(params) {
    var name = requireParam(params, 'student_name');
    var attendData = {
      student_name: name,
      attendance_json: params['attendance_json'] || '{}',
      absence_notes: params['absence_notes'] || '',
      updated_at: new Date().toLocaleString()
    };
    upsertByStudent('Attendance', HEADERS['Attendance'], name, attendData);
    cacheInvalidateStudent(name);
  },

  update_settings: function(params) {
    var name = requireParam(params, 'student_name');
    // Merge with existing row so partial updates (e.g. just difficulty)
    // don't wipe unrelated fields like teacher_name or cefr_level.
    var existing = findLastByStudent('Settings', HEADERS['Settings'], name) || {};
    var data = {};
    HEADERS['Settings'].forEach(function(h) {
      data[h] = (params[h] !== undefined) ? params[h] : (existing[h] || '');
    });
    data['updated_at'] = new Date().toLocaleString();
    upsertByStudent('Settings', HEADERS['Settings'], name, data);
    cacheInvalidateStudent(name);
  },

  delete_library_entry: function(params) {
    requireParam(params, 'id');
    return { _json: handleDeleteLibraryEntry(params['id']) };
  },

  promote_student: function(params) {
    var name = requireParam(params, 'student_name');
    var newLevel = requireParam(params, 'new_level');
    // Read current settings to get course_id
    var existing = findLastByStudent('Settings', HEADERS['Settings'], name) || {};
    var currentCourse = parseInt(existing['course_id'] || '1', 10);
    var newCourse = currentCourse + 1;
    // Update settings with new level and incremented course_id
    var data = {};
    HEADERS['Settings'].forEach(function(h) { data[h] = existing[h] || ''; });
    data['student_name'] = name;
    data['cefr_level'] = newLevel;
    data['course_id'] = String(newCourse);
    data['updated_at'] = new Date().toLocaleString();
    upsertByStudent('Settings', HEADERS['Settings'], name, data);
    cacheInvalidateStudent(name);
    return { _json: { result: 'success', course_id: newCourse, level: newLevel } };
  },

  request_video_call: function(params) {
    var name = requireParam(params, 'student_name');
    var page = params['page'] || 'hub';
    var day = params['day_number'] || '';
    return { _json: handleRequestVideoCall(name, page, day) };
  },

  send_call_link: function(params) {
    var id = requireParam(params, 'id');
    var link = requireParam(params, 'call_link');
    return { _json: handleSendCallLink(id, link) };
  },

  update_call_status: function(params) {
    var id = requireParam(params, 'id');
    var status = requireParam(params, 'status');
    return { _json: handleUpdateCallStatus(id, status) };
  },

  // No action → student submitted placement test
  _submit_test: function(params) {
    var name = requireParam(params, 'candidate_name');
    safeAppendRow('Initial Test Results', HEADERS['Initial Test Results'], params);
    cacheInvalidateStudent(name);
    notifyTeacherTestSubmitted(name);
  },

  // Examiner Results (identified by sheet_name, not action)
  _examiner_results: function(params) {
    var name = requireParam(params, 'candidate_name');
    var examData = {};
    HEADERS['Examiner Results'].forEach(function(h) { examData[h] = params[h] || ''; });
    upsertByStudent('Examiner Results', HEADERS['Examiner Results'], name, examData);
    cacheInvalidateStudent(name);
    notifyStudentTestGraded(name, params['cefr_level']);
  },
};

function doPost(e) {
  var params = e.parameter;
  var action = (params['action'] || '').trim();
  var sheetName = (params['sheet_name'] || '').trim();

  // JSON-body actions pass action via query string; body is JSON
  if (!action && e.postData && e.postData.type === 'application/json') {
    try {
      var parsed = JSON.parse(e.postData.contents);
      action = (parsed.action || '').trim();
    } catch (jsonErr) { /* leave action empty */ }
  }

  // ── Auth check ──
  if (TEACHER_ACTIONS[action] || isExaminerPost(params)) {
    if (!validateTeacherToken(params)) {
      return ContentService
        .createTextOutput(JSON.stringify({ error: 'Unauthorized' }))
        .setMimeType(ContentService.MimeType.JSON);
    }
  } else if (!validateToken(params)) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: 'Unauthorized' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // ── Resolve handler ──
  var handler = POST_HANDLERS[action];
  if (!handler && sheetName === 'Examiner Results') handler = POST_HANDLERS._examiner_results;
  if (!handler && !action)                          handler = POST_HANDLERS._submit_test;

  if (!handler) {
    return ContentService
      .createTextOutput(JSON.stringify({ result: 'error', message: 'Unknown action: ' + action }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  try {
    var result = handler(params, e);
    var body = (result && result._json) ? result._json : { result: 'success' };
    return ContentService
      .createTextOutput(JSON.stringify(body))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    var student = params['student_name'] || params['candidate_name'] || '';
    logError(action || sheetName || 'submit_test', student, err.message, params);
    return ContentService
      .createTextOutput(JSON.stringify({ result: 'error', message: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}


// ══════════════════════════════════════════════════════
// AUTHORIZATION HELPER
// Run this function once manually in the Apps Script editor
// (Run → authorizeScript) whenever a new OAuth scope is added.
// It touches every service used so the consent dialog covers all of them.
// ══════════════════════════════════════════════════════
function authorizeScript() {
  // SpreadsheetApp — already authorized from initial setup
  SpreadsheetApp.getActiveSpreadsheet();

  // UrlFetchApp — needed for AI provider API calls
  try { UrlFetchApp.fetch('https://www.google.com', { muteHttpExceptions: true }); } catch (e) {}

  // DriveApp — needed for audio file storage
  try { DriveApp.getRootFolder(); } catch (e) {}

  Logger.log('Authorization complete. You can now redeploy the web app.');
}
