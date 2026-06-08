# Phase 6 — Auth + Payments Cutover Runbook

Operational runbook for taking the gated-login / course-gating / Stripe work
(Phases 1–5, implemented in `apps-script.js` + frontend, see
`auth-payments-implementation.md`) **live**. Everything below is manual by
design — do not script it blindly.

> **Audience:** the operator (you). **Pre-req:** PR #1 (`feat/auth-payments`)
> merged to `master`, CI green. **Est. time:** ~2–3 hrs of focused work; can be
> split across days — the system is safe to leave between any two stages.

---

## 0. The safety model — read this first

The entire rollout hides behind one Script Property: **`AUTH_ENFORCED`**.

- **Unset / not `true` (grace mode):** reads work with only `APP_SECRET`;
  teacher writes accept the legacy `TEACHER_SECRET` **or** a teacher session;
  a missing session is tolerated. This is today's behavior plus the new
  endpoints lying dormant.
- **`true` (enforced):** every student read/write needs a valid session;
  teacher actions need a teacher session; legacy `TEACHER_SECRET` is refused.

**`AUTH_ENFORCED` is the kill switch.** If anything misbehaves after Stage I,
delete the `AUTH_ENFORCED` property → you are instantly back in grace mode.
Do **not** delete `TEACHER_SECRET` or rotate `APP_SECRET` until you have
confirmed the enforced path works (Stages I–J), because those make rollback
harder.

⚠️ **Course gating is independent of `AUTH_ENFORCED`.** `enforceCourseAccess`
gates any *logged-in student* whose `Settings` row isn't `paid`/`access_granted`
— even in grace mode. So existing students must be granted access (Stage F)
**before** they log in, or their course locks.

---

## Stage A — External accounts & DNS  *(no user impact; fully reversible)*

- [ ] **A1. Stripe account + Price.** Create/confirm the Stripe account. Create a
  **one-time** Price (mode=payment) for full course access. Copy its
  `price_…` id. The amount lives only in Stripe — no code change to change it.
- [ ] **A2. Stripe webhook endpoint.** Stripe Dashboard → Developers → Webhooks →
  add endpoint pointing at the Apps Script exec URL **with `?stripe=1`**:
  `https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec?stripe=1`.
  Subscribe to **`checkout.session.completed`**. Copy the signing secret
  (`whsec_…`). *(Note: Apps Script can't read the signature header, so the
  unlock is gated by a server-to-Stripe re-fetch — the webhook secret is only
  defense-in-depth and is optional to wire.)*
- [ ] **A3. DNS for the teacher subdomain.** Add `teacher.fluentpath.ca` →
  `CNAME` → `<github-user>.github.io` (will be pointed at the teacher repo's
  Pages in Stage E).
- [ ] **A4. Domain forwarding (optional).** Registrar-level forwarding for
  `fluent-path.com` / `fluent-path.ca` → `https://fluentpath.ca` (these can't
  live in a Pages repo — one custom domain per repo).

