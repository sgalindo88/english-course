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

/**
 * Master rollout switch. While unset/false, the legacy auth paths
 * (APP_SECRET-only reads, TEACHER_SECRET for teacher writes) stay accepted
 * so we can never lock ourselves out mid-migration. Flip AUTH_ENFORCED=true
 * in Script Properties at cutover (Phase 6) to require real sessions.
 */
function authEnforced() {
  return String(PropertiesService.getScriptProperties().getProperty('AUTH_ENFORCED') || '')
    .toLowerCase() === 'true';
}

function validateTeacherToken(params) {
  // The app token is still required (a speed bump, not the real authz).
  if (!validateToken(params)) return false;

  // Primary path: a valid teacher session authorizes teacher actions.
  var session = resolveSession(params);
  if (session && session.role === 'teacher') return true;

  // Grace path: until AUTH_ENFORCED flips, honor the legacy TEACHER_SECRET so
  // the teacher can create the first accounts (and so we never lock out).
  if (!authEnforced()) {
    var teacherSecret = PropertiesService.getScriptProperties().getProperty('TEACHER_SECRET');
    if (!teacherSecret) return true; // first-run grace (matches pre-auth behavior)
    var token = String(params['teacher_token'] || '').trim();
    return token === teacherSecret;
  }
  return false;
}

/** Actions that require teacher-level auth */
var TEACHER_ACTIONS = {
  'save_marks': true,
  'update_settings': true,
  'save_attendance': true,
  'delete_library_entry': true,
  'ai_summary': true,
  'promote_student': true,
  'send_call_link': true,
  'create_account': true
  // Note: update_call_status is student-callable too (they can dismiss)
  // Note: request_video_call is student-callable (only needs app token)
};

/** POST actions that write Examiner Results (no explicit action field) */
function isExaminerPost(params) {
  return (params['sheet_name'] || '').trim() === 'Examiner Results';
}

// ══════════════════════════════════════════════════════
// ACCOUNTS, PASSWORDS & SESSIONS
// ──────────────────────────────────────────────────────
// Real gated login. The teacher creates each account (invite-only); login is
// by email but `student_name` stays the internal data key. Sessions are
// server-issued tokens persisted in the Sessions sheet (read-through cached).
// ══════════════════════════════════════════════════════

/** Loose truthiness for string-typed sheet cells ('true'/'1'/'yes' → true). */
function truthy(v) {
  var s = String(v == null ? '' : v).toLowerCase().trim();
  return s === 'true' || s === '1' || s === 'yes';
}

/** Constant-time string compare — avoids leaking length/content via timing. */
function safeEquals(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Hex-encode a digest byte array (Apps Script bytes are signed -128..127). */
function bytesToHex(bytes) {
  var hex = '';
  for (var i = 0; i < bytes.length; i++) {
    var b = (bytes[i] + 256) % 256;
    hex += ('0' + b.toString(16)).slice(-2);
  }
  return hex;
}

// Iterated SHA-256 password hashing. No bcrypt on Apps Script, so we lean on
// (a) a server-only pepper (PW_PEPPER Script Property) — a leaked sheet alone
// can't be brute-forced offline — and (b) iteration. Apps Script's
// Utilities.computeDigest has heavy per-call overhead: benchmarked on the live
// runtime, 100k rounds = ~64s (blows the 30s request timeout), 10k = ~7s,
// 2k = ~2.7s, 1k = ~1.9s (a ~1.5s fixed floor). 2000 keeps login to ~3-4s
// while staying well under the 6-min limit. Iteration is the secondary defense
// here (the pepper is primary); proportionate for ~10 invite-only users, NOT
// for public signup. See the README security caveats.
var PW_ROUNDS = 2000;

function pwPepper() {
  return PropertiesService.getScriptProperties().getProperty('PW_PEPPER') || '';
}

function hashPassword(plain, salt) {
  var data = String(salt) + pwPepper() + String(plain);
  var digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, data, Utilities.Charset.UTF_8);
  for (var i = 1; i < PW_ROUNDS; i++) {
    digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, digest);
  }
  return bytesToHex(digest);
}

function verifyPassword(plain, salt, expectedHash) {
  return safeEquals(hashPassword(plain, salt), expectedHash);
}

// ── Account lookup ────────────────────────────────────
/** Find the most recent account row for an email (case-insensitive), or null.
 *  Scans values directly (NOT createTextFinder) — TextFinder's search index
 *  lags writes, so a just-created account isn't findable for a minute or two. */
