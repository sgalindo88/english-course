# FluentPath — Gated Login, Teacher/Student Domain Split, and Stripe Course Payments

**Status:** Planned, not yet implemented. Scoped 2026-06-04.
**Decided architecture:** Keep GitHub Pages (two repos) + extend Apps Script/Sheets + Stripe Checkout. Infra cost ≈ **$0 + Stripe per-transaction fees**; preserves the teacher's Google Sheets manual-inspection workflow.

---

## ⚠️ Temporary "coming soon" landing page is live (do this first)

As of 2026-06-04 the live site at `/` serves a temporary **coming-soon landing page** while the app is revamped. The real app was moved aside, **not deleted**:

- `index.html` → the standalone coming-soon page (self-contained: inline CSS, no app dependencies).
- `app.html` → the real student app (the former `index.html`, git-tracked rename so history follows it). Reachable directly at `/app.html`.
- `sw.js` `CACHE_VERSION` was bumped `fp-v7` → `fp-v8` so returning visitors get the new page instead of a stale cached app shell.

**When the revamp is ready, revert the landing page before (or as part of) implementing this plan:**

1. Restore the app as the entry point: `git mv app.html index.html` (overwrites the temporary landing page; if you want to keep the landing page around, `git rm app.html` only after copying it elsewhere).
2. Bump `sw.js` `CACHE_VERSION` again (e.g. `fp-v8` → `fp-v9`) so the coming-soon page is evicted from caches. **Note:** Phase 5 / Phase 6 below also bump `CACHE_VERSION` at cutover — if you do the revert and the auth cutover together, a single bump covers both; otherwise bump once now and again at cutover.
3. If this plan's two-repo split (Phase 5) is being done at the same time, the revert folds into that work — `index.html` lands in the student repo as the real app entry, and the coming-soon page can simply be dropped.
4. Confirm internal links/SW `APP_SHELL` (`sw.js:14`) point at `index.html` as the app, not the landing page, and that `teacher.html` is unaffected (it was untouched by the landing-page swap).

> Commit reference for the landing-page swap: "Add temporary coming-soon landing page; move app to app.html".

---

## How to implement this later (copy-paste prompt)

> Implement the plan in `docs/auth-payments.md`. This adds (1) real teacher-created per-student login with server-issued sessions, (2) a student-site / teacher-subdomain split across two GitHub Pages repos, and (3) Stripe one-time payment gating the daily course (placement test stays free; teacher can grant free access).
>
> Work backend-first and keep everything behind the `AUTH_ENFORCED` first-run grace flag so we never lock ourselves out. Implement in this order: Phase 1 (accounts/sessions/hashing in `apps-script.js`) → Phase 2 (server-authoritative course gating) → Phase 3 (Stripe checkout + webhook re-fetch) → Phase 4 (frontend login + `config.js`/`api.js`) → Phase 5 (two-repo split + `shared/` sync) → Phase 7 tests. Do NOT do the Phase 6 cutover steps or any DNS/Stripe-dashboard/Script-Property setup yourself — produce a checklist for me to do those manually.
>
> Follow the existing code style (vanilla JS, the `FP.*` namespace, the `GET_HANDLERS`/`POST_HANDLERS` dispatch pattern, `getOrCreateSheet`/`upsertByStudent`/`cacheGet` helpers). Add vitest unit tests mirroring `tests/apps-script.test.js`. Run `npm run lint` and `npm test` before finishing. Reuse — do not reinvent — existing helpers. Ask me before any `git` commit/push.
>
> Domains: student site = `fluentpath.ca`, teacher site = `teacher.fluentpath.ca`. Login identifier = email; internal data key stays `student_name`. Pricing = one-time, full permanent access (amount lives in Stripe as `STRIPE_PRICE_ID`).

---

## Context / problem

FluentPath (static HTML/CSS/vanilla JS on GitHub Pages, backed by Google Apps Script + Google Sheets) currently has **no real authentication**:

