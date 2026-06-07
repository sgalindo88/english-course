// ══════════════════════════════════════════════════════
// SETUP GUIDE — fill in both values below
//
// ── EMAIL (Formspree) ──────────────────────────────
// 1. Go to https://formspree.io and sign up (free)
// 2. Click "New Form" → name it "English Test Results"
// 3. Copy your endpoint (looks like https://formspree.io/f/abcdefgh)
// 4. Paste it below
//
// ── GOOGLE SHEET (Apps Script) ────────────────────
// 1. Open a new Google Sheet
// 2. Click Extensions → Apps Script
// 3. Delete any existing code and paste the script from
//    the GOOGLE_APPS_SCRIPT_CODE comment block below
// 4. Click Deploy → New deployment → Web app
//    - Execute as: Me
//    - Who has access: Anyone
// 5. Copy the Web app URL and paste it below
//
// GOOGLE_APPS_SCRIPT_CODE:
// ─────────────────────────────────────────────────
// NOTE: The test sends form-encoded data (not JSON).
// Use this Apps Script — it reads e.parameter instead of e.postData.
//
// function doPost(e) {
//   var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
//   var params = e.parameter;  // form-encoded fields land here
//   var headers = [
//     'submitted_at','candidate_name','date',
//     'reading_score','listening_score','auto_total',
//     'writing_score','speaking_score','mcq_answers',
//     'q11_passive_voice','q12_combined_sentence','q13_error_correction',
//     'q14_writing_task','q20_dictation',
//     'q21_speaking_notes','q22_speaking_notes',
//     'q23_speaking_notes','q24_speaking_notes'
//   ];
//   if (sheet.getLastRow() === 0) {
//     sheet.appendRow(headers);
//   }
//   sheet.appendRow(headers.map(function(h) { return params[h] || ''; }));
//   return ContentService
//     .createTextOutput(JSON.stringify({ result: 'success' }))
//     .setMimeType(ContentService.MimeType.JSON);
// }
// ─────────────────────────────────────────────────
// ══════════════════════════════════════════════════════
const FORMSPREE_ENDPOINT   = FP.FORMSPREE_ENDPOINT;
const GOOGLE_SHEET_WEBHOOK = FP.WEBHOOK_URL;

// ── STATE ──
const state = {
  answers: {},
  textAnswers: {},
  chosenTask: null,
  q19selected: new Set(),
  transcriptOpen: false,
  startTime: null,
  endTime: null,
  listeningPlays: 0,
  dictationPlays: 0,
};
const MAX_PLAYS = 3;

const CORRECT_ANSWERS = { q1:'B',q2:'C',q3:'C',q4:'C',q5:'B',q6:'A',q7:'C',q8:'B',q9:'B',q10:'B',q15:'B',q16:'C',q17:'C',q18:'C' };
const MCQ_MARKS = { q1:2,q2:2,q3:2,q4:2,q5:2,q6:2,q7:2,q8:2,q9:2,q10:2,q15:2,q16:2,q17:2,q18:2 };

// ── CHECKPOINT (session recovery) ──
const CKPT_KEY = 'test';
let ckptInterval = null;

function saveTestCheckpoint() {
  const screen = document.querySelector('.screen.active')?.id;
  if (!screen || screen === 'screen-cover' || screen === 'screen-results' || screen === 'screen-submitting') return;
  const textValues = {};
  ['q11','q12','q13','q14','q20','q21','q22','q23','q24'].forEach(id => {
    const el = document.getElementById(id);
    if (el) textValues[id] = el.value;
  });
  Checkpoint.save(CKPT_KEY, {
    screen,
    candidateName: document.getElementById('candidateName').value,
    candidateDate: document.getElementById('candidateDate').value,
    answers: state.answers,
    textAnswers: state.textAnswers,
    textValues,
    chosenTask: state.chosenTask,
    q19selected: [...state.q19selected],
    startTime: state.startTime ? state.startTime.toISOString() : null,
    listeningPlays: state.listeningPlays,
    dictationPlays: state.dictationPlays,
  });
}

function startTestAutoSave() {
  if (ckptInterval) return;
  saveTestCheckpoint();
  ckptInterval = setInterval(saveTestCheckpoint, 5000);
}

function clearTestCheckpoint() {
  if (ckptInterval) { clearInterval(ckptInterval); ckptInterval = null; }
  Checkpoint.clear(CKPT_KEY);
}

