/**
 * Test helpers for loading FluentPath's global-style JS files into vitest.
 *
 * Since the codebase uses <script> tags (not ES modules), functions are
 * defined as globals. We load them by reading the file and evaluating it
 * in a controlled scope.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');

/**
 * Load a JS file and execute it, making its globals available.
 * Returns an object containing all functions/vars defined in the file.
 */
export function loadScript(relPath, prelude = '') {
  const code = readFileSync(resolve(ROOT, relPath), 'utf-8');
  // Create a function that runs the code and captures globals
  const fn = new Function(prelude + '\n' + code);
  fn();
}

/**
 * Load utils.js and return references to its functions.
 * Since they're declared as `function` statements, they become
 * properties of globalThis when evaluated.
 */
export function loadUtils() {
  const code = readFileSync(resolve(ROOT, 'src/scripts/utils.js'), 'utf-8');
  // Use indirect eval so declarations go to globalThis
  (0, eval)(code);
  return {
    escHtml: globalThis.escHtml,
    formatDate: globalThis.formatDate,
    formatLessonDate: globalThis.formatLessonDate,
    formatTimeSpent: globalThis.formatTimeSpent,
    formatDuration: globalThis.formatDuration,
    formatPlayTime: globalThis.formatPlayTime,
    timeAgo: globalThis.timeAgo,
  };
}

/**
 * Load apps-script.js pure functions into globalThis for testing.
 * Provides minimal mocks for Apps Script APIs that aren't needed.
 */
export function loadAppsScriptFunctions() {
  // Mock Apps Script globals that the file references at parse time
  globalThis.SpreadsheetApp = { getActiveSpreadsheet: () => ({}) };
  globalThis.PropertiesService = { getScriptProperties: () => ({ getProperty: () => null }) };
  globalThis.CacheService = { getScriptCache: () => ({ get: () => null, put: () => {}, removeAll: () => {} }) };
  globalThis.ContentService = {
    createTextOutput: (t) => ({ setMimeType: () => ({ getContent: () => t }) }),
    MimeType: { JSON: 'json' },
  };
  globalThis.UrlFetchApp = { fetch: () => ({}) };
  globalThis.DriveApp = { getRootFolder: () => ({}) };
  globalThis.Utilities = { getUuid: () => 'test-uuid', base64Encode: () => '' };
  globalThis.LockService = { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) };
  globalThis.Logger = { log: () => {} };

  const code = readFileSync(resolve(ROOT, 'apps-script.js'), 'utf-8');
  (0, eval)(code);

  return {
    recycleProbability: globalThis.recycleProbability,
    findLibraryMatch: globalThis.findLibraryMatch,
    nearDuplicateExists: globalThis.nearDuplicateExists,
    findClosestEntry: globalThis.findClosestEntry,
    requireParam: globalThis.requireParam,
    validateScore: globalThis.validateScore,
    validateDate: globalThis.validateDate,
  };
}

// ──────────────────────────────────────────────────────
// Richer loader for the auth/session code (Phase 1).
// Installs an in-memory Spreadsheet, ScriptCache, ScriptProperties, and
// deterministic Utilities (UUID counter + a stable fake digest) so the
// account/session/login code can be exercised end-to-end without real
// Apps Script services.
// ──────────────────────────────────────────────────────

/** A minimal but faithful in-memory Sheet supporting the APIs apps-script.js uses. */
function makeFakeSheet(name, headers) {
  const rows = [];
  if (headers) rows.push(headers.slice());
  const api = {
    getName: () => name,
    getLastRow: () => rows.length,
    getLastColumn: () => rows.reduce((m, r) => Math.max(m, r.length), 0),
    appendRow: (r) => { rows.push(r.slice()); },
    getDataRange: () => api.getRange(1, 1, rows.length, api.getLastColumn()),
    getRange: (row, col, numRows = 1, numCols = 1) => ({
      getValues: () => {
        const out = [];
        for (let i = 0; i < numRows; i++) {
          const src = rows[row - 1 + i] || [];
          const line = [];
          for (let j = 0; j < numCols; j++) {
            line.push(src[col - 1 + j] !== undefined ? src[col - 1 + j] : '');
          }
          out.push(line);
        }
        return out;
      },
      setValues: (vals) => {
        for (let i = 0; i < vals.length; i++) {
          const r = row - 1 + i;
          if (!rows[r]) rows[r] = [];
          for (let j = 0; j < vals[i].length; j++) rows[r][col - 1 + j] = vals[i][j];
        }
      },
      setValue: (v) => {
        if (!rows[row - 1]) rows[row - 1] = [];
        rows[row - 1][col - 1] = v;
      },
      setFontWeight: () => api.getRange(row, col, numRows, numCols),
      createTextFinder: (text) => {
        let matchCaseFlag = true;
        let entireCell = false;
        const finder = {
          matchCase: (b) => { matchCaseFlag = b; return finder; },
          matchEntireCell: (b) => { entireCell = b; return finder; },
          findAll: () => {
            const res = [];
            const target = String(text);
            for (let i = 0; i < numRows; i++) {
              const r = row - 1 + i;
              const cell = String(((rows[r] || [])[col - 1]) ?? '');
              const a = matchCaseFlag ? cell : cell.toLowerCase();
              const b = matchCaseFlag ? target : target.toLowerCase();
              const hit = entireCell ? a.trim() === b.trim() : a.indexOf(b) >= 0;
              if (hit) res.push({ getRow: () => r + 1 });
            }
            return res;
          },
        };
        return finder;
      },
    }),
  };
  return api;
}