- `FP.APP_TOKEN` and `FP.TEACHER_TOKEN` are hardcoded in `src/scripts/config.js:26-27` and shipped publicly to every browser — the "teacher secret" is not secret.
- Students "log in" by typing a name (`enterHub()`, `hub.js:29`); the backend trusts whatever `?student=NAME` is passed and never verifies the caller owns that identity.
- The teacher dashboard is protected only by being unlinked.

**Goal:** real gated login, a teacher subdomain separate from the student site, and Stripe payment to unlock the course.

### Decisions locked in
- **Login identifier:** email. `student_name` stays the internal data key everywhere; email is only the login lookup mapping to a `student_name` (avoids rewriting every handler/sheet).
- **Accounts:** teacher creates each account (invite-only, no self-signup). Teacher sets an initial password, shares out-of-band; forced reset out of scope v1.
- **Pricing:** one-time payment → full permanent access. Amount/currency set in the Stripe dashboard as a Price (`STRIPE_PRICE_ID`) — no code dependency on the number.
- **Free access:** teacher "grant access" toggle in the dashboard (no coupon codes).
- **Gating:** placement test free; daily course gated, enforced server-side.
- **Reads:** session-gate all student-data reads (not just writes). **Note:** this means a valid session (i.e. teacher-created login) is required *even to take the free placement test* — "placement free" means *not payment-gated*, not *no-session*. Consistent with invite-only access.
- **Stripe webhook:** Apps Script `doPost` can't read the `Stripe-Signature` header, so unlock is gated by a **server-to-Stripe re-fetch confirmation** (re-fetch the Checkout Session with the secret key, check `payment_status==='paid'`). HMAC is implemented as defense-in-depth/unit-testable; the re-fetch is the trust anchor — **no proxy required.**

