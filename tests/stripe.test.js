/**
 * Phase 3 Stripe tests — checkout session creation, the webhook re-fetch that
 * is the real unlock trust anchor, and the defense-in-depth signature check.
 *
 * UrlFetchApp is mocked via fp._setFetch(handler) so we can stand in for
 * Stripe's API without network access.
 */
import { describe, it, expect } from 'vitest';
import { loadAppsScriptAuth } from './helpers.js';

function settingsOf(fp, name) {
  return fp.findLastByStudent('Settings', fp.HEADERS['Settings'], name);
}

describe('verifyStripeSignature', () => {
  it('accepts a correct signature and rejects tampering', () => {
    const fp = loadAppsScriptAuth({ STRIPE_WEBHOOK_SECRET: 'whsec' });
    const payload = '{"id":"evt_1","type":"checkout.session.completed"}';
    const t = '1700000000';
    const v1 = fp.bytesToHex(fp.Utilities.computeHmacSha256Signature(t + '.' + payload, 'whsec'));

    expect(fp.verifyStripeSignature(payload, `t=${t},v1=${v1}`)).toBe(true);
    expect(fp.verifyStripeSignature(payload + 'x', `t=${t},v1=${v1}`)).toBe(false); // tampered payload
    expect(fp.verifyStripeSignature(payload, `t=${t},v1=deadbeef`)).toBe(false);    // wrong sig
    expect(fp.verifyStripeSignature(payload, 'garbage')).toBe(false);               // malformed header
  });

  it('rejects when no webhook secret is configured', () => {
    const fp = loadAppsScriptAuth({});
    expect(fp.verifyStripeSignature('x', 't=1,v1=abc')).toBe(false);
  });
});

describe('fulfillCheckout (re-fetch trust anchor)', () => {
  it('marks the student paid only when Stripe reports payment_status=paid', () => {
    const fp = loadAppsScriptAuth({ STRIPE_SECRET: 'sk_test' });
    fp._setFetch(() => ({
      getResponseCode: () => 200,
      getContentText: () => JSON.stringify({
        payment_status: 'paid', client_reference_id: 'Maria', customer: 'cus_1' }),
    }));
    expect(fp.fulfillCheckout('cs_paid')).toBe(true);
    const row = settingsOf(fp, 'Maria');
    expect(fp.isCourseUnlocked(row)).toBe(true);
    expect(String(row.paid)).toBe('true');
    expect(String(row.stripe_customer_id)).toBe('cus_1');
    expect(String(row.paid_at)).not.toBe('');
  });

  it('does NOT unlock when the session is unpaid', () => {
    const fp = loadAppsScriptAuth({ STRIPE_SECRET: 'sk_test' });
    fp._setFetch(() => ({
      getResponseCode: () => 200,
      getContentText: () => JSON.stringify({ payment_status: 'unpaid', client_reference_id: 'Bob' }),
    }));
    expect(fp.fulfillCheckout('cs_unpaid')).toBe(false);
    expect(settingsOf(fp, 'Bob')).toBeNull();
  });

  it('is idempotent — replays keep paid=true and preserve paid_at', () => {
    const fp = loadAppsScriptAuth({ STRIPE_SECRET: 'sk_test' });
    fp._setFetch(() => ({
      getResponseCode: () => 200,
      getContentText: () => JSON.stringify({
        payment_status: 'paid', client_reference_id: 'Maria', customer: 'cus_1' }),
    }));
    fp.fulfillCheckout('cs_paid');
    const firstPaidAt = String(settingsOf(fp, 'Maria').paid_at);
    fp.fulfillCheckout('cs_paid'); // webhook retry / double delivery
    const row = settingsOf(fp, 'Maria');
    expect(String(row.paid)).toBe('true');
    expect(String(row.paid_at)).toBe(firstPaidAt);
  });

  it('returns false with no STRIPE_SECRET configured', () => {
    const fp = loadAppsScriptAuth({});
    expect(fp.fulfillCheckout('cs_x')).toBe(false);
  });
});

describe('handleStripeWebhook', () => {
  function event(id) {
    return JSON.stringify({ type: 'checkout.session.completed', data: { object: { id } } });
  }

  it('unlocks on checkout.session.completed after re-fetch', () => {
    const fp = loadAppsScriptAuth({ STRIPE_SECRET: 'sk_test' });
    fp._setFetch(() => ({
      getResponseCode: () => 200,
      getContentText: () => JSON.stringify({
        payment_status: 'paid', client_reference_id: 'Maria', customer: 'cus_1' }),
    }));
    const out = fp.handleStripeWebhook({ parameter: { stripe: '1' }, postData: { contents: event('cs_1') } });
    expect(out.getContent()).toBe('ok');
    expect(fp.isCourseUnlocked(settingsOf(fp, 'Maria'))).toBe(true);
  });

  it('ignores a forged signature when one is supplied', () => {
    const fp = loadAppsScriptAuth({ STRIPE_SECRET: 'sk_test', STRIPE_WEBHOOK_SECRET: 'whsec' });
    let fetched = false;
    fp._setFetch(() => { fetched = true; return { getResponseCode: () => 200, getContentText: () => '{}' }; });
    const out = fp.handleStripeWebhook({
      parameter: { stripe: '1', sig: 't=1,v1=bad' },
      postData: { contents: event('cs_1') },
    });
    expect(out.getContent()).toBe('ignored');
    expect(fetched).toBe(false); // never re-fetched, so never unlocked
    expect(settingsOf(fp, 'Maria')).toBeNull();
  });

  it('returns 200 (never throws) on a malformed body', () => {
    const fp = loadAppsScriptAuth({ STRIPE_SECRET: 'sk_test' });
    const out = fp.handleStripeWebhook({ parameter: { stripe: '1' }, postData: { contents: 'not json' } });
    expect(out.getContent()).toBe('ok');
  });
});

describe('create_checkout handler', () => {
  const session = { role: 'student', student_name: 'Maria', email: 'maria@x.com' };

  it('opens a Checkout Session scoped to the session student and returns its URL', () => {
    const fp = loadAppsScriptAuth({
      STRIPE_SECRET: 'sk_test', STRIPE_PRICE_ID: 'price_1', STUDENT_URL: 'https://fluentpath.ca' });
    let captured = null;
    fp._setFetch((url, opts) => {
      captured = { url, opts };
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ url: 'https://checkout.stripe/x' }) };
    });
    const res = fp.POST_HANDLERS.create_checkout({}, {}, session);
    expect(res._json.url).toBe('https://checkout.stripe/x');
    expect(captured.url).toContain('/v1/checkout/sessions');
    expect(captured.opts.payload['client_reference_id']).toBe('Maria');
    expect(captured.opts.payload['customer_email']).toBe('maria@x.com');
    expect(captured.opts.payload['line_items[0][price]']).toBe('price_1');
    expect(captured.opts.payload['success_url']).toBe('https://fluentpath.ca/?paid=1');
  });

  it('refuses without a student session', () => {
    const fp = loadAppsScriptAuth({ STRIPE_SECRET: 'sk', STRIPE_PRICE_ID: 'price_1' });
    expect(() => fp.POST_HANDLERS.create_checkout({}, {}, null)).toThrow(/login required/i);
    expect(() => fp.POST_HANDLERS.create_checkout({}, {}, { role: 'teacher' })).toThrow(/login required/i);
  });

  it('errors clearly when payments are not configured', () => {
    const fp = loadAppsScriptAuth({});
    expect(() => fp.POST_HANDLERS.create_checkout({}, {}, session)).toThrow(/not configured/i);
  });
});