function tryResumeTest() {
  const data = Checkpoint.load(CKPT_KEY);
  if (!data || !data.screen) return;
  Checkpoint.showRecoveryModal({
    title: 'Resume Your Test?',
    titleEs: '¿Continuar tu Prueba?',
    message: 'You have an unfinished test. Would you like to pick up where you left off?',
    messageEs: 'Tienes una prueba sin terminar. ¿Quieres continuar donde lo dejaste?',
    savedAt: data._savedAt,
    onResume: function() {
      testInProgress = true;
      document.getElementById('candidateName').value = data.candidateName || '';
      document.getElementById('candidateDate').value = data.candidateDate || '';
      state.answers = data.answers || {};
      state.textAnswers = data.textAnswers || {};
      state.chosenTask = data.chosenTask || null;
      state.q19selected = new Set(data.q19selected || []);
      state.startTime = data.startTime ? new Date(data.startTime) : new Date();
      state.listeningPlays = data.listeningPlays || 0;
      state.dictationPlays = data.dictationPlays || 0;
      // Restore textarea values
      if (data.textValues) {
        Object.entries(data.textValues).forEach(function(pair) {
          var el = document.getElementById(pair[0]);
          if (el) el.value = pair[1];
        });
      }
      // Restore task choice visual
      if (data.chosenTask) chooseTask(data.chosenTask);
      // Restore audio play counts display
      var playsLeft = MAX_PLAYS - state.listeningPlays;
      document.getElementById('audioPlaysLeft').textContent = playsLeft > 0 ? playsLeft + ' plays left' : 'No plays left';
      var dPlays = MAX_PLAYS - state.dictationPlays;
      document.getElementById('dictPlaysLeft').textContent = dPlays > 0 ? dPlays + ' plays left' : 'No plays left';
      showScreen(data.screen);
      startTestAutoSave();
    },
    onStartOver: function() {
      clearTestCheckpoint();
    }
  });
}

// ── SCREEN MANAGEMENT ──
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  updateNav(id);
  updateProgress(id);
  if (ckptInterval) saveTestCheckpoint();
  // Focus management: move focus to first interactive element in new screen
  setTimeout(function() {
    var screen = document.getElementById(id);
    if (!screen) return;
    var target = screen.querySelector('button:not(:disabled), textarea, input, [tabindex="0"]');
    if (target) target.focus();
  }, 100);
}

function updateNav(id) {
  const labels = {
    'screen-cover': 'General Placement',
    'screen-reading-intro': 'Part 01 · Reading',
    'screen-reading': 'Part 01 · Reading',
    'screen-writing-intro': 'Part 02 · Writing',
    'screen-writing': 'Part 02 · Writing',
    'screen-listening-intro': 'Part 03 · Listening',
    'screen-listening': 'Part 03 · Listening',
    'screen-speaking-intro': 'Part 04 · Speaking',
    'screen-speaking': 'Part 04 · Speaking',
    'screen-results': 'Results',
  };
  document.getElementById('navSection').textContent = labels[id] || '';
}

const screenOrder = ['screen-cover','screen-reading-intro','screen-reading','screen-writing-intro','screen-writing','screen-listening-intro','screen-listening','screen-speaking-intro','screen-speaking','screen-results'];

function updateProgress(id) {
  const idx = screenOrder.indexOf(id);
  const pct = idx < 0 ? 0 : Math.round((idx / (screenOrder.length - 1)) * 100);
  document.getElementById('progressBar').style.width = pct + '%';
}

// ── beforeunload — warn when test is in progress ──
var testInProgress = false;
function onBeforeUnload(e) { if (testInProgress) { e.preventDefault(); } }
window.addEventListener('beforeunload', onBeforeUnload);

// ── START ──
function startTest() {
  const nameEl = document.getElementById('candidateName');
  const dateEl = document.getElementById('candidateDate');
  if (!nameEl.value.trim()) {
    nameEl.style.borderColor = 'var(--rust)';
    nameEl.focus();
    nameEl.placeholder = 'Name is required *';
    return;
  }
  if (!dateEl.value) {
    dateEl.style.borderColor = 'var(--rust)';
    dateEl.focus();
    return;
  }
  nameEl.style.borderColor = '';
  dateEl.style.borderColor = '';
  if (!dateEl.value) dateEl.value = new Date().toISOString().split('T')[0];
  testInProgress = true;
  state.startTime = new Date();
  showScreen('screen-reading-intro');
  startTestAutoSave();
}