**Verify:** Stripe shows the Price + a webhook endpoint (it'll read "no events"
until A2's URL is live). DNS can be set now; propagation is fine to run ahead.

---

## Stage B — Script Properties + backend deploy in grace mode  *(no user impact)*

Set these in the Apps Script project (Project Settings → Script Properties).
**Do NOT set `AUTH_ENFORCED` yet.**

- [ ] **B1.** `PW_PEPPER` = 32+ random chars (server-only password pepper).
- [ ] **B2.** `STRIPE_SECRET` = `sk_…` (live or test — start with **test**).
- [ ] **B3.** `STRIPE_WEBHOOK_SECRET` = `whsec_…` from A2.
- [ ] **B4.** `STRIPE_PRICE_ID` = `price_…` from A1.
- [ ] **B5.** `STUDENT_URL` = `https://fluentpath.ca`
- [ ] **B6.** `TEACHER_URL` = `https://teacher.fluentpath.ca`
- [ ] **B7. Deploy the backend.** `npm run clasp:push`, then **Manage
  deployments → edit the existing Web App deployment → New version** (do NOT
  "New deployment" — that mints a new URL and breaks `FP.WEBHOOK_URL`). Keep
  "Execute as: Me", "Who has access: Anyone".
- [ ] **B8. Authorize new scopes if prompted** — run `authorizeScript` once in
  the editor (covers `UrlFetchApp`/`SpreadsheetApp`/`DriveApp`).

**Verify:** `curl "<EXEC_URL>?action=health"` returns the health JSON.
**Rollback:** redeploy the prior version; unset the new properties. No user
impact occurred (grace mode = old behavior).

---

## Stage C — Backend smoke tests (grace mode)

Run from a terminal against `<EXEC_URL>` (the deployment URL; `<APP>` =
`APP_SECRET`). The `Accounts`/`Sessions`/extra `Settings` columns auto-create on
first use.

- [ ] **C1. login rejects unknown user** (no account yet):
  `curl -sX POST "<EXEC_URL>?action=login&token=<APP>" -H 'Content-Type: application/json' -d '{"email":"x@y.z","password":"nope"}'`
  → `{"ok":false,"error":"Invalid email or password"}`.
- [ ] **C2.** Confirm `Accounts` and `Sessions` sheets were created in the
  spreadsheet, and `Settings` gained `paid / access_granted / stripe_customer_id
  / paid_at` columns (appended on the right, existing rows intact).

---

## Stage D — Bootstrap the first teacher account  *(chicken-and-egg fix)*

The new frontend no longer sends `teacher_token`, so the grace path can't
authorize `create_account` until a teacher **session** exists — but you can't
log in without a teacher account. Break the loop **once**, server-side:

- [ ] **D1.** In the Apps Script editor, run a one-off that calls the handler
  directly, e.g. a temporary function:
  ```js
  function bootstrapTeacher() {
    POST_HANDLERS.create_account(
      { email: 'you@example.com', student_name: 'Sebastian Galindo',
        password: '<initial-strong-pw>', role: 'teacher' }, {});
  }
  ```
  Run it once, then **delete the function** (don't leave creds in source).
- [ ] **D2. Verify login works:**
  `curl -sX POST "<EXEC_URL>?action=login&token=<APP>" -H 'Content-Type: application/json' -d '{"email":"you@example.com","password":"<initial-strong-pw>"}'`
  → `{"ok":true,"role":"teacher","session":"…","expires_at":"…"}`.

**Rollback:** delete the teacher row from the `Accounts` sheet.

---

## Stage E — Repo split & teacher site  *(no user impact until DNS + Pages flip)*

- [ ] **E1. Create the teacher repo** (e.g. `sgalindo88/fluentpath-teacher`),
  empty.
- [ ] **E2. Seed shared/generated files:** from the student repo run
  `npm run sync -- --dest=<path-to-teacher-repo-checkout>`. This writes the 7
  shared files, the generated teacher `sw.js`, and the teacher `CNAME`
  (`teacher.fluentpath.ca`).
- [ ] **E3. Move teacher-only files** into the teacher repo and **remove them
  from the student repo**: `teacher.html`, `src/examiner-panel.html`,
  `src/scripts/examiner-panel.js`, `src/scripts/teacher-portal.js`,
  `src/styles/teacher-portal.css`, `src/styles/examiner-panel.css`.
- [ ] **E4. Promote the student app:** in the student repo,
  `git mv app.html index.html` (replaces the coming-soon page).
- [ ] **E5. Enable Pages on the teacher repo** (Settings → Pages → branch
  `master` /root), set custom domain `teacher.fluentpath.ca`, wait for the cert.
- [ ] **E6. Confirm the student repo `CNAME`** is still `fluentpath.ca`.
- [ ] **E7. Wire the sync CI** (so future shared-file edits propagate): on the
  student repo set Actions **variables** `ENABLE_TEACHER_SYNC=true` and
  `TEACHER_REPO_SLUG=sgalindo88/fluentpath-teacher`, and **secret**
  `TEACHER_REPO_TOKEN` = fine-grained PAT/deploy key with write access to the
  teacher repo.
- [ ] **E8. Disconnect the vestigial Netlify site** (`learningenglishsg`):
  Netlify dashboard → that site → Site configuration → Build & deploy → unlink
  repository (or delete the site). Removes the parallel public copy that would
  otherwise mirror the app to `learningenglishsg.netlify.app` against the prod
  backend.

**Verify:** `https://teacher.fluentpath.ca` serves the teacher login;
`https://fluentpath.ca` now serves the student **login** (not coming-soon).
Still in grace mode, so login is the only thing gated.

---

## Stage F — Account migration  *(do BEFORE students use the course)*

- [ ] **F1. Create a student account for each existing student** via the teacher
  portal's "Create student account" — use their **existing `student_name`** as
  the data key so their history associates immediately (no data movement).
  Share each initial password out-of-band.
- [ ] **F2. Grant existing students free access** (they shouldn't pay): for each,
  toggle **"Grant free course access"** in the examiner panel, or set
  `Settings.access_granted=true` directly. *(Required: course gating is active
  even in grace mode once a student logs in.)*

**Verify:** `get_progress` for a migrated student returns
`"course_unlocked": true`.

---

## Stage G — Frontend deploy & end-to-end check (still grace mode)

- [ ] **G1.** Push the student repo (`index.html` app) and confirm Pages built.
- [ ] **G2. Student e2e:** at `https://fluentpath.ca` — log in as a test
  student, confirm dashboard loads with the server-resolved name; if not
  granted/paid, the course CTA opens the paywall.
- [ ] **G3. Payment e2e (Stripe test mode):** from the paywall, "Continue to
  Payment" → Stripe Checkout → pay with a test card → land back on
  `?paid=1` → the course unlocks within a few seconds (webhook re-fetch).
  Confirm `Settings.paid=true` for that student.
- [ ] **G4. Teacher e2e:** at `https://teacher.fluentpath.ca` — log in (teacher
  account from Stage D), see the student picker, open a student, save the
  profile, toggle grant-access.
- [ ] **G5. Cross-site:** the student "For teachers →" link reaches the teacher
  site; an unauthenticated visit to `…/src/examiner-panel.html` redirects to the
  teacher login.

**If any of G2–G5 fail, stop here** — you are still in grace mode, nothing is
enforced, and you can fix forward without locking anyone out.

---

## Stage H — Flip the switch  *(the actual cutover)*

- [ ] **H1.** Set Script Property **`AUTH_ENFORCED=true`**.
- [ ] **H2. Re-run G2 + G4** — confirm a logged-in student and teacher still
  work, and that a request with **no** session now gets `Unauthorized`
  (e.g. `curl "<EXEC_URL>?action=get_progress&student=Test&token=<APP>"`
  → `{"error":"Unauthorized"}`).
- [ ] **H3. Bump service-worker caches** so clients drop the old shell:
  student repo `sw.js` `CACHE_VERSION` `fp-v8 → fp-v9`; in
  `scripts/sync-shared.mjs` bump `TEACHER_CACHE_VERSION` `fp-teacher-v1 →
  fp-teacher-v2`, then `npm run sync` to regenerate the teacher `sw.js`. Commit
  + deploy both.

**Rollback:** delete the `AUTH_ENFORCED` property → instant return to grace.

---

## Stage I — Hardening  *(only after H is confirmed stable)*

- [ ] **I1. Delete `TEACHER_SECRET`** Script Property (the legacy teacher path is
  now unused; removing it closes the grace fallback for teacher writes).
- [ ] **I2. Rotate `APP_SECRET`** (it leaked in git history). Because the app
  token is sent on every call, do this atomically: set the new `APP_SECRET`
  property **and** update `FP.APP_TOKEN` in both repos in the same change, then
  redeploy frontends and bump `CACHE_VERSION` again so cached clients pick up
  the new token. *(Optional but recommended; can be deferred to a follow-up.)*
- [ ] **I3. Switch Stripe from test mode to live** — full procedure below.

---

## I3 — Switching Stripe test → live (when launching paid courses)

The cutover runs Stripe in **test mode** so the paywall can be exercised without real charges. Going live is a **Script-Properties-only** change — **no code edit, no redeploy** (the backend reads `STRIPE_*` at request time). The catch: in Stripe, **test and live are completely separate** — API keys, Prices, and webhook endpoints (and their signing secrets) all exist independently per mode. You must replace **all three** properties with their live-mode counterparts, or you'll get mismatches (e.g. a live key trying to re-fetch a test session → "No such checkout session").

**Pre-req:** the Stripe account must be **activated for live payments** (Dashboard → complete business profile / "Activate payments"). Until then, live keys don't exist.

1. [ ] **Live Price.** Flip the Dashboard to **Live mode** (top-right toggle). Re-create the one-time Price (Products → Add product → one-time) — the test `price_…` does **not** carry over. Copy the new **live** `price_…`.
2. [ ] **Live webhook endpoint.** Still in Live mode: Developers → Webhooks → Add endpoint → URL = the **same** Apps Script exec URL **with `?stripe=1`**, event = **`checkout.session.completed`**. Copy the endpoint's **live** signing secret (`whsec_…`).
3. [ ] **Live secret key.** Developers → API keys (Live mode) → reveal the **Secret key** (`sk_live_…`).
4. [ ] **Update Script Properties** (Apps Script → Project Settings → Script Properties) — replace all three, save:
   - `STRIPE_SECRET` → `sk_live_…`
   - `STRIPE_WEBHOOK_SECRET` → the live `whsec_…` (from step 2 — it differs from the test one)
   - `STRIPE_PRICE_ID` → the live `price_…` (from step 1)
   *(No deploy needed. `STUDENT_URL`/`TEACHER_URL` and the code are unchanged.)*
5. [ ] **Verify with a real charge** (Stripe rejects test cards in live mode): from `fluentpath.ca`, log in as a student who is **not** granted/paid → open the course → pay with a **real card** for the smallest amount → confirm the course unlocks (webhook re-fetch flips `paid=true`) → then **refund** that payment in the Dashboard if it was just a test. Watch Developers → Webhooks → your live endpoint → "Recent deliveries" for a `200` on `checkout.session.completed`.
6. [ ] **Confirm test-mode artifacts are retired** — the test webhook endpoint can be deleted (or left; it just won't fire in live). Don't leave test keys in the properties.

**Rollback:** set the three `STRIPE_*` properties back to their test values (`sk_test_…` / test `whsec_…` / test `price_…`). Instant, no redeploy. Already-unlocked students stay unlocked (`paid`/`access_granted` are sticky).

**Notes**
- Unlock is gated by the **server-to-Stripe re-fetch** (`fulfillCheckout`), which uses `STRIPE_SECRET`. So the key's mode must match the mode the Checkout Session was created in — which is why all three must move together.
- The webhook signature check (`verifyStripeSignature`, `STRIPE_WEBHOOK_SECRET`) is defense-in-depth only; the re-fetch is the trust anchor. Still, set the live `whsec_…` so it's consistent.
- Pricing changes later need **no code change** — just edit/replace the Price in Stripe and update `STRIPE_PRICE_ID`.

---

## Stage J — Post-cutover verification & monitoring

- [ ] **J1.** Run the Phase 7 Playwright e2e against production (student login →
  paywall → live/test pay → unlock; teacher create-account → grant → unlock;
  logout clears session; expired/cleared session redirects; placement test
  reachable while locked).
- [ ] **J2.** Watch the `Error Log` sheet and Stripe webhook delivery log for the
  first day. Confirm no spike in `Unauthorized` / `Course locked` / failed
  webhook re-fetches.
- [ ] **J3.** Confirm `fluent-path.com`/`fluent-path.ca` forwarding resolves; the
  Netlify mirror is gone.

---

## Rollback quick-reference

| Symptom | Action |
|---|---|
| Anything broken after Stage H | Delete `AUTH_ENFORCED` → grace mode restored |
| Backend deploy bad | Manage deployments → roll back to prior version |
| Teacher locked out | Re-add `TEACHER_SECRET` (if already deleted) **and** unset `AUTH_ENFORCED` |
| App token mismatch after I2 | Restore prior `APP_SECRET`, revert `FP.APP_TOKEN` |
| Student wrongly locked out of course | Set their `Settings.access_granted=true` |
| Webhook not unlocking | Check Stripe delivery log; re-fetch needs valid `STRIPE_SECRET`; unlock is idempotent so safe to redeliver |

## Appendix — Script Properties at end-state

| Property | Value | Set in |
|---|---|---|
| `APP_SECRET` | rotated 32-char | I2 |
| `PW_PEPPER` | 32+ random | B1 |
| `STRIPE_SECRET` | live `sk_…` | B2 / I3 |
| `STRIPE_WEBHOOK_SECRET` | live `whsec_…` | B3 / I3 |
| `STRIPE_PRICE_ID` | live `price_…` | B4 / I3 |
| `STUDENT_URL` | `https://fluentpath.ca` | B5 |
| `TEACHER_URL` | `https://teacher.fluentpath.ca` | B6 |
| `AUTH_ENFORCED` | `true` | H1 |
| `TEACHER_SECRET` | **deleted** | I1 |
| `AI_API_KEY` / `AI_PROVIDER` / `AI_MODEL` | unchanged | — |