function makeFakeSpreadsheet() {
  const sheets = {};
  return {
    getSheetByName: (n) => sheets[n] || null,
    insertSheet: (n) => { sheets[n] = makeFakeSheet(n); return sheets[n]; },
    _sheets: sheets,
  };
}

/**
 * Deterministic stand-in for Utilities.computeDigest. Hashes the WHOLE input
 * into one FNV state (so every byte matters), then expands that state to 32
 * signed bytes. Must avalanche on every char — otherwise iterating it for
 * password hashing would collapse distinct inputs to a shared fixed point.
 */
function fakeDigest(_algorithm, value) {
  const str = Array.isArray(value) ? value.join(',') : String(value);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const bytes = [];
  for (let k = 0; k < 32; k++) {
    h ^= h >>> 13;
    h = Math.imul(h, 16777619) >>> 0;
    h = (h + 0x9e3779b9) >>> 0;
    bytes.push(h & 0xff);
  }
  return bytes.map((b) => (b > 127 ? b - 256 : b));
}

/**
 * Load apps-script.js with full in-memory Apps Script service mocks.
 * `props` seeds Script Properties (e.g. { PW_PEPPER: 'x', AUTH_ENFORCED: 'true' }).
 * Returns the auth/session functions plus `_store` handles for assertions.
 */
export function loadAppsScriptAuth(props = {}) {
  const store = { ...props };
  const cache = new Map();
  const ss = makeFakeSpreadsheet();
  let uuidN = 0;

  globalThis.SpreadsheetApp = { getActiveSpreadsheet: () => ss };
  globalThis.PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (k) => (store[k] !== undefined ? store[k] : null),
      setProperty: (k, v) => { store[k] = v; },
      deleteProperty: (k) => { delete store[k]; },
    }),
  };
  globalThis.CacheService = {
    getScriptCache: () => ({
      get: (k) => (cache.has(k) ? cache.get(k) : null),
      put: (k, v) => { cache.set(k, v); },
      remove: (k) => { cache.delete(k); },
      removeAll: (keys) => { (keys || []).forEach((k) => cache.delete(k)); },
    }),
  };
  globalThis.ContentService = {
    createTextOutput: (t) => { const o = { getContent: () => t, setMimeType: () => o }; return o; },
    MimeType: { JSON: 'json' },
  };
  // Injectable HTTP: tests set `fetchHandler` to fake Stripe responses.
  let fetchHandler = () => ({ getResponseCode: () => 200, getContentText: () => '{}' });
  globalThis.UrlFetchApp = { fetch: (url, opts) => fetchHandler(url, opts) };
  globalThis.DriveApp = { getRootFolder: () => ({}) };
  globalThis.MailApp = { sendEmail: () => {} };
  globalThis.Utilities = {
    getUuid: () => `uuid-${++uuidN}`,
    base64Encode: () => '',
    computeDigest: fakeDigest,
    computeHmacSha256Signature: (value, key) => fakeDigest('HMAC', String(value) + '|' + String(key)),
    DigestAlgorithm: { SHA_256: 'SHA_256' },
    Charset: { UTF_8: 'UTF_8' },
  };
  globalThis.LockService = { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) };
  globalThis.Logger = { log: () => {} };

  const code = readFileSync(resolve(ROOT, 'apps-script.js'), 'utf-8');
  (0, eval)(code);
  // Iteration count is irrelevant to correctness; shrink it so the suite stays
  // fast (the real 100k rounds matter only for production brute-force cost).
  globalThis.PW_ROUNDS = 1000;

  return {
    hashPassword: globalThis.hashPassword,
    verifyPassword: globalThis.verifyPassword,
    safeEquals: globalThis.safeEquals,
    truthy: globalThis.truthy,
    findAccountByEmail: globalThis.findAccountByEmail,
    createSession: globalThis.createSession,
    validateSession: globalThis.validateSession,
    revokeSession: globalThis.revokeSession,
    resolveSession: globalThis.resolveSession,
    resolveEffectiveStudent: globalThis.resolveEffectiveStudent,
    authEnforced: globalThis.authEnforced,
    validateTeacherToken: globalThis.validateTeacherToken,
    isCourseUnlocked: globalThis.isCourseUnlocked,
    enforceCourseAccess: globalThis.enforceCourseAccess,
    verifyStripeSignature: globalThis.verifyStripeSignature,
    fulfillCheckout: globalThis.fulfillCheckout,
    handleStripeWebhook: globalThis.handleStripeWebhook,
    findLastByStudent: globalThis.findLastByStudent,
    bytesToHex: globalThis.bytesToHex,
    studentBaseUrl: globalThis.studentBaseUrl,
    teacherBaseUrl: globalThis.teacherBaseUrl,
    POST_HANDLERS: globalThis.POST_HANDLERS,
    GET_HANDLERS: globalThis.GET_HANDLERS,
    HEADERS: globalThis.HEADERS,
    Utilities: globalThis.Utilities,
    _store: store,
    _cache: cache,
    _ss: ss,
    _setFetch: (fn) => { fetchHandler = fn; },
  };
}