// ── MCQ ──
function selectMCQ(qId, letter, isCorrect) {
  if (state.answers[qId]) return; // already answered
  state.answers[qId] = { selected: letter, correct: isCorrect };

  const card = document.getElementById(qId + '-card') || document.querySelector(`[id^="${qId}"]`)?.closest('.question-card');
  const btns = document.querySelectorAll(`[onclick*="'${qId}'"]`);

  btns.forEach(btn => {
    btn.disabled = true;
    const btnLetter = btn.querySelector('.opt-letter').textContent.trim();
    const correctLetter = CORRECT_ANSWERS[qId];
    if (btnLetter === correctLetter) btn.classList.add('correct');
    else if (btnLetter === letter && !isCorrect) btn.classList.add('wrong');
  });

  const fb = document.getElementById(qId + '-fb');
  if (fb) {
    fb.setAttribute('aria-live', 'polite');
    fb.classList.add('show');
    if (isCorrect) {
      fb.classList.add('correct-fb');
      fb.textContent = '✓ Correct! +' + (MCQ_MARKS[qId] || 2) + ' marks';
    } else {
      fb.classList.add('wrong-fb');
      fb.textContent = '✗ Incorrect. The correct answer is ' + CORRECT_ANSWERS[qId] + '.';
    }
  }
  updateScoreDisplay();
}

// ── MULTI-SELECT Q19 ──
const Q19_CORRECT = new Set(['B','C']);
function toggleMulti(qId, letter) {
  if (state.answers[qId + '_submitted']) return;
  const btn = document.getElementById(qId + '-' + letter);
  if (state.q19selected.has(letter)) {
    state.q19selected.delete(letter);
    btn.classList.remove('selected');
  } else {
    state.q19selected.add(letter);
    btn.classList.add('selected');
  }
  // Auto-submit when 2 selected
  if (state.q19selected.size >= 2) submitQ19();
}

function submitQ19() {
  state.answers['q19_submitted'] = true;
  const correct = [...state.q19selected].every(l => Q19_CORRECT.has(l)) && state.q19selected.size === 2;
  const partialCorrect = [...state.q19selected].filter(l => Q19_CORRECT.has(l)).length;

  document.querySelectorAll('[id^="q19-"]').forEach(btn => {
    if (!btn.classList.contains('q-feedback') && btn.tagName === 'BUTTON') {
      btn.disabled = true;
      const letter = btn.id.replace('q19-','');
      if (Q19_CORRECT.has(letter)) btn.classList.add('correct');
      else if (state.q19selected.has(letter)) btn.classList.add('wrong');
    }
  });

  const fb = document.getElementById('q19-fb');
  fb.setAttribute('aria-live', 'polite');
  fb.classList.add('show');
  if (correct) {
    fb.classList.add('correct-fb');
    fb.textContent = '✓ Correct! Both answers found. +2 marks';
    state.answers['q19'] = { correct: true, marks: 2 };
  } else {
    fb.classList.add(partialCorrect > 0 ? 'info-fb' : 'wrong-fb');
    fb.textContent = partialCorrect > 0 ? `Partially correct. ${partialCorrect}/2 correct answers selected. +${partialCorrect} mark${partialCorrect>1?'s':''}.` : '✗ Neither answer was correct. Correct answers: Reception and the Website.';
    state.answers['q19'] = { correct: false, marks: partialCorrect };
  }
  updateScoreDisplay();
}

// ── TEXT ANSWERS ──
function saveText(qId) {
  state.textAnswers[qId] = document.getElementById(qId).value;
}

function toggleSkipQ(checkbox, qId) {
  var el = document.getElementById(qId);
  if (checkbox.checked) {
    el.required = false;
    el.disabled = true;
    el.style.opacity = '0.4';
    state.textAnswers[qId] = '[SKIPPED]';
  } else {
    el.required = true;
    el.disabled = false;
    el.style.opacity = '';
    state.textAnswers[qId] = el.value;
  }
}

function updateWordCount() {
  const text = document.getElementById('q14').value.trim();
  const words = text ? text.split(/\s+/).length : 0;
  const wc = document.getElementById('wordCount');
  wc.textContent = words + ' words';
  wc.style.color = (words >= 120 && words <= 150) ? 'var(--green)' : words > 150 ? 'var(--rust)' : 'var(--muted)';
  saveText('q14');
}