function findAccountByEmail(email) {
  var headers = HEADERS['Accounts'];
  var sheet = getOrCreateSheet('Accounts', headers);
  if (sheet.getLastRow() < 2) return null;
  var target = String(email).toLowerCase().trim();
  var emailCol = headers.indexOf('email');
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
  for (var i = data.length - 1; i >= 0; i--) { // last match wins (most recent)
    if (String(data[i][emailCol]).toLowerCase().trim() !== target) continue;
    var obj = { _row: i + 2 };
    for (var j = 0; j < headers.length; j++) obj[headers[j]] = data[i][j];
    return obj;
  }
  return null;
}

// ── Session lifecycle ─────────────────────────────────
/** Issue a session for an account. Students ~30d, teachers ~12h. */
function createSession(account) {
  var role = String(account.role || 'student').toLowerCase();
  var token = Utilities.getUuid() + Utilities.getUuid();
  var ttlMs = role === 'teacher' ? 12 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000;
  var now = new Date();
  var expires = new Date(now.getTime() + ttlMs);
  var session = {
    token: token,
    email: account.email,
    role: role,
    student_name: account.student_name,
    issued_at: now.toISOString(),
    expires_at: expires.toISOString(),
    revoked: ''
  };
  var headers = HEADERS['Sessions'];
  var sheet = getOrCreateSheet('Sessions', headers);
  sheet.appendRow(headers.map(function(h) { return session[h]; }));
  cachePut('session_' + token, session);
  return session;
}

/** Resolve a session token → session object, or null if missing/expired/revoked. */
function validateSession(token) {
  token = String(token || '').trim();
  if (!token) return null;

  var cacheKey = 'session_' + token;
  var session = cacheGet(cacheKey);
  var fromCache = !!session;

  if (!session) {
    var headers = HEADERS['Sessions'];
    var sheet = getOrCreateSheet('Sessions', headers);
    if (sheet.getLastRow() < 2) return null;
    var matches = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1)
      .createTextFinder(token).matchEntireCell(true).findAll();
    if (!matches.length) return null;
    var rowNum = matches[matches.length - 1].getRow();
    var rowData = sheet.getRange(rowNum, 1, 1, headers.length).getValues()[0];
    session = {};
    for (var j = 0; j < headers.length; j++) session[headers[j]] = rowData[j];
  }

  if (truthy(session.revoked)) return null;
  var exp = new Date(session.expires_at).getTime();
  if (!exp || exp < new Date().getTime()) return null;

  if (!fromCache) cachePut(cacheKey, session);
  return session;
}

/** Revoke a session (logout). Flips the sheet flag and drops the cache entry. */
function revokeSession(token) {
  token = String(token || '').trim();
  if (!token) return;
  var headers = HEADERS['Sessions'];
  var sheet = getOrCreateSheet('Sessions', headers);
  if (sheet.getLastRow() >= 2) {
    var matches = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1)
      .createTextFinder(token).matchEntireCell(true).findAll();
    if (matches.length) {
      var revokedCol = headers.indexOf('revoked') + 1;
      sheet.getRange(matches[matches.length - 1].getRow(), revokedCol).setValue('true');
    }
  }
  try { CacheService.getScriptCache().remove(cacheKeyForSession(token)); } catch (e) {}
}

function cacheKeyForSession(token) { return 'session_' + token; }

// ── Password reset tokens (STATELESS / signed) ────────
// Neither a Sheet nor CacheService is reliably consistent across requests in
// Apps Script (a token written by request_reset isn't found by reset_password
// moments later). So reset tokens carry their own data and are verified by an
// HMAC signature — nothing to look up, so no read-after-write lag is possible.
// Format: base64url("email|exp|pwFingerprint") + "." + hex(HMAC-SHA256(payload, pepper)).
// The pwFingerprint (first 12 chars of the account's current pw_hash) binds the
// token to the password at issue time: using it changes pw_hash, which makes
// the token (and any other outstanding ones) no longer match → implicitly single-use.
var RESET_TTL_MS = 24 * 60 * 60 * 1000; // reset link valid 24 hours

function resetSign(payloadB64) {
  return bytesToHex(Utilities.computeHmacSha256Signature(payloadB64, pwPepper()));
}

