(function() {
  var WEBHOOK_URL = FP.WEBHOOK_URL;
  var listEl = document.getElementById('studentList');

  function show(view) {
    document.getElementById('loginView').style.display = view === 'login' ? 'block' : 'none';
    document.getElementById('portalView').style.display = view === 'portal' ? 'block' : 'none';
  }

  function isTeacher() {
    return !!(FP.getSession && FP.getSession()) && localStorage.getItem(FP.KEYS.ROLE) === 'teacher';
  }

  function setMsg(el, text, ok) {
    el.textContent = text;
    el.className = 'auth-msg ' + (ok ? 'ok' : 'err');
    el.style.display = text ? 'block' : 'none';
  }

  // ── Login / logout ──
  window.teacherLogin = async function() {
    var email = (document.getElementById('tEmail').value || '').trim();
    var pw = document.getElementById('tPassword').value || '';
    var err = document.getElementById('tLoginError');
    setMsg(err, '');
    if (!email || !pw) { setMsg(err, 'Enter your email and password.'); return; }
    try {
      var res = await FP.api.postRead(WEBHOOK_URL + '?action=login', { email: email, password: pw });
      if (!res || !res.ok) { setMsg(err, (res && res.error) || 'Login failed.'); return; }
      if (res.role !== 'teacher') { setMsg(err, 'This is not a teacher account.'); return; }
      localStorage.setItem(FP.KEYS.SESSION, res.session);
      if (res.expires_at) localStorage.setItem(FP.KEYS.SESSION_EXP, res.expires_at);
      localStorage.setItem(FP.KEYS.ROLE, res.role);
      show('portal');
      loadStudents();
    } catch (e) {
      setMsg(err, 'Could not reach the server. Please try again.');
    }
  };

  window.teacherLogout = function() {
    var s = FP.getSession && FP.getSession();
    if (s) { try { FP.api.postRead(WEBHOOK_URL + '?action=logout', { session: s }); } catch (e) { /* ignore */ } }
    if (FP.clearSession) FP.clearSession();
    show('login');
  };

  // ── Create student account ──
  window.createStudentAccount = async function() {
    var name = (document.getElementById('caName').value || '').trim();
    var email = (document.getElementById('caEmail').value || '').trim();
    var pw = document.getElementById('caPassword').value || '';
    var st = document.getElementById('caStatus');
    setMsg(st, '');
    if (!name || !email || !pw) { setMsg(st, 'All fields are required.'); return; }
    try {
      var res = await FP.api.postRead(WEBHOOK_URL + '?action=create_account',
        { student_name: name, email: email, password: pw, role: 'student' });
      if (res && res.ok) {
        setMsg(st, 'Account created for ' + name + '.', true);
        document.getElementById('caName').value = '';
        document.getElementById('caEmail').value = '';
        document.getElementById('caPassword').value = '';
        loadStudents();
      } else {
        setMsg(st, (res && (res.error || res.message)) || 'Could not create account.');
      }
    } catch (e) {
      setMsg(st, e.message || 'Could not create account.');
    }
  };

  // ── Student picker ──
  async function loadStudents() {
    try {
      var data = await FP.api.get(WEBHOOK_URL + '?action=get_students');
      if (!data || !data.students || data.students.length === 0) {
        listEl.innerHTML = '<div class="empty-msg">No students yet.<br>Create one below, or they appear here after their first visit.</div>';
        return;
      }
      listEl.innerHTML = '';
      data.students.forEach(function(s) {
        var card = document.createElement('a');
        card.className = 'student-card';
        card.href = 'src/examiner-panel.html?student=' + encodeURIComponent(s.name);
        card.innerHTML =
          '<div class="student-name">' + escHtml(s.name) + '</div>' +
          '<span class="student-arrow">&rarr;</span>';
        listEl.appendChild(card);
      });
    } catch (e) {
      listEl.innerHTML = '<div class="empty-msg">Could not load students.<br>' + escHtml(e.message) + '</div>';
    }
  }

  // ── Init ──
  if (isTeacher()) { show('portal'); loadStudents(); }
  else { show('login'); }
})();
