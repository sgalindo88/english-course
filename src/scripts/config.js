/* ═══════════════════════════════════════════════════════════════
   FluentPath — Shared Configuration
   ─────────────────────────────────────────────────────────────
   Single source of truth for endpoints, CEFR levels, and
   localStorage keys. Included by every HTML page.
   ═══════════════════════════════════════════════════════════════ */

var FP = window.FP || {};

// ── Environment ─────────────────────────────────────────────
// 'production' on the live hosts, 'development' everywhere else.
// In development mode a visual DEV banner is shown.
FP.ENV = (function () {
  if (typeof location === 'undefined') return 'development';
  var prodHosts = ['sgalindo88.github.io', 'fluentpath.ca', 'www.fluentpath.ca', 'teacher.fluentpath.ca'];
  return prodHosts.indexOf(location.hostname) >= 0 ? 'production' : 'development';
})();

// ── Site role / cross-site URLs ─────────────────────────────
// The student app and the teacher dashboard live on separate origins
// (fluentpath.ca vs teacher.fluentpath.ca). A page is the teacher site when
// its hostname starts with "teacher."; this also lets each side link to the
// other and lets the teacher login gate enforce role === 'teacher'.
FP.IS_TEACHER_SITE = (typeof location !== 'undefined') && location.hostname.indexOf('teacher.') === 0;
FP.STUDENT_URL = 'https://fluentpath.ca';
FP.TEACHER_URL = 'https://teacher.fluentpath.ca';

// ── Endpoints ────────────────────────────────────────────────
// Production webhook — always set here as the default.
// For local development, override FP.WEBHOOK_URL in config.local.js
// to point to a separate "FluentPath - Dev" Apps Script deployment.
FP.WEBHOOK_URL = 'https://script.google.com/macros/s/AKfycbwsicAxs8wunL5Eg_G0wXYbE1JuN-aqWdP5Fv6Bry4jfWyWm58PfhYcH3Pat-g4P9fX/exec';
FP.FORMSPREE_ENDPOINT = 'https://formspree.io/f/mpqoorna';

// ── Auth Token ──────────────────────────────────────────────
// Production app token (matches APP_SECRET in Script Properties). This is a
// speed bump, not the real authorization — that comes from the per-user
// session issued at login. The old public TEACHER_TOKEN has been removed;
// teacher access is now proven by a teacher session.
// For local dev with a different Apps Script deployment, override in config.local.js.
FP.APP_TOKEN = '04eaecb3a0ccb2dc91c6b0da61a8d875';

// ── CEFR Levels ──────────────────────────────────────────────
FP.LEVELS = {
  A1: { name: 'Beginner',            theme: 'Everyday Survival',    colour: '#b8471e' },
  A2: { name: 'Elementary',           theme: 'Community & Life',     colour: '#c9933a' },
  B1: { name: 'Intermediate',         theme: 'The Workplace',        colour: '#2e6e45' },
  B2: { name: 'Upper-Intermediate',   theme: 'Career & Society',     colour: '#1e4d8c' },
  C1: { name: 'Advanced',             theme: 'Professional Mastery', colour: '#5b3e8a' },
  C2: { name: 'Proficiency',          theme: 'Full Fluency',         colour: '#1a1208' },
};

// ── Course Constants ─────────────────────────────────────────
FP.COURSE_DAYS = 20;
FP.TEST_TOTAL_MARKS = 80;
FP.LESSON_DURATION_MIN = 90;

// ── localStorage Keys ────────────────────────────────────────
FP.KEYS = {
  STUDENT_NAME:     'fp_student_name',
  TEST_COMPLETED:   'fp_test_completed',
  TEST_DATE:        'fp_test_date',
  TEST_SCORE:       'fp_test_score',
  CEFR_LEVEL:       'fp_cefr_level',
  LAST_LESSON_DAY:  'fp_last_lesson_day',
  LAST_LESSON_DATE: 'fp_last_lesson_date',
  HUB_CACHE:        'fp_hub_cache',
  TEACHER_STATE:    'fluentpath_teacher',
  LESSON_MARKS:     'fp_lesson_marks',
  COURSE_ID:        'fp_course_id',
  // Session (set at login, read by api.js on every webhook call)
  SESSION:          'fp_session',
  SESSION_EXP:      'fp_session_exp',
  ROLE:             'fp_role',
};

// ── Session helpers ──────────────────────────────────────────
// The login response (POST ?action=login) returns a session token, role, the
// server-resolved student_name, and an expiry. We persist the token/role/exp
// here; api.js injects the token into every webhook call, and pages use
// getSession() to decide whether to show the app or the login screen.
FP.getSession = function () {
  try {
    var token = localStorage.getItem(FP.KEYS.SESSION);
    if (!token) return null;
    var exp = localStorage.getItem(FP.KEYS.SESSION_EXP);
    if (exp && new Date(exp).getTime() < Date.now()) { FP.clearSession(); return null; }
    return token;
  } catch (e) { return null; }
};

FP.clearSession = function () {
  try {
    localStorage.removeItem(FP.KEYS.SESSION);
    localStorage.removeItem(FP.KEYS.SESSION_EXP);
    localStorage.removeItem(FP.KEYS.ROLE);
  } catch (e) { /* ignore */ }
};

/** Redirect to the appropriate login screen (teacher dashboard vs student app). */
FP.redirectToLogin = function () {
  var inSrc = location.pathname.indexOf('/src/') >= 0;
  var root = inSrc ? '../' : './';
  location.href = root + (FP.IS_TEACHER_SITE ? 'teacher.html' : 'index.html');
};

// ── Load config.local.js (optional, gitignored) ─────────
// Only loads if the file exists. In production (GitHub Pages) the file
// is absent and this silently skips it — no 404 in the console.
(function () {
  if (FP.ENV === 'production') return; // skip in production — file won't exist
  var scripts = document.getElementsByTagName('script');
  var thisScript = scripts[scripts.length - 1];
  var basePath = thisScript.src.substring(0, thisScript.src.lastIndexOf('/') + 1);
  var s = document.createElement('script');
  s.src = basePath + 'config.local.js';
  s.onerror = function () { s.remove(); };
  thisScript.parentNode.insertBefore(s, thisScript.nextSibling);
})();