function chooseTask(opt) {
  state.chosenTask = opt;
  document.getElementById('taskA').classList.toggle('chosen', opt === 'A');
  document.getElementById('taskB').classList.toggle('chosen', opt === 'B');
  document.getElementById('q14').placeholder = opt === 'A'
    ? 'Write your informal email here (120–150 words)…'
    : 'Write your opinion paragraph here (120–150 words)…';
}

// ── SCORE DISPLAY ──
function getMCQScore() {
  let total = 0;
  Object.keys(CORRECT_ANSWERS).forEach(qId => {
    if (state.answers[qId]?.correct) total += (MCQ_MARKS[qId] || 2);
  });
  if (state.answers['q19']) total += state.answers['q19'].marks || 0;
  return total;
}

function updateScoreDisplay() {
  // Live score intentionally hidden from candidate
}

// ── SECTION FINISH ──
function finishReading() {
  showScreen('screen-writing-intro');
}

// ── AUDIO: Text-to-Speech ──
const LISTENING_TEXT = "Hello, and welcome to the Westfield Community Centre. My name is Diane, and I am the programme coordinator. I would like to let you know about a few changes this month. First, the yoga class on Wednesday evenings has moved to Thursday at seven p.m. Second, the swimming pool will be closed for maintenance from the fourteenth to the twentieth of this month. If you have any questions, please speak to reception or visit our website. Thank you, and have a great day.";
const DICTATION_TEXT = "Although the weather was unpredictable, they decided to go ahead with the outdoor festival.";

// ── SPEAKING: Speech Recognition for Q21-Q24 ──
var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
var speakingRecorders = {}; // { q21: { recognition, recording, transcript } }

function toggleSpeakingRec(qId) {
  if (!SpeechRecognition) {
    alert('Speech recognition is not available in this browser. Please use Chrome.');
    return;
  }
  if (!speakingRecorders[qId]) {
    speakingRecorders[qId] = { recognition: null, recording: false, transcript: '' };
  }
  var rec = speakingRecorders[qId];
  var btn = document.getElementById('rec-btn-' + qId);
  var statusEl = document.getElementById('rec-status-' + qId);
  var transcriptEl = document.getElementById('rec-transcript-' + qId);

  if (rec.recording) {
    // Stop recording
    rec.recording = false;
    if (rec.recognition) rec.recognition.stop();
    btn.textContent = '🎤 Record again';
    btn.style.background = 'var(--ink)';
    statusEl.style.display = 'block';
    statusEl.textContent = 'Recording stopped.';
    // Save transcript as the speaking answer
    state.textAnswers[qId + '_transcript'] = rec.transcript;
  } else {
    // Start recording
    rec.transcript = '';
    rec.recording = true;
    btn.textContent = '■ Stop Recording';
    btn.style.background = 'var(--rust)';
    statusEl.style.display = 'block';
    statusEl.textContent = 'Listening… speak now.';
    transcriptEl.style.display = 'block';
    transcriptEl.textContent = '…';

    var recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = function(event) {
      var text = '';
      for (var i = 0; i < event.results.length; i++) {
        text += event.results[i][0].transcript;
      }
      rec.transcript = text;
      transcriptEl.textContent = text || '…';
    };

    recognition.onerror = function(e) {
      if (e.error !== 'aborted') {
        statusEl.textContent = 'Error: ' + e.error;
      }
    };

    recognition.onend = function() {
      if (rec.recording) {
        // Restart if ended unexpectedly while still recording
        try { recognition.start(); } catch(e) {}
      }
    };

    rec.recognition = recognition;
    recognition.start();
  }
}

function speakText(text, onEnd) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance(text);
  utt.rate = 0.88;
  utt.pitch = 1;
  utt.lang = 'en-GB';
  // Pick a natural English voice if available
  const voices = window.speechSynthesis.getVoices();
  const preferred = voices.find(v => v.lang.startsWith('en') && v.name.toLowerCase().includes('female'))
    || voices.find(v => v.lang.startsWith('en-GB'))
    || voices.find(v => v.lang.startsWith('en'));
  if (preferred) utt.voice = preferred;
  if (onEnd) utt.onend = onEnd;
  window.speechSynthesis.speak(utt);
}

