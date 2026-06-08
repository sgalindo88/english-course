# FluentPath — Documentation

Reference, operational, and planning docs for the FluentPath platform. (The
high-level project overview lives in the root [`README.md`](../README.md); the
release history in [`CHANGELOG.md`](../CHANGELOG.md).)

## Reference

| Doc | What it covers |
|---|---|
| [google-sheets-schema.md](google-sheets-schema.md) | The Google Sheets workbook schema — every tab and column the Apps Script backend reads/writes. |
| [auth-payments.md](auth-payments.md) | Design + implementation of gated login, the two-repo (student/teacher) split, and Stripe course payments. **Implemented & live.** |

## Operations

| Doc | What it covers |
|---|---|
| [cutover-runbook.md](cutover-runbook.md) | Step-by-step production cutover runbook for the auth/payments rollout (staged deploy, `AUTH_ENFORCED` kill switch, per-stage verify/rollback, the test→live Stripe switch). |

## Roadmap (deferred)

| Doc | What it covers |
|---|---|
| [roadmap.md](roadmap.md) | Ideas and enhancements discussed but deferred, with the rationale for each. |
| [supabase-migration.md](supabase-migration.md) | The heavier Supabase/Postgres alternative to the Apps Script + Sheets backend — evaluated and deferred. |

## Archive

Historical planning snapshots, kept for context but no longer maintained:

- [archive/implementation-plan.md](archive/implementation-plan.md) — original implementation plan (from the suggestions review).
- [archive/progress-report.md](archive/progress-report.md) — point-in-time progress report.
- [archive/suggestions.md](archive/suggestions.md) — the 45-item improvement review.
- [archive/suggestions-audit.md](archive/suggestions-audit.md) — audit of which suggestions were adopted.