/** Create a signed reset token for an account; returns the RAW token (to email). */
function createResetToken(account) {
  var payload = [
    String(account.email).toLowerCase().trim(),
    new Date().getTime() + RESET_TTL_MS,
    String(account.pw_hash || '').substring(0, 12)
  ].join('|');
  var b64 = Utilities.base64EncodeWebSafe(payload);
  return b64 + '.' + resetSign(b64);
}

/** Verify a signed reset token → { email, _pwfp } if signature + expiry are valid, else null. */
function consumeResetToken(token) {
  token = String(token || '').trim();
  var dot = token.lastIndexOf('.');
  if (dot < 1) return null;
  var b64 = token.slice(0, dot);
  var sig = token.slice(dot + 1);
  if (!safeEquals(sig, resetSign(b64))) return null; // tampered / wrong secret
  var payload;
  try { payload = Utilities.newBlob(Utilities.base64DecodeWebSafe(b64)).getDataAsString(); } catch (e) { return null; }
  var parts = payload.split('|');
  if (parts.length < 3) return null;
  var exp = parseInt(parts[1], 10);
  if (!exp || exp < new Date().getTime()) return null;
  return { email: String(parts[0]).toLowerCase().trim(), _pwfp: parts[2] };
}

/** Set a new password (fresh salt + hash) on an existing account row. */
function setAccountPassword(account, newPassword) {
  var headers = HEADERS['Accounts'];
  var sheet = getOrCreateSheet('Accounts', headers);
  var salt = Utilities.getUuid();
  sheet.getRange(account._row, headers.indexOf('pw_salt') + 1).setValue(salt);
  sheet.getRange(account._row, headers.indexOf('pw_hash') + 1).setValue(hashPassword(newPassword, salt));
}

/** Revoke every active session for an email (used after a password reset). */
function revokeSessionsForEmail(email) {
  email = String(email).toLowerCase().trim();
  var headers = HEADERS['Sessions'];
  var sheet = getOrCreateSheet('Sessions', headers);
  if (sheet.getLastRow() < 2) return;
  var emailCol = headers.indexOf('email');
  var tokenCol = headers.indexOf('token');
  var revokedCol = headers.indexOf('revoked');
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][emailCol]).toLowerCase().trim() === email && !truthy(data[i][revokedCol])) {
      sheet.getRange(i + 2, revokedCol + 1).setValue('true');
      try { CacheService.getScriptCache().remove(cacheKeyForSession(String(data[i][tokenCol]))); } catch (e) {}
    }
  }
}

/** Resolve the caller's session from request params (token in `session`). */
function resolveSession(params) {
  return validateSession(String((params && params['session']) || '').trim());
}

/**
 * Server-derived effective student. A STUDENT session may only ever act as
 * itself — closing the `?student=NAME` impersonation hole. A teacher session
 * (or, during the AUTH_ENFORCED grace window, no session) may target any
 * student. Pure + unit-testable.
 */
function resolveEffectiveStudent(session, requestedStudent) {
  if (session && session.role === 'student') return session.student_name;
  return requestedStudent;
}

// ── Course gating (Phase 2) ───────────────────────────
/**
 * Server-authoritative unlock check. Pure + string-tolerant so it survives
 * sheet cells that come back as booleans, 'true'/'TRUE', '1', etc.
 * Unlocked when the student has paid OR the teacher granted free access.
 */
function isCourseUnlocked(settingsRow) {
  if (!settingsRow) return false;
  return truthy(settingsRow['paid']) || truthy(settingsRow['access_granted']);
}

/**
 * Guard the gated (paid) course path. Only real STUDENT sessions are gated —
 * teachers (acting on behalf) and the AUTH_ENFORCED grace window pass through,
 * preserving current behavior until cutover. Throws on a locked student.
 */
function enforceCourseAccess(session, studentName) {
  if (!session || session.role !== 'student') return;
  var settingsRow = findLastByStudent('Settings', HEADERS['Settings'], studentName);
  if (!isCourseUnlocked(settingsRow)) throw new Error('Course locked');
}

// ── Site URLs (Script Properties; default to the current live origin so
//    emails keep working until STUDENT_URL/TEACHER_URL are set at cutover) ──
function studentBaseUrl() {
  return PropertiesService.getScriptProperties().getProperty('STUDENT_URL')
    || 'https://sgalindo88.github.io/fluentpath';
}
function teacherBaseUrl() {
  return PropertiesService.getScriptProperties().getProperty('TEACHER_URL')
    || 'https://sgalindo88.github.io/fluentpath';
}