// ── Listening audio with stop button and play-time tracking ──
let listeningPlayStart = null;
let listeningTotalTime = 0;
let dictationPlayStart = null;
let dictationTotalTime = 0;

function playListeningAudio() {
  if (state.listeningPlays >= MAX_PLAYS) return;
  state.listeningPlays++;
  var left = MAX_PLAYS - state.listeningPlays;
  document.getElementById('audioPlaysLeft').textContent = left === 0 ? 'No plays left' : left + ' play' + (left === 1 ? '' : 's') + ' left';
  document.getElementById('audioStatus').textContent = 'Playing…';
  document.getElementById('playBtn').style.display = 'none';
  document.getElementById('stopBtn').style.display = 'flex';
  listeningPlayStart = Date.now();
  if (left === 0) {
    document.getElementById('listeningAudioBox').style.opacity = '0.7';
  }
  speakText(LISTENING_TEXT, function() {
    finishListeningPlay(left);
  });
}

function stopListeningAudio() {
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  var left = MAX_PLAYS - state.listeningPlays;
  finishListeningPlay(left);
}

function finishListeningPlay(left) {
  if (listeningPlayStart) {
    listeningTotalTime += Date.now() - listeningPlayStart;
    listeningPlayStart = null;
  }
  document.getElementById('stopBtn').style.display = 'none';
  document.getElementById('playBtn').style.display = 'flex';
  document.getElementById('audioStatus').textContent = left > 0 ? 'Click to listen again' : 'No more plays available';
  var ptEl = document.getElementById('audioPlayTime');
  ptEl.style.display = 'inline';
  ptEl.textContent = ' · ' + formatPlayTime(listeningTotalTime);
  if (left === 0) {
    document.getElementById('playBtn').style.opacity = '0.4';
    document.getElementById('playBtn').style.cursor = 'default';
  }
}

function playDictationAudio() {
  if (state.dictationPlays >= MAX_PLAYS) return;
  state.dictationPlays++;
  var left = MAX_PLAYS - state.dictationPlays;
  document.getElementById('dictPlaysLeft').textContent = left === 0 ? 'No plays left' : left + ' play' + (left === 1 ? '' : 's') + ' left';
  document.getElementById('dictAudioStatus').textContent = 'Playing…';
  document.getElementById('dictPlayBtn').style.display = 'none';
  document.getElementById('dictStopBtn').style.display = 'flex';
  dictationPlayStart = Date.now();
  if (left === 0) {
    document.getElementById('dictationAudioBox').style.opacity = '0.7';
  }
  speakText(DICTATION_TEXT, function() {
    finishDictationPlay(left);
  });
}

function stopDictationAudio() {
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  var left = MAX_PLAYS - state.dictationPlays;
  finishDictationPlay(left);
}

function finishDictationPlay(left) {
  if (dictationPlayStart) {
    dictationTotalTime += Date.now() - dictationPlayStart;
    dictationPlayStart = null;
  }
  document.getElementById('dictStopBtn').style.display = 'none';
  document.getElementById('dictPlayBtn').style.display = 'flex';
  document.getElementById('dictAudioStatus').textContent = left > 0 ? 'Click to hear again' : 'No more plays available';
  var ptEl = document.getElementById('dictPlayTime');
  ptEl.style.display = 'inline';
  ptEl.textContent = ' · ' + formatPlayTime(dictationTotalTime);
  if (left === 0) {
    document.getElementById('dictPlayBtn').style.opacity = '0.4';
    document.getElementById('dictPlayBtn').style.cursor = 'default';
  }
}

// Preload voices on page load
if (window.speechSynthesis) {
  window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
}

// ── FINAL RESULTS — auto-submit ──
async function finishTest() {
  testInProgress = false;
  state.endTime = new Date();
  showScreen('screen-submitting');
  await submitResults();
}

