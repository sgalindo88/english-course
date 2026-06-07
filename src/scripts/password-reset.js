/* ═══════════════════════════════════════════════════════════════
   FluentPath — Shared password-reset UI
   ─────────────────────────────────────────────────────────────
   Self-contained modal used by BOTH the student app and the teacher
   portal (loaded after config.js + api.js). Two flows:
     • Forgot password  → FP.passwordReset.openForgot() (from the login screen)
                          → POST request_reset → emails a one-time link.
     • Set new password → arriving with ?reset=TOKEN shows the reset form
                          → POST reset_password.
   The backend is the source of truth; this only drives the UI.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  var FP = window.FP || (window.FP = {});
  var resetToken = null;

  function el(id) { return document.getElementById(id); }
  function setMsg(text, ok) {
    var m = el('fp-reset-msg');
    if (!m) return;
    m.textContent = text || '';
    m.style.display = text ? 'block' : 'none';
    m.style.color = ok ? '#2e6e45' : '#b8471e';
  }

  function injectModal() {
    if (el('fp-reset-modal')) return;
    var style = document.createElement('style');
    style.textContent =
      '#fp-reset-modal{position:fixed;inset:0;z-index:99998;display:none;align-items:center;justify-content:center;' +
      'background:rgba(26,18,8,0.55);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);}' +
      '#fp-reset-card{background:#fff;border-radius:12px;padding:28px 28px 24px;max-width:380px;width:90%;' +
      'box-shadow:0 8px 32px rgba(0,0,0,0.25);font-family:"Source Serif 4",Georgia,serif;color:#1a1208;}' +
      '#fp-reset-card h2{margin:0 0 6px;font-size:20px;}' +
      '#fp-reset-card p.sub{margin:0 0 16px;font-size:14px;color:#6b5d4a;}' +
      '#fp-reset-card input{width:100%;box-sizing:border-box;padding:11px 13px;margin-bottom:10px;font-size:15px;' +
      'border:1px solid #d8cfc0;border-radius:6px;font-family:inherit;}' +
      '#fp-reset-card button.primary{width:100%;padding:12px;font-size:15px;font-weight:600;cursor:pointer;border:none;' +
      'border-radius:6px;background:#1a1208;color:#fff;}' +
      '#fp-reset-card button.primary:disabled{opacity:0.6;cursor:default;}' +
      '#fp-reset-msg{font-size:13px;margin:4px 0 10px;display:none;}' +
      '#fp-reset-card .links{margin-top:14px;text-align:center;font-size:13px;}' +
      '#fp-reset-card .links a{color:#b8471e;text-decoration:none;cursor:pointer;}';
    document.head.appendChild(style);

    var modal = document.createElement('div');
    modal.id = 'fp-reset-modal';
    modal.innerHTML =
      '<div id="fp-reset-card">' +
        '<div id="fp-view-forgot" style="display:none;">' +
          '<h2>Reset your password</h2>' +
          '<p class="sub">Enter your email and we\'ll send you a link to set a new password.</p>' +
          '<input type="email" id="fp-reset-email" placeholder="you@example.com" autocomplete="username">' +
          '<p id="fp-reset-msg"></p>' +
          '<button class="primary" id="fp-reset-send">Send reset link</button>' +
          '<div class="links"><a id="fp-reset-cancel">Back to log in</a></div>' +
        '</div>' +
        '<div id="fp-view-set" style="display:none;">' +
          '<h2>Set a new password</h2>' +
          '<p class="sub">Choose a new password for your account.</p>' +
          '<input type="password" id="fp-reset-pw" placeholder="New password (min 6 characters)" autocomplete="new-password">' +
          '<input type="password" id="fp-reset-pw2" placeholder="Confirm new password" autocomplete="new-password">' +
          '<p id="fp-reset-msg2" style="font-size:13px;margin:4px 0 10px;display:none;color:#b8471e;"></p>' +
          '<button class="primary" id="fp-reset-save">Save new password</button>' +
          '<div class="links"><a id="fp-reset-cancel2">Cancel</a></div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);

    el('fp-reset-send').addEventListener('click', submitForgot);
    el('fp-reset-save').addEventListener('click', submitReset);
    el('fp-reset-cancel').addEventListener('click', hide);
    el('fp-reset-cancel2').addEventListener('click', hide);
  }

  function show(view) {
    injectModal();
    el('fp-view-forgot').style.display = view === 'forgot' ? 'block' : 'none';
    el('fp-view-set').style.display = view === 'set' ? 'block' : 'none';
    el('fp-reset-modal').style.display = 'flex';
  }
  function hide() {
    var m = el('fp-reset-modal');
    if (m) m.style.display = 'none';
  }
  function setMsg2(text) {
    var m = el('fp-reset-msg2');
    if (m) { m.textContent = text || ''; m.style.display = text ? 'block' : 'none'; }
  }

  async function submitForgot() {
    var email = (el('fp-reset-email').value || '').trim();
    setMsg('');
    if (!email) { setMsg('Please enter your email.'); return; }
    var btn = el('fp-reset-send'), label = btn.textContent;
    btn.disabled = true; btn.textContent = 'Sending…';
    try {
      await FP.api.postRead(FP.WEBHOOK_URL + '?action=request_reset', { email: email });
      // Generic by design — never reveals whether the email exists.
      setMsg('If an account exists for that email, a reset link is on its way. Check your inbox (and spam).', true);
    } catch (e) {
      setMsg('Could not send the reset link. Please try again.');
    } finally {
      btn.disabled = false; btn.textContent = label;
    }
  }

  async function submitReset() {
    var pw = el('fp-reset-pw').value || '';
    var pw2 = el('fp-reset-pw2').value || '';
    setMsg2('');
    if (pw.length < 6) { setMsg2('Password must be at least 6 characters.'); return; }
    if (pw !== pw2) { setMsg2('Passwords do not match.'); return; }
    var btn = el('fp-reset-save'), label = btn.textContent;
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      var res = await FP.api.postRead(FP.WEBHOOK_URL + '?action=reset_password', { token: resetToken, password: pw });
      if (res && res.ok) {
        if (FP.clearSession) FP.clearSession(); // any old session was revoked server-side
        el('fp-view-set').innerHTML =
          '<h2>Password updated</h2>' +
          '<p class="sub">Your password has been changed. You can now log in with it.</p>' +
          '<button class="primary" onclick="document.getElementById(\'fp-reset-modal\').style.display=\'none\';">Log in</button>';
      } else {
        setMsg2((res && res.error) || 'Could not reset your password. The link may have expired.');
      }
    } catch (e) {
      setMsg2('Could not reach the server. Please try again.');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = label; }
    }
  }

  FP.passwordReset = {
    openForgot: function () { setMsg(''); show('forgot'); },
  };

  // Auto-init: an email link lands at <site>/?reset=TOKEN.
  function init() {
    var token = new URLSearchParams(location.search).get('reset');
    if (!token) return;
    resetToken = token;
    show('set');
    // Strip the token from the URL so it isn't bookmarked or leaked via history.
    try { window.history.replaceState({}, '', location.pathname); } catch (e) { /* ignore */ }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