// ── Stripe (Phase 3) ──────────────────────────────────
// One-time payment unlocks the course permanently. The amount lives in Stripe
// as a Price (STRIPE_PRICE_ID) — no number in the code. Apps Script doPost
// can't read the Stripe-Signature header, so the trust anchor for unlocking is
// a server-to-Stripe RE-FETCH of the session (verifyStripeSignature is only
// defense-in-depth / unit coverage, applied when a signature is forwarded).

/**
 * Verify a Stripe webhook signature header (`t=...,v1=...`) against the raw
 * payload using STRIPE_WEBHOOK_SECRET. HMAC-SHA256 over `${t}.${payload}`.
 * Defense-in-depth only — the re-fetch in fulfillCheckout is authoritative.
 */
function verifyStripeSignature(payload, sigHeader) {
  var secret = PropertiesService.getScriptProperties().getProperty('STRIPE_WEBHOOK_SECRET');
  if (!secret) return false;
  var t = '', v1 = '';
  String(sigHeader || '').split(',').forEach(function(part) {
    var idx = part.indexOf('=');
    if (idx < 0) return;
    var k = part.slice(0, idx).trim();
    var v = part.slice(idx + 1).trim();
    if (k === 't') t = v;
    else if (k === 'v1') v1 = v;
  });
  if (!t || !v1) return false;
  var bytes = Utilities.computeHmacSha256Signature(t + '.' + String(payload), secret);
  return safeEquals(bytesToHex(bytes), v1);
}

/**
 * Re-fetch a Checkout Session from Stripe with the secret key and, only if it
 * reports payment_status === 'paid', mark the student's course paid. Idempotent:
 * upsert overwrites in place and paid_at is preserved once set, so Stripe's
 * webhook retries (and any double-delivery) are safe no-ops.
 */
function fulfillCheckout(sessionId) {
  var secret = PropertiesService.getScriptProperties().getProperty('STRIPE_SECRET');
  if (!secret || !sessionId) return false;
  var resp = UrlFetchApp.fetch(
    'https://api.stripe.com/v1/checkout/sessions/' + encodeURIComponent(sessionId),
    { method: 'get', headers: { 'Authorization': 'Bearer ' + secret }, muteHttpExceptions: true });
  if (resp.getResponseCode() >= 400) return false;
  var session = JSON.parse(resp.getContentText());
  if (!session || session.payment_status !== 'paid') return false;

  var studentName = session.client_reference_id;
  if (!studentName) return false;

  var existing = findLastByStudent('Settings', HEADERS['Settings'], studentName) || {};
  var data = {};
  HEADERS['Settings'].forEach(function(h) { data[h] = existing[h] || ''; });
  data['student_name'] = studentName;
  data['paid'] = 'true';
  data['paid_at'] = data['paid_at'] || new Date().toISOString(); // preserve first payment time
  data['stripe_customer_id'] = session.customer || data['stripe_customer_id'] || '';
  data['updated_at'] = new Date().toLocaleString();
  upsertByStudent('Settings', HEADERS['Settings'], studentName, data);
  cacheInvalidateStudent(studentName);
  return true;
}

/**
 * Webhook receiver. Reached via ?stripe=1 (no app token). Always returns a
 * plain 200 so Stripe doesn't retry forever; unlock is gated by the re-fetch.
 */
function handleStripeWebhook(e) {
  try {
    var raw = (e && e.postData && e.postData.contents) || '';
    var event = JSON.parse(raw);
    // If a signature was forwarded (e.g. via a proxy), honor it; absence is
    // expected on bare Apps Script and is not by itself a rejection.
    var sig = (e && e.parameter && e.parameter['sig']) || '';
    if (sig && !verifyStripeSignature(raw, sig)) {
      return ContentService.createTextOutput('ignored');
    }
    if (event && event.type === 'checkout.session.completed') {
      var obj = event.data && event.data.object;
      if (obj && obj.id) fulfillCheckout(obj.id);
    }
  } catch (err) {
    logError('stripe_webhook', '', err.message, {});
  }
  return ContentService.createTextOutput('ok');
}