function showResultsScreen(submissionOk, submissionMsg) {
  clearTestCheckpoint();
  // Time summary
  const duration = state.endTime && state.startTime ? state.endTime - state.startTime : null;
  const timeSummary = document.getElementById('timeSummary');
  timeSummary.innerHTML = [
    { label: 'Started', value: state.startTime ? state.startTime.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : '—' },
    { label: 'Finished', value: state.endTime ? state.endTime.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : '—' },
    { label: 'Duration', value: duration ? formatDuration(duration) : '—' },
  ].map(item => `<div><div style="font-size:9px;letter-spacing:0.25em;text-transform:uppercase;color:var(--muted);font-weight:600;margin-bottom:4px;">${item.label}</div><div style="font-family:'Playfair Display',serif;font-size:22px;font-weight:700;color:var(--ink);">${item.value}</div></div>`).join('');

  // Submission banner
  const banner = document.getElementById('submissionBanner');
  if (submissionOk) {
    banner.style.display = 'block';
    banner.textContent = '✓ ' + submissionMsg;
  } else {
    banner.style.borderColor = 'var(--rust)';
    banner.style.background = '#fdecea';
    banner.style.color = 'var(--rust)';
    banner.style.display = 'block';
    banner.textContent = submissionMsg;
  }

  // Save progress to localStorage so the hub page can track status
  try {
    localStorage.setItem('fp_student_name', document.getElementById('candidateName').value.trim());
    localStorage.setItem('fp_test_completed', 'true');
    localStorage.setItem('fp_test_date', document.getElementById('candidateDate').value);
    localStorage.setItem('fp_test_submitted_at', new Date().toISOString());
  } catch(e) { /* localStorage unavailable */ }

  showScreen('screen-results');
}

// ── DUAL SUBMISSION (Email + Google Sheet) ──
async function submitResults() {
  FP.showSaveOverlay('Submitting your test results…');

  const missingFormspree = FORMSPREE_ENDPOINT.includes('YOUR_FORM_ID_HERE');
  const missingSheet     = GOOGLE_SHEET_WEBHOOK.includes('YOUR_SCRIPT_ID_HERE');

  // Build payload
  const mcqDetail = Object.keys(CORRECT_ANSWERS).map(q => {
    const ans = state.answers[q];
    return `${q.toUpperCase()}: ${ans ? ans.selected + (ans.correct ? ' ✓' : ' ✗ (correct: ' + CORRECT_ANSWERS[q] + ')') : 'Not answered'}`;
  }).join('\n');
  const q19ans    = state.answers['q19'];
  const q19detail = q19ans ? `Q19: ${[...state.q19selected].join(',')} — ${q19ans.marks}/2 marks` : 'Q19: Not answered';

  let readingScore = 0;
  ['q1','q2','q3','q4','q5','q6','q7','q8','q9','q10'].forEach(q => { if (state.answers[q]?.correct) readingScore += 2; });
  let listeningScore = 0;
  ['q15','q16','q17','q18'].forEach(q => { if (state.answers[q]?.correct) listeningScore += 2; });
  if (q19ans) listeningScore += q19ans.marks || 0;

  const duration = state.endTime && state.startTime
    ? formatDuration(state.endTime - state.startTime)
    : 'unknown';

  const payload = {
    submitted_at:           new Date().toLocaleString(),
    candidate_name:         document.getElementById('candidateName').value || '(not provided)',
    test_date:              document.getElementById('candidateDate').value || '',
    start_time:             state.startTime ? state.startTime.toLocaleTimeString() : '',
    end_time:               state.endTime   ? state.endTime.toLocaleTimeString()   : '',
    duration:               duration,
    reading_score:          `${readingScore} / 20`,
    listening_score:        `${listeningScore} / 15`,
    auto_total:             `${readingScore + listeningScore} / 30`,
    writing_score:          'Pending examiner review (/ 25)',
    speaking_score:         'Pending examiner review (/ 20)',
    mcq_answers:            mcqDetail + '\n' + q19detail,
    q11_passive_voice:      state.textAnswers['q11'] || '(blank)',
    q12_combined_sentence:  state.textAnswers['q12'] || '(blank)',
    q13_error_correction:   state.textAnswers['q13'] || '(blank)',
    q14_writing_task:       `[Option ${state.chosenTask || '?'}] ${state.textAnswers['q14'] || '(blank)'}`,
    q20_dictation:          state.textAnswers['q20'] || '(blank)',
    q21_speaking_notes:     state.textAnswers['q21'] || '(blank)',
    q22_speaking_notes:     state.textAnswers['q22'] || '(blank)',
    q23_speaking_notes:     state.textAnswers['q23'] || '(blank)',
    q24_speaking_notes:     state.textAnswers['q24'] || '(blank)',
  };

  const results = { email: 'skipped', sheet: 'skipped' };

  // ── Formspree (email) ──
  if (!missingFormspree) {
    try {
      await FP.api.postJson(FORMSPREE_ENDPOINT, payload);
      results.email = 'ok';
    } catch { results.email = 'error'; }
  }

  // ── Google Sheet (form-encoded + no-cors — required for Apps Script) ──
  if (!missingSheet) {
    try {
      await FP.api.postForm(GOOGLE_SHEET_WEBHOOK, payload);
      results.sheet = 'ok';
    } catch { results.sheet = 'error'; }
  }

  // ── Determine outcome message then show results screen ──
  const anyOk = results.email === 'ok' || results.sheet === 'ok';
  const allOk = (missingFormspree || results.email === 'ok') && (missingSheet || results.sheet === 'ok');
  const bothUnconfigured = missingFormspree && missingSheet;

  let ok, msg;
  if (bothUnconfigured) {
    ok = false;
    msg = '⚠️ Submission endpoints not configured. Please ask your examiner to set up the test.';
  } else if (allOk && anyOk) {
    const parts = [];
    if (results.email === 'ok') parts.push('emailed to your examiner');
    if (results.sheet === 'ok') parts.push('saved to the examiner\'s Google Sheet');
    ok = true;
    msg = 'Your results have been ' + parts.join(' and ') + '.';
  } else if (anyOk) {
    ok = true;
    msg = 'Results partially submitted. Your examiner has been notified.';
  } else {
    ok = false;
    msg = '⚠️ Submission failed due to a network error. Please inform your examiner directly.';
  }

  FP.hideSaveOverlay();
  showResultsScreen(ok, msg);
}

