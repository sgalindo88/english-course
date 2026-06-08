/**
 * Password-reset tests — the email-link flow: request_reset (generic, no email
 * enumeration), the token lifecycle (single-use, expiring, hashed), and
 * reset_password (sets a new password + revokes sessions).
 */
import { describe, it, expect } from 'vitest';
import { loadAppsScriptAuth } from './helpers.js';

function makeStudent(fp, email = 'maria@x.com', pw = 'origpass') {
  fp.POST_HANDLERS.create_account(
    { email, student_name: 'Maria', password: pw, role: 'student' }, {});
  return email;
}

/** Pull the raw reset token out of the email the handler "sent". */
function tokenFromMail(fp) {
  const last = fp._mail[fp._mail.length - 1];
  const m = last && /[?&]reset=([^"&]+)/.exec(last.htmlBody || '');
  return m ? decodeURIComponent(m[1]) : null;
}

describe('request_reset', () => {
  it('emails a reset link for a real account', () => {
    const fp = loadAppsScriptAuth({ PW_PEPPER: 'pep', STUDENT_URL: 'https://fluentpath.ca' });
    makeStudent(fp);
    const res = fp.POST_HANDLERS.request_reset({ email: 'maria@x.com' }, {});
    expect(res._json.ok).toBe(true);
    expect(fp._mail.length).toBe(1);
    expect(fp._mail[0].htmlBody).toMatch(/https:\/\/fluentpath\.ca\/\?reset=/);
  });

  it('returns the same generic ok for an unknown email and sends nothing (no enumeration)', () => {
    const fp = loadAppsScriptAuth({ PW_PEPPER: 'pep' });
    const res = fp.POST_HANDLERS.request_reset({ email: 'nobody@x.com' }, {});
    expect(res._json.ok).toBe(true);
    expect(fp._mail.length).toBe(0);
  });

  it('rate-limits after 3 requests per hour', () => {
    const fp = loadAppsScriptAuth({ PW_PEPPER: 'pep' });
    makeStudent(fp);
    for (let i = 0; i < 3; i++) fp.POST_HANDLERS.request_reset({ email: 'maria@x.com' }, {});
    expect(fp._mail.length).toBe(3);
    fp.POST_HANDLERS.request_reset({ email: 'maria@x.com' }, {}); // throttled
    expect(fp._mail.length).toBe(3); // no new email
  });

  it('sends the teacher link to the teacher site', () => {
    const fp = loadAppsScriptAuth({ PW_PEPPER: 'pep', TEACHER_URL: 'https://teacher.fluentpath.ca' });
    fp.POST_HANDLERS.create_account({ email: 't@x.com', student_name: 'T', password: 'pw1', role: 'teacher' }, {});
    fp.POST_HANDLERS.request_reset({ email: 't@x.com' }, {});
    expect(fp._mail[0].htmlBody).toMatch(/https:\/\/teacher\.fluentpath\.ca\/\?reset=/);
  });
});

describe('reset_password', () => {
  it('sets a new password the user can log in with, and the old one stops working', () => {
    const fp = loadAppsScriptAuth({ PW_PEPPER: 'pep' });
    makeStudent(fp, 'maria@x.com', 'origpass');
    fp.POST_HANDLERS.request_reset({ email: 'maria@x.com' }, {});
    const token = tokenFromMail(fp);

    const res = fp.POST_HANDLERS.reset_password({ reset_token: token, password: 'brandnew1' }, {});
    expect(res._json.ok).toBe(true);

    expect(fp.POST_HANDLERS.login({ email: 'maria@x.com', password: 'brandnew1' }, {})._json.ok).toBe(true);
    expect(fp.POST_HANDLERS.login({ email: 'maria@x.com', password: 'origpass' }, {})._json.ok).toBe(false);
  });

  it('is single-use — the same token can not be reused', () => {
    const fp = loadAppsScriptAuth({ PW_PEPPER: 'pep' });
    makeStudent(fp);
    fp.POST_HANDLERS.request_reset({ email: 'maria@x.com' }, {});
    const token = tokenFromMail(fp);
    expect(fp.POST_HANDLERS.reset_password({ reset_token: token, password: 'first123' }, {})._json.ok).toBe(true);
    const second = fp.POST_HANDLERS.reset_password({ reset_token: token, password: 'second123' }, {});
    expect(second._json.ok).toBe(false);
    expect(second._json.error).toMatch(/already been used|invalid or has expired/i);
  });

  it('rejects an unknown/garbage token', () => {
    const fp = loadAppsScriptAuth({ PW_PEPPER: 'pep' });
    makeStudent(fp);
    expect(fp.POST_HANDLERS.reset_password({ reset_token: 'not-a-real-token', password: 'whatever1' }, {})._json.ok).toBe(false);
  });

  it('rejects a too-short password', () => {
    const fp = loadAppsScriptAuth({ PW_PEPPER: 'pep' });
    makeStudent(fp);
    fp.POST_HANDLERS.request_reset({ email: 'maria@x.com' }, {});
    const token = tokenFromMail(fp);
    const res = fp.POST_HANDLERS.reset_password({ reset_token: token, password: '123' }, {});
    expect(res._json.ok).toBe(false);
    expect(res._json.error).toMatch(/at least 6/i);
  });

  it('revokes existing sessions on reset', () => {
    const fp = loadAppsScriptAuth({ PW_PEPPER: 'pep' });
    makeStudent(fp, 'maria@x.com', 'origpass');
    const session = fp.POST_HANDLERS.login({ email: 'maria@x.com', password: 'origpass' }, {})._json.session;
    expect(fp.validateSession(session)).not.toBeNull(); // valid before reset

    fp.POST_HANDLERS.request_reset({ email: 'maria@x.com' }, {});
    fp.POST_HANDLERS.reset_password({ reset_token: tokenFromMail(fp), password: 'newpass1' }, {});

    expect(fp.validateSession(session)).toBeNull(); // old session killed
  });
});

describe('reset token helpers', () => {
  it('consumeResetToken validates a fresh signed token and rejects junk', () => {
    const fp = loadAppsScriptAuth({ PW_PEPPER: 'pep' });
    makeStudent(fp);
    const acct = fp.findAccountByEmail('maria@x.com');
    const raw = fp.createResetToken(acct);
    const consumed = fp.consumeResetToken(raw);
    expect(consumed).not.toBeNull();
    expect(consumed.email).toBe('maria@x.com');
    expect(fp.consumeResetToken('')).toBeNull();
    expect(fp.consumeResetToken('wrong')).toBeNull();
    // tampered signature is rejected
    expect(fp.consumeResetToken(raw.slice(0, -2) + 'xx')).toBeNull();
  });
});