/** Per-email login throttle (10 attempts / 15 min). login is internet-reachable. */
function loginRateLimited(email) {
  try {
    var cache = CacheService.getScriptCache();
    var key = 'login_rl_' + String(email).toLowerCase().trim();
    var count = parseInt(cache.get(key) || '0', 10);
    if (count >= 10) return true;
    cache.put(key, String(count + 1), 15 * 60);
    return false;
  } catch (e) { return false; }
}

/** Per-email reset-request throttle (3 reset emails / hour). */
function resetRateLimited(email) {
  try {
    var cache = CacheService.getScriptCache();
    var key = 'reset_rl_' + String(email).toLowerCase().trim();
    var count = parseInt(cache.get(key) || '0', 10);
    if (count >= 3) return true;
    cache.put(key, String(count + 1), 60 * 60);
    return false;
  } catch (e) { return false; }
}

/** Email a password-reset link (to the correct site for the account's role). */
function sendPasswordResetEmail(email, role, token) {
  var base = (String(role).toLowerCase() === 'teacher') ? teacherBaseUrl() : studentBaseUrl();
  var link = base + '/?reset=' + encodeURIComponent(token);
  sendNotificationEmail(
    email,
    'FluentPath: Reset your password',
    '<p>We received a request to reset your FluentPath password.</p>' +
    '<p><a href="' + link + '">Click here to set a new password</a> — this link expires in 24 hours.</p>' +
    '<p>If you did not request this, you can ignore this email; your password is unchanged.</p>'
  );
}

/** Parse a JSON POST body, or null. Handlers may receive creds via body. */
function jsonBody(e) {
  if (e && e.postData && e.postData.contents) {
    try { return JSON.parse(e.postData.contents); } catch (err) { return null; }
  }
  return null;
}

/** Read a param from query params first, then JSON body. */
function paramOrBody(params, body, key) {
  if (params && params[key] !== undefined && params[key] !== '') return params[key];
  return body && body[key] !== undefined ? body[key] : '';
}

/** POST actions reachable without an existing session (login bootstraps one). */
var SESSIONLESS_POST = { 'login': true, 'logout': true, 'request_reset': true, 'reset_password': true };