### Domains / DNS
- `fluentpath.ca` → student repo `CNAME`.
- `teacher.fluentpath.ca` → teacher repo `CNAME` (DNS `CNAME` to `<user>.github.io`); still needs setup.
- `fluent-path.com` and `fluent-path.ca` → **registrar/DNS-level domain forwarding** to `fluentpath.ca` (can't live in a Pages repo — GitHub Pages binds one custom domain per repo).

---

## Phase 1 — Account & session model (`apps-script.js`)
- **New sheets** via existing `getOrCreateSheet()` (lazy, no manual setup), added to `HEADERS` (`apps-script.js:506`):
  - `Accounts`: `email, student_name, role, pw_salt, pw_hash, created_at, created_by, active` (`role` ∈ `student|teacher`).
  - `Sessions`: `token, email, role, student_name, issued_at, expires_at, revoked`. Read-through cached via existing `cacheGet/cachePut` (`apps-script.js:226-237`), key `session_<token>`.
- **Password hashing** (no bcrypt in Apps Script): `hashPassword(plain, salt)` = iterated SHA-256 (~100k rounds) over `salt + pepper + plain` using `Utilities.computeDigest`; `pepper` = server-only `PW_PEPPER` Script Property. `verifyPassword` uses constant-time `safeEquals`. Salt = `Utilities.getUuid()` per account. Benchmark rounds once to stay well under the 6-min limit.
- **Session helpers:** `createSession(account)` (token = double `Utilities.getUuid()`; TTL students ~30 d, teacher ~12 h), `validateSession(token)` (cache → `Sessions` via TextFinder; null on missing/expired/revoked), `revokeSession(token)`.
- **New handlers** in `POST_HANDLERS` (`apps-script.js:2033`), routed in `doPost` (`apps-script.js:2175`):
  - `login` (needs only `APP_SECRET`): `{email,password}` → verify → `createSession` → `{ok, session, role, student_name, expires_at}`. Generic failure message. Rate-limit per email via `CacheService` (e.g. 5 / 15 min) — login is internet-reachable.
  - `logout` (valid session) → `revokeSession`.
  - `create_account` (**teacher-only**): `{email, student_name, password, role}`; reject duplicate email; hash; append; ensure a `Settings` row via existing `upsertByStudent`.
- **Server-derived identity** — `resolveSession(params)` early in `doGet` (595) and `doPost` (2175):
  - Student session → **force** effective student to `session.student_name`, overwriting any `?student=`/`student_name=` (closes the impersonation hole).
  - Teacher session → honor `?student=NAME` (act-on-behalf is legitimate).
- **Phase out public teacher token:** reimplement `validateTeacherToken` (`apps-script.js:162`) to require `validateToken` **AND** `resolveSession().role==='teacher'` for `TEACHER_ACTIONS` (172) and `isExaminerPost` (185). Temporary grace fallback to legacy `TEACHER_SECRET` until `AUTH_ENFORCED=true`. Also make `update_call_status`/`request_video_call` verify the session student matches the call's student.

## Phase 2 — Server-authoritative course gating (`apps-script.js`)
- Extend `HEADERS['Settings']` (`apps-script.js:534`) with `paid, access_granted, stripe_customer_id, paid_at`. Existing `ensureSheetHeaders` (`apps-script.js:443`) appends columns non-destructively — existing students survive.
- `isCourseUnlocked(settingsRow)` = `truthy(paid) || truthy(access_granted)` — pure, string-tolerant, unit-testable.
- Surface it: `handleGetProgress` (`apps-script.js:624`, already fetches `settingsRow`) returns `course_unlocked`. Placement-test fields unchanged.
- **Enforce on the gated path:** `save_progress` (`apps-script.js:2057`) and `generate_lesson` (`apps-script.js:583`) reject locked **student** sessions (`Error('Course locked')`).
- **Teacher grant-access** reuses existing `update_settings` (`apps-script.js:2099`) merge-upsert — sending `access_granted=true` just works once the column exists.

## Phase 3 — Stripe (`apps-script.js`)
- Script Properties (server-only): `STRIPE_SECRET, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_ID`, plus `STUDENT_URL`/`TEACHER_URL` (also replace hardcoded `sgalindo88.github.io/fluentpath` email links at `apps-script.js:296,308,330-331,344`).
- `create_checkout` (POST, **student session required**): resolve student from session; `UrlFetchApp` POST to `https://api.stripe.com/v1/checkout/sessions` (`mode=payment`, `line_items[0][price]=STRIPE_PRICE_ID`, `client_reference_id=student_name`, `customer_email`, `success_url=https://fluentpath.ca/?paid=1`, `cancel_url=…?paid=0`). Return `{url}`; frontend redirects. (`UrlFetchApp` already authorized — `authorizeScript` 2234.) **URL-encode** every value when assembling the form body (`encodeURIComponent`) — `student_name`/email can contain spaces or accents that would otherwise corrupt the request.
- **Webhook receiver:** in `doPost` (2175), **before** the auth block, detect `params.stripe==='1'` and branch/return early (skipping `validateToken`). On `checkout.session.completed`: **re-fetch** `GET /v1/checkout/sessions/{id}` with `STRIPE_SECRET`, confirm `payment_status==='paid'`, then set `paid=true, paid_at, stripe_customer_id` via `upsertByStudent` + `cacheInvalidateStudent`. Implement `verifyStripeSignature(payload, sigHeader)` (HMAC via `Utilities.computeHmacSha256Signature`) for defense-in-depth + tests. Return plain `200`. **Idempotency:** Stripe retries on any non-`200`, so the handler must be safe to run repeatedly — `upsertByStudent` already overwrites in place (no duplicate rows), and the handler must return `200` even when `paid` is already true (re-confirming a paid session is a no-op, not an error).
- **Paywall flow:** new `#screen-paywall` in `index.html`; when `progress.course_unlocked` is false and the student opens the course, show paywall → POST `create_checkout` → redirect. On return (`?paid=1`) poll `get_progress` a few times (webhook lag); never trust the query param for unlock.

## Phase 4 — Frontend login & shared JS
- `config.js`: **remove** `FP.TEACHER_TOKEN`; keep `FP.APP_TOKEN`. Fix `FP.ENV` to treat `fluentpath.ca`/`teacher.fluentpath.ca` as production (replace hardcoded `sgalindo88.github.io` at line 13). Add `FP.IS_TEACHER_SITE = location.hostname.startsWith('teacher.')`, `FP.STUDENT_URL='https://fluentpath.ca'`, `FP.TEACHER_URL='https://teacher.fluentpath.ca'`, and `FP.KEYS.SESSION/SESSION_EXP/ROLE`.
- `api.js`: in `_appendToken` (55) and `postForm`/`postJson` (93-132) keep `token`, **drop `teacher_token`**, inject `session` from localStorage. Add a 401/`Unauthorized` interceptor that clears the session and redirects to the site's login.
- **Student login** (`index.html` + `hub.js`): convert `#screen-welcome` to email+password; rewrite `enterHub()` (`hub.js:29`) to POST `login`, store session/role/exp/name, then `fetchProgress` using the **server-returned** name. Auto-login when a non-expired session exists; logout → POST `logout`. Add "For teachers" link → `FP.TEACHER_URL`. `student-test.js`/`student-lesson.js` keep reading `fp_student_name` but guard: no valid session → redirect to login.
- **Teacher login** (teacher subdomain): `teacher.html` becomes the login page (must return `role==='teacher'`) → student picker; auto-login + logout. `examiner-panel.js` init (`2247`) requires a teacher session or redirects. Add **"Create student account"** UI (→ `create_account`) and the **grant-access toggle** (→ `update_settings` with `access_granted`).

## Phase 5 — Two-repo GitHub Pages split + shared-code sync

**Tooling implemented 2026-06-06** (the physical repo split / push is Phase 6 — a single working tree can't create two repos). What exists now:

- **Single source of truth = this (student) repo.** Decision/deviation from the original "move shared files to a `shared/` dir": that would duplicate every shared file *within* the one repo and break all existing `src/scripts/...` references. Instead this repo's `src/` stays canonical (it already owns `apps-script.js` + `tests/`), and the teacher repo receives generated copies. Same no-drift outcome, zero in-repo duplication, HTML untouched.
- **`scripts/sync-shared.mjs`** (`npm run sync`, `npm run sync:check`): provisions the teacher repo from this one —
  - verbatim copies of the shared set (`config.js, api.js, utils.js, i18n.js, call-request.js, theme.css, mobile.css`) at the same `src/` paths;
  - a **generated teacher `sw.js`** — derived from this repo's `sw.js` by swapping only the app-shell list + `CACHE_VERSION` (`fp-teacher-v1`), so the offline/fetch logic never drifts;
  - the teacher **`CNAME`** (`teacher.fluentpath.ca`).
  - `--dest=<path>` / `$TEACHER_REPO` (default `../fluentpath-teacher`); `--check` is a CI drift guard (exit 1).
- **CI** (`.github/workflows/ci.yml`): a `sync-teacher` job runs on push to `master`, checks out the teacher repo via `TEACHER_REPO_TOKEN`, runs the sync, and commits/pushes if changed. **Dormant until opted in** — gated on repo variables `ENABLE_TEACHER_SYNC=true` and `TEACHER_REPO_SLUG=<owner>/<repo>` (so it never breaks CI before the teacher repo exists). The cross-repo push needs a credential the default `GITHUB_TOKEN` can't provide — a fine-grained PAT / deploy key with write access to the teacher repo, stored as the `TEACHER_REPO_TOKEN` secret.
- **Student `sw.js` is now student-scoped** (`APP_SHELL` no longer lists `teacher.html`/`examiner-panel.*`/`teacher-portal.js`). Change is dormant until the `CACHE_VERSION` bump at cutover (`sw.js` install only re-runs on a version change). No teacher→student relative links exist; the only cross-site link is student→teacher via `FP.TEACHER_URL`.

**Still manual at the physical split (Phase 6):** create the teacher GitHub repo; move the teacher-only files (`teacher.html`, `src/examiner-panel.html`, `examiner-panel.js`, `teacher-portal.js`, their CSS) out of this repo into it; run `npm run sync --dest=<teacher repo>` once to seed the shared/generated files; `git mv app.html index.html` here; set both `CNAME`s and the `ENABLE_TEACHER_SYNC`/`TEACHER_REPO_SLUG` vars + `TEACHER_REPO_TOKEN` secret.

## Phase 6 — Migration & cutover (manual checklist — do NOT script blindly)

> **Step-by-step runbook:** `docs/cutover-runbook.md` expands
> this checklist into ordered stages with per-stage verify + rollback. The
> summary below stays here for context.

1. Deploy backend with `AUTH_ENFORCED` unset (legacy paths still accepted). Set `PW_PEPPER` first (hashing needs it).
2. **Bootstrap the first teacher account manually.** The new frontend no longer sends the legacy `teacher_token`, so the grace path can't authorize a teacher action until a teacher *session* exists — chicken-and-egg. Break it once by running `create_account` from the Apps Script editor (or a temporary `doGet` shim) to insert the teacher's own row (`role=teacher`). After that the teacher can log in at `teacher.html` and the in-UI "Create student account" works normally.
3. Teacher logs into the new teacher site, uses "Create student account" for each existing student with their **existing `student_name`** as the key — existing data associates immediately (no data movement).
4. Set `access_granted=true` for existing students (they shouldn't pay) — the per-student "Grant free course access" toggle in the examiner panel, or set the `Settings.access_granted` column directly.
5. Deploy both frontends; confirm login; set `AUTH_ENFORCED=true`; **delete** the `TEACHER_SECRET` Script Property; bump `CACHE_VERSION`.
6. Rotate `APP_SECRET` (it leaked in git history); update `FP.APP_TOKEN` in both repos.

### Hosting — resolve BEFORE cutover
- **Production host is GitHub Pages** (`fluentpath.ca`, custom domain verified, HTTPS cert auto-managed, built from `master` root). The two-repo split assumes this. ✓ matches plan.
- **Disconnect the vestigial Netlify site.** This repo is also wired to a Netlify site (`learningenglishsg`, no in-repo config — dashboard-connected GitHub App) that mirrors every push/PR to `learningenglishsg.netlify.app`. It does **not** serve the production domain, but post-cutover it would expose a second public copy of the login/paywall/teacher app pointed at the **prod** Apps Script backend (and, on a `*.netlify.app` host, `FP.ENV` resolves to `development` → DEV banner + `config.local.js` 404). Auth is still server-enforced there, so it's not a privilege hole — just an unmanaged surface. Steps: Netlify dashboard → site `learningenglishsg` → Site configuration → Build & deploy → **unlink repository** (or delete the site). Removes the parallel copy and the per-PR Netlify deploy-preview check.

### Manual setup you must do outside the code
- DNS: `teacher.fluentpath.ca` `CNAME` → `<user>.github.io`; registrar forwarding for `fluent-path.com`/`fluent-path.ca` → `fluentpath.ca`; `CNAME` files in each repo.
- Stripe: create account + a one-time Price; set `STRIPE_PRICE_ID`; add a webhook endpoint → the Apps Script `/exec?stripe=1` URL; copy `STRIPE_SECRET` + `STRIPE_WEBHOOK_SECRET`.
- Script Properties: `PW_PEPPER` (32+ random chars), the three Stripe values, `STUDENT_URL`, `TEACHER_URL`, and (at cutover) `AUTH_ENFORCED=true`.
- GitHub: fine-grained PAT / deploy key with write access to the teacher repo, stored as the `TEACHER_REPO_TOKEN` Actions secret (Phase 5 sync CI step needs it).

## Phase 7 — Tests (vitest, mirroring `tests/apps-script.test.js`)
Extend `tests/helpers.js` mocks: `Utilities.computeDigest`, `computeHmacSha256Signature`, `base64Encode`, fake `Sessions`/`Accounts` stores. New tests:
- `hashPassword`/`verifyPassword`: stable hash for same input+salt+pepper; wrong password fails; different salt differs; `safeEquals` length-mismatch false.
- `validateSession`: valid/expired/revoked/unknown + cache hit.
- `resolveEffectiveStudent`: student forced to own name; teacher honors `student=`.
- `isCourseUnlocked`: paid / access_granted / both-false / mixed-case strings.
- `verifyStripeSignature`: known payload+secret → expected HMAC; tampered fails.
Keep existing 45 green (22 in `apps-script.test.js` + 23 in `utils.test.js`); `npm run lint` clean.

---

## Files to create / modify
- **`apps-script.js`** — accounts/sessions/hashing, `login`/`logout`/`create_account`, `resolveSession`, reworked `validateTeacherToken`, `Settings` columns + `isCourseUnlocked` + gating in `save_progress`/`generate_lesson`/`handleGetProgress`, Stripe `create_checkout` + webhook, URL Script Properties. (Anchors: `153-187, 506-542, 575-624, 2033-2225`.)
- **`src/scripts/config.js`** — remove teacher token, fix `FP.ENV`/domains, add session keys + site URLs.
- **`src/scripts/api.js`** — drop `teacher_token`, inject `session`, 401 handling (`55, 93-132`).
- **`index.html` + `src/scripts/hub.js`** — student login, auto-login/logout, paywall screen, "For teachers" link.
- **`teacher.html` + `src/scripts/teacher-portal.js` + `src/scripts/examiner-panel.js`** — teacher login gate, create-account + grant-access UI (init `2247`).
- **`src/scripts/student-test.js` / `src/scripts/student-lesson.js`** — session guard/redirect.
- **`sw.js`** (both repos) — per-repo app shell, `CACHE_VERSION` bump.
- **`package.json` + `.github/workflows/ci.yml`** — `shared/` dir + `sync` script + CI push to teacher repo.
- **`tests/helpers.js` + `tests/apps-script.test.js`** — new mocks + unit tests.
- **New:** `CNAME` (each repo), `README.md` security-caveats section.

## Verification
- **Unit (`npm test`):** the Phase 7 suite + keep existing 45 green; `npm run lint` clean.
- **Backend (Apps Script editor + `clasp`):** run `login`/`create_account` against a test sheet; confirm `Accounts`/`Sessions` rows; confirm a student session can't read another student's `get_progress`; confirm `save_progress` rejects a locked student.
- **Stripe (test mode):** `create_checkout` returns a hosted URL; complete a test payment; confirm the webhook re-fetch flips `paid=true` and `course_unlocked` becomes true; confirm grant-access toggle unlocks without payment.
- **End-to-end (Playwright):** student login → paywall → (test-mode) pay → course unlocks; teacher login on the subdomain → create account → grant access → student course unlocks; logout clears session; expired/cleared session redirects to login; placement test reachable while locked; cross-domain "For teachers" link works.

## Security caveats (document in README)
- **localStorage session token** is non-httpOnly → XSS-readable (accepted trade-off); mitigated by TTL + server-side revoke + minimal third-party scripts.
- **`APP_SECRET` still ships** to clients — a speed bump, not a secret; real authz is the session.
- **`login` is internet-reachable** → rate-limited; passwords use iterated SHA-256 **+ server-only pepper** (weaker than bcrypt per platform limits; proportionate for ~10 invite-only users, not for public signup).
- **Stripe webhook** can't read the signature header on Apps Script → unlock gated by a **server-to-Stripe re-fetch**, so a forged webhook can't unlock; HMAC is defense-in-depth.