function restartTest() {
  testInProgress = false;
  clearTestCheckpoint();
  // Reset state
  state.answers = {};
  state.textAnswers = {};
  state.chosenTask = null;
  state.q19selected = new Set();
  state.transcriptOpen = false;
  state.startTime = null;
  state.endTime = null;
  state.listeningPlays = 0;
  state.dictationPlays = 0;

  // Reset all MCQ buttons
  document.querySelectorAll('.option-btn').forEach(btn => {
    btn.disabled = false;
    btn.classList.remove('selected','correct','wrong');
  });

  // Reset all feedbacks
  document.querySelectorAll('.q-feedback').forEach(fb => {
    fb.className = 'q-feedback';
    fb.textContent = '';
  });

  // Reset text inputs
  document.querySelectorAll('.text-input-area').forEach(el => el.value = '');
  document.getElementById('wordCount').textContent = '0 words';

  // Reset task choice
  document.getElementById('taskA').classList.remove('chosen');
  document.getElementById('taskB').classList.remove('chosen');

  // Reset audio players
  document.getElementById('audioStatus').textContent = 'Press play to listen — you may play this up to 3 times';
  document.getElementById('playBtn').textContent = '▶';
  document.getElementById('audioPlaysLeft').textContent = '3 plays left';
  document.getElementById('listeningAudioBox').style.opacity = '';
  document.getElementById('listeningAudioBox').style.cursor = '';
  document.getElementById('dictAudioStatus').textContent = 'Press play to hear the sentence';
  document.getElementById('dictPlayBtn').textContent = '▶';
  document.getElementById('dictPlaysLeft').textContent = '3 plays left';
  document.getElementById('dictationAudioBox').style.opacity = '';
  document.getElementById('dictationAudioBox').style.cursor = '';
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  // Reset submission banner
  const banner = document.getElementById('submissionBanner');
  if (banner) { banner.style.display = 'none'; banner.textContent = ''; }

  // Reset nav score
  document.getElementById('navScore').textContent = '';

  showScreen('screen-cover');
}

// Set today's date on load
window.addEventListener('DOMContentLoaded', () => {
  // Session guard — the placement test requires a logged-in student (free, not public).
  if (FP.getSession && !FP.getSession()) { FP.redirectToLogin(); return; }

  document.getElementById('candidateDate').value = new Date().toISOString().split('T')[0];

  // Auto-fill name from hub (localStorage)
  var nameField = document.getElementById('candidateName');
  var savedName = localStorage.getItem('fp_student_name');
  if (savedName) nameField.value = savedName;

  tryResumeTest();

  // Initialize video call request button (re-init when student enters name)
  function initCallRequest() {
    if (typeof CallRequest !== 'undefined') CallRequest.init({ page: 'test' });
  }
  initCallRequest();
  nameField.addEventListener('blur', initCallRequest);
});