/** GET actions that require a TEACHER session once AUTH_ENFORCED is on. */
var TEACHER_GET_ACTIONS = {
  'get_students': true, 'get_library': true, 'get_call_requests': true,
  'get_class_overview': true, 'get_errors': true, 'get_student_report': true
};

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
    '<p><a href="' + teacherBaseUrl() + '/teacher.html">Open Dashboard</a></p>'
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
    '<p><a href="' + teacherBaseUrl() + '/teacher.html">Open Dashboard</a></p>'
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
    '<p><a href="' + teacherBaseUrl() + '/src/examiner-panel.html?student=' +
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
    '<p><a href="' + studentBaseUrl() + '/">View your progress</a></p>'
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
    'course_id',
    // Course gating (Phase 2). ensureSheetHeaders appends these to existing
    // sheets non-destructively, so current students survive the migration.
    'paid', 'access_granted', 'stripe_customer_id', 'paid_at'
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
  ],
  // Auth: one row per login identity. email is the login lookup; student_name
  // stays the internal data key everywhere else. role ∈ student|teacher.
  'Accounts': [
    'email', 'student_name', 'role', 'pw_salt', 'pw_hash',
    'created_at', 'created_by', 'active'
  ],
  // Auth: server-issued session tokens (read-through cached as session_<token>).
  'Sessions': [
    'token', 'email', 'role', 'student_name',
    'issued_at', 'expires_at', 'revoked'
  ]
  // (Password-reset tokens are stored in CacheService, not a sheet — see
  //  createResetToken — because Sheets aren't read-after-write consistent across requests.)
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
  generate_lesson:       function(p, session) { enforceCourseAccess(session, p.student); return handleGenerateLesson(p.level, parseInt(p.day, 10), p.topic, String(p.spanish || '').toLowerCase() === 'true', p.student); },
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

  // ── Session: derive identity server-side ──
  // A student session may only read its own data; a teacher session may target
  // any ?student=. While AUTH_ENFORCED is off, a missing session is tolerated
  // (legacy behavior) and the requested student is honored unchanged.
  var session = (action === 'health') ? null : resolveSession(e.parameter);
  if (action !== 'health') {
    if (authEnforced()) {
      if (!session ||
          (TEACHER_GET_ACTIONS[action] && session.role !== 'teacher')) {
        return ContentService
          .createTextOutput(JSON.stringify({ error: 'Unauthorized' }))
          .setMimeType(ContentService.MimeType.JSON);
      }
    }
    e.parameter.student = resolveEffectiveStudent(session, student);
  }

  var result;
  try {
    var handler = GET_HANDLERS[action];
    result = handler ? handler(e.parameter, session) : { error: 'Unknown action: ' + action };
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

  // Fetch Settings once: used for the active course_id and the unlock flag.
  var settingsRow = findLastByStudent('Settings', HEADERS['Settings'], studentName);
  if (!courseId) {
    courseId = (settingsRow && settingsRow['course_id']) ? String(settingsRow['course_id']).trim() : '1';
  }
  courseId = String(courseId).trim() || '1';

  // course_unlocked is computed fresh on every call (not read from the cached
  // blob) so a just-granted or just-paid student isn't gated by the 5-min cache.
  var courseUnlocked = isCourseUnlocked(settingsRow);

  var cacheKey = 'progress_' + String(studentName).toLowerCase().trim() + '_c' + courseId;
  var cached = cacheGet(cacheKey);
  if (cached) {
    cached.course_unlocked = courseUnlocked;
    return cached;
  }

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
  result.course_unlocked = courseUnlocked;
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
  // ── Auth: self-service password reset (email-link flow) ──
  // Both are sessionless (app-token only). request_reset ALWAYS returns a
  // generic success so it can't be used to probe which emails have accounts.
  request_reset: function(params, e) {
    var body = jsonBody(e);
    var email = String(paramOrBody(params, body, 'email')).trim().toLowerCase();
    if (email && !resetRateLimited(email)) {
      var account = findAccountByEmail(email);
      if (account && truthy(account.active)) {
        sendPasswordResetEmail(email, account.role, createResetToken(account));
      }
    }
    return { _json: { ok: true } };
  },

  reset_password: function(params, e) {
    var body = jsonBody(e);
    // NB: the reset token is 'reset_token', NOT 'token' — api.js overwrites a
    // 'token' field with the app token, which would clobber the reset token.
    var token = String(paramOrBody(params, body, 'reset_token')).trim();
    var newPassword = String(paramOrBody(params, body, 'password'));
    if (!token || !newPassword) return { _json: { ok: false, error: 'Invalid reset link.' } };
    if (newPassword.length < 6) return { _json: { ok: false, error: 'Password must be at least 6 characters.' } };
    var reset = consumeResetToken(token);
    if (!reset) return { _json: { ok: false, error: 'This reset link is invalid or has expired.' } };
    var account = findAccountByEmail(reset.email);
    if (!account) return { _json: { ok: false, error: 'Account not found.' } };
    // Single-use: the token is bound to the password at issue time. If it no
    // longer matches, the password was already changed (this link was used).
    if (String(account.pw_hash || '').substring(0, 12) !== reset._pwfp) {
      return { _json: { ok: false, error: 'This reset link has already been used.' } };
    }
    setAccountPassword(account, newPassword); // changes pw_hash → invalidates this token
    revokeSessionsForEmail(reset.email);      // force re-login everywhere with the new password
    return { _json: { ok: true } };
  },

  // ── Auth: login / logout / create_account ──
  // login needs only the app token (no session yet). Generic failure message;
  // per-email rate limited since this endpoint is internet-reachable.
  login: function(params, e) {
    var body = jsonBody(e);
    var email = String(paramOrBody(params, body, 'email')).trim().toLowerCase();
    var password = String(paramOrBody(params, body, 'password'));
    if (!email || !password) return { _json: { ok: false, error: 'Invalid email or password' } };
    if (loginRateLimited(email)) return { _json: { ok: false, error: 'Too many attempts. Please try again later.' } };
    var account = findAccountByEmail(email);
    var ok = account && truthy(account.active) &&
             verifyPassword(password, account.pw_salt, account.pw_hash);
    if (!ok) return { _json: { ok: false, error: 'Invalid email or password' } };
    var session = createSession(account);
    return { _json: {
      ok: true,
      session: session.token,
      role: session.role,
      student_name: session.student_name,
      expires_at: session.expires_at
    } };
  },

  logout: function(params, e) {
    var body = jsonBody(e);
    revokeSession(String(paramOrBody(params, body, 'session')).trim());
    return { _json: { ok: true } };
  },

  // Student-only: open a Stripe Checkout Session and return its hosted URL for
  // the frontend to redirect to. Identity comes from the session (never the
  // request body), so a student can only ever pay for their own account.
  create_checkout: function(params, e, session) {
    if (!session || session.role !== 'student') throw new Error('Login required');
    var props = PropertiesService.getScriptProperties();
    var secret = props.getProperty('STRIPE_SECRET');
    var priceId = props.getProperty('STRIPE_PRICE_ID');
    if (!secret || !priceId) throw new Error('Payments are not configured');

    var base = studentBaseUrl();
    // Object payload → UrlFetchApp sends application/x-www-form-urlencoded and
    // URL-encodes every key/value (handles names/emails with spaces or accents).
    var payload = {
      'mode': 'payment',
      'line_items[0][price]': priceId,
      'line_items[0][quantity]': '1',
      'client_reference_id': session.student_name,
      'customer_email': session.email,
      'success_url': base + '/?paid=1',
      'cancel_url': base + '/?paid=0'
    };
    var resp = UrlFetchApp.fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'post',
      headers: { 'Authorization': 'Bearer ' + secret },
      payload: payload,
      muteHttpExceptions: true
    });
    var body = JSON.parse(resp.getContentText());
    if (resp.getResponseCode() >= 400) {
      throw new Error('Stripe error: ' + ((body && body.error && body.error.message) || 'request failed'));
    }
    return { _json: { url: body.url } };
  },

  // Teacher-only (gated via TEACHER_ACTIONS). Creates an invite-only account
  // keyed by the student's existing student_name so their data associates
  // immediately, and ensures a Settings row exists for downstream upserts.
  create_account: function(params, e) {
    var body = jsonBody(e);
    var email = String(paramOrBody(params, body, 'email')).trim().toLowerCase();
    var studentName = String(paramOrBody(params, body, 'student_name')).trim();
    var password = String(paramOrBody(params, body, 'password'));
    var role = String(paramOrBody(params, body, 'role') || 'student').trim().toLowerCase();
    if (!email || !studentName || !password) {
      throw new Error('email, student_name and password are required');
    }
    if (role !== 'student' && role !== 'teacher') throw new Error('Invalid role: ' + role);
    if (findAccountByEmail(email)) throw new Error('An account with that email already exists');

    var actor = resolveSession(params);
    var salt = Utilities.getUuid();
    var headers = HEADERS['Accounts'];
    var account = {
      email: email, student_name: studentName, role: role,
      pw_salt: salt, pw_hash: hashPassword(password, salt),
      created_at: new Date().toISOString(),
      created_by: (actor && actor.email) || '',
      active: 'true'
    };
    getOrCreateSheet('Accounts', headers).appendRow(headers.map(function(h) { return account[h]; }));

    if (role === 'student' && !findLastByStudent('Settings', HEADERS['Settings'], studentName)) {
      upsertByStudent('Settings', HEADERS['Settings'], studentName, {
        student_name: studentName, student_email: email,
        course_id: '1', updated_at: new Date().toLocaleString()
      });
    }
    return { _json: { ok: true, email: email, student_name: studentName, role: role } };
  },

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

  save_progress: function(params, e, session) {
    var name = requireParam(params, 'student_name');
    var day = requireParam(params, 'day_number');
    var level = requireParam(params, 'level');
    enforceCourseAccess(session, name); // gated course path — locked students rejected
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

  // ── Stripe webhook ──
  // Reached via ?stripe=1. Handled before any token check (Stripe can't send
  // our app token); unlock is gated by the server-to-Stripe re-fetch inside.
  if (String(params['stripe'] || '') === '1') {
    return handleStripeWebhook(e);
  }

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

  // ── Session: enforce + derive identity ──
  // Once AUTH_ENFORCED is on, every student write needs a valid session
  // (login/logout bootstrap one and are exempt; teacher actions already
  // verified above). A student session is then forced onto student_name/
  // candidate_name so a student can never write as someone else.
  var session = resolveSession(params);
  var isTeacherAction = TEACHER_ACTIONS[action] || isExaminerPost(params);
  if (authEnforced() && !isTeacherAction && !SESSIONLESS_POST[action] && !session) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: 'Unauthorized' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  if (session && session.role === 'student') {
    if (params['student_name'] !== undefined) params['student_name'] = session.student_name;
    if (params['candidate_name'] !== undefined) params['candidate_name'] = session.student_name;
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
    var result = handler(params, e, session);
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

