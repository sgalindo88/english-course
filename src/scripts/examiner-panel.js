// ══════════════════════════════════════════════════════
// WEBHOOK (hardcoded — same URL used across the platform)
// ══════════════════════════════════════════════════════
const WEBHOOK_URL = FP.WEBHOOK_URL;

// ══════════════════════════════════════════════════════
// STATE
// ══════════════════════════════════════════════════════
let ex = {
  teacherName: 'Sebastian Galindo',
  studentName: '',
  studentLevel: 'B1',
  studentMonth: 1,
  studentEmail: '',
  studentNotes: '',
  allowSpanish: false,
  allowSkipTest: false,
  allowRetakeTest: false,
  grantAccess: false,   // comp the paid course (Settings.access_granted)
  webhook: '',
  attendance: {},       // { 'day-1': 'present'|'absent', ... }
  markingData: null,    // loaded submission
  writingScores: {},
  speakingScores: {},
  weeklySummaries: {},  // { 1: {...}, 2: {...}, ... }
  difficultyProfile: {},
  focusTags: new Set(),
  lessonRecords: [],
  aiInstructions: '',
  pendingLessons: [],
  currentWeek: 1,
  ptGraded: null,       // saved placement test grading state (sliders, notes, scores)
  teacherEmail: '',
  notifyOnTest: false,
  notifyOnSubmission: false,
  notifyOnCallRequest: true,
};

const FOCUS_OPTIONS = [
  'Vocabulary', 'Pronunciation', 'Grammar', 'Speaking fluency',
  'Writing', 'Listening', 'Workplace English', 'Medical vocabulary',
  'Phrasal verbs', 'Idioms', 'Formal writing', 'Casual conversation',
  'Numbers & money', 'Reading speed',
];

const DIFF_AREAS = [
  { key: 'vocabulary_density', label: 'Vocabulary density', min: 1, max: 5, default: 3, desc: 'Number of new words per lesson' },
  { key: 'sentence_complexity', label: 'Sentence complexity', min: 1, max: 5, default: 3, desc: 'Length and structure of example sentences' },
  { key: 'speaking_duration', label: 'Speaking task length', min: 1, max: 5, default: 3, desc: 'How long the speaking prompts are' },
  { key: 'writing_length', label: 'Writing requirement', min: 1, max: 5, default: 3, desc: 'Minimum word count for writing tasks' },
  { key: 'listening_speed', label: 'Listening speed', min: 1, max: 5, default: 3, desc: 'Pace of the listening audio texts' },
  { key: 'grammar_complexity', label: 'Grammar complexity', min: 1, max: 5, default: 3, desc: 'Grammatical structures introduced' },
];

// ══════════════════════════════════════════════════════
// SETUP
// ══════════════════════════════════════════════════════

/** Reset all student-specific state when switching students. Preserves teacher-level settings. */
function resetStudentState(newStudentName) {
  ex.studentName = newStudentName;
  ex.studentLevel = 'B1';
  ex.studentMonth = 1;
  ex.studentEmail = '';
  ex.studentNotes = '';
  ex.allowSpanish = false;
  ex.allowSkipTest = false;
  ex.allowRetakeTest = false;
  ex.grantAccess = false;
  ex.attendance = {};
  ex.markingData = null;
  ex.writingScores = {};
  ex.speakingScores = {};
  ex.weeklySummaries = {};
  ex.difficultyProfile = {};
  ex.focusTags = new Set();
  ex.lessonRecords = [];
  ex.aiInstructions = '';
  ex.pendingLessons = [];
  ex.currentWeek = 1;
  ex.ptGraded = null;
  // Clear per-student note fields from localStorage
  ['today_notes', 'absence_notes', 'writing_feedback', 'speaking_feedback', 'overall_feedback', 'ai_instructions'].forEach(function(k) {
    try { localStorage.removeItem('fp_' + k); } catch(e) {}
  });
}

function setupExaminer() {
  var student = document.getElementById('setup-student').value.trim();
  if (!student) { alert('Please enter the student\'s name.'); return; }

  ex.studentName  = student;
  saveToLocalStorage();
  initApp();
}

// ══════════════════════════════════════════════════════
// PLACEMENT TEST MARKING
// ══════════════════════════════════════════════════════
const PT_READING_CORRECT   = { q1:'B', q2:'C', q3:'C', q4:'C', q5:'B', q6:'A', q7:'C', q8:'B', q9:'B', q10:'B' };
const PT_LISTENING_CORRECT = { q15:'B', q16:'C', q17:'C', q18:'C' };
const PT_Q19_CORRECT = new Set(['B','C']);
const PT_CEFR_BANDS = [
  { level:'A1', min:0, max:10, desc:'Beginner' },
  { level:'A2', min:11, max:20, desc:'Elementary' },
  { level:'B1', min:21, max:35, desc:'Intermediate' },
  { level:'B2', min:36, max:50, desc:'Upper-Intermediate' },
  { level:'C1', min:51, max:65, desc:'Advanced' },
  { level:'C2', min:66, max:80, desc:'Proficiency' },
];
const ptScores = { reading:{}, listening:{}, q20:0, q11:0, q12:0, q13:0, q14:0, q21:0, q22:0, q23:0, q24:0 };

function ptGetCEFR(n) {
  for (const b of PT_CEFR_BANDS) if (n >= b.min && n <= b.max) return b.level;
  return n >= 66 ? 'C2' : '—';
}
function ptComputeReading()   { return Object.values(ptScores.reading).reduce((a,b) => a+b, 0); }
function ptComputeListening() { return Math.min(['q15','q16','q17','q18','q19'].reduce((a,q) => a+(ptScores.listening[q]||0), 0) + (ptScores.q20||0), 15); }
function ptComputeWriting()   { return (ptScores.q11||0)+(ptScores.q12||0)+(ptScores.q13||0)+(ptScores.q14||0); }
function ptComputeSpeaking()  { return (ptScores.q21||0)+(ptScores.q22||0)+(ptScores.q23||0)+(ptScores.q24||0); }

var _ptSaveTimer = null;
var _ptRestoring = false;
function updatePTResults() {
  const r = ptComputeReading(), l = ptComputeListening(), w = ptComputeWriting(), s = ptComputeSpeaking();
  const total = r + l + w + s;
  const cefr = ptGetCEFR(total);
  document.getElementById('pt-reading-score').innerHTML = r + ' <span>/ 20</span>';
  document.getElementById('pt-listening-score').innerHTML = l + ' <span>/ 15</span>';
  document.getElementById('pt-writing-score').innerHTML = w + ' <span>/ 25</span>';
  document.getElementById('pt-speaking-score').innerHTML = s + ' <span>/ 20</span>';
  document.getElementById('pt-res-total').innerHTML = total + ' <span style="font-size:18px;color:var(--muted);">/ ' + FP.TEST_TOTAL_MARKS + '</span>';
  document.getElementById('pt-res-cefr').textContent = cefr;
  document.getElementById('pt-res-reading').innerHTML = r + ' <span style="font-size:13px;color:var(--muted);">/ 20</span>';
  document.getElementById('pt-res-writing').innerHTML = w + ' <span style="font-size:13px;color:var(--muted);">/ 25</span>';
  document.getElementById('pt-res-listening').innerHTML = l + ' <span style="font-size:13px;color:var(--muted);">/ 15</span>';
  document.getElementById('pt-res-speaking').innerHTML = s + ' <span style="font-size:13px;color:var(--muted);">/ 20</span>';

  // Debounced save of graded state (notes trigger this on every keystroke)
  clearTimeout(_ptSaveTimer);
  _ptSaveTimer = setTimeout(function() { savePTGradedState(); }, 2000);
}

function resetPTGradingData() {
  if (!confirm('Reset all placement test grading data? Slider scores, notes, and feedback will be cleared.')) return;
  ex.ptGraded = null;
  // Reset ptScores
  ['q11','q12','q13','q14','q20','q21','q22','q23','q24'].forEach(function(q) { ptScores[q] = 0; });
  // Reset sliders and displays
  ['q11','q12','q13','q20','q21','q22','q23','q24'].forEach(function(q) {
    var slider = document.getElementById('pt-slider-' + q);
    var disp = document.getElementById('pt-disp-' + q);
    if (slider) slider.value = 0;
    if (disp) disp.innerHTML = '0 <span>/ ' + (slider ? slider.max : 5) + '</span>';
  });
  // Reset Q14 sub-criteria
  ['task','grammar','vocab','coherence'].forEach(function(f) {
    var el = document.getElementById('pt-sc-' + f);
    if (el) el.value = 0;
    var disp = document.getElementById('pt-scv-' + f);
    if (disp) disp.textContent = '0';
  });
  // Reset notes and feedback
  ['q11','q12','q13','q14','q21','q22','q23','q24'].forEach(function(q) {
    var el = document.getElementById('pt-notes-' + q);
    if (el) el.value = '';
  });
  var fb = document.getElementById('pt-overall-feedback');
  if (fb) fb.value = '';
  updatePTResults();
  saveToLocalStorage();
  document.getElementById('pt-load-status').textContent = 'Grading data has been reset.';
}

function updatePTSlider(q, max) {
  var slider = document.getElementById('pt-slider-' + q);
  var disp = document.getElementById('pt-disp-' + q);
  if (!slider || !disp) return;
  var v = parseFloat(slider.value);
  disp.innerHTML = v + ' <span>/ ' + max + '</span>';
  ptScores[q] = v;
  updatePTResults();
  if (!_ptRestoring) savePTGradedState();
}

function updatePTSubCriteria() {
  let total = 0;
  ['task','grammar','vocab','coherence'].forEach(f => {
    const v = parseFloat(document.getElementById('pt-sc-' + f).value);
    document.getElementById('pt-scv-' + f).textContent = v;
    total += v;
  });
  total = Math.min(total, 10);
  document.getElementById('pt-sct-q14').textContent = total + ' / 10';
  ptScores.q14 = total;
  updatePTResults();
  if (!_ptRestoring) savePTGradedState();
}

function buildPTChip(qId, submitted, correct, marks) {
  const isCorrect = submitted && submitted.toUpperCase() === correct.toUpperCase();
  const bg = !submitted ? 'var(--cream)' : isCorrect ? 'var(--green-bg)' : '#fdecea';
  const border = !submitted ? 'var(--rule)' : isCorrect ? 'var(--green)' : 'var(--rust)';
  const icon = !submitted ? '○' : isCorrect ? '✓' : '✗';
  const color = !submitted ? 'var(--muted)' : isCorrect ? 'var(--green)' : 'var(--rust)';
  return '<div style="display:flex;align-items:center;gap:6px;padding:6px 12px;background:' + bg + ';border:1px solid ' + border + ';font-size:12px;border-radius:3px;">' +
    '<span style="color:' + color + ';font-weight:600;">' + icon + '</span> ' +
    '<span style="font-weight:600;">' + qId.toUpperCase() + '</span> ' +
    (submitted ? submitted.toUpperCase() : '—') +
    (isCorrect ? ' <span style="color:var(--green);font-size:11px;">' + marks + '/' + marks + '</span>' : '') +
    (!submitted ? '' : !isCorrect ? ' <span style="color:var(--rust);font-size:11px;">0/' + marks + '</span>' : '') +
    '</div>';
}

async function loadPlacementTest() {
  const name = ex.studentName;
  if (!name) { document.getElementById('pt-load-status').textContent = 'Set up a student profile first.'; return; }

  document.getElementById('pt-load-status').textContent = 'Loading test data for ' + escHtml(name) + '...';

  // Try fetching from Google Sheets
  let data = null;
  if (WEBHOOK_URL && WEBHOOK_URL.includes('script.google.com')) {
    try {
      const url = WEBHOOK_URL + '?action=get_test_results&student=' + encodeURIComponent(name);
      data = await FP.api.get(url);
    } catch (e) {
      console.warn('[FluentPath] Could not fetch test results (CORS or network error). Using demo data.', e.message);
    }
  }

  // If no data from sheet, use demo data
  if (!data || !data.found) {
    data = {
      found: true,
      candidate_name: name,
      test_date: new Date().toISOString().split('T')[0],
      mcq_answers: 'Q1: B ✓ Q2: C ✓ Q3: A ✗ (correct: C) Q4: C ✓ Q5: B ✓ Q6: A ✓ Q7: C ✓ Q8: B ✓ Q9: B ✓ Q10: B ✓ Q15: B ✓ Q16: C ✓ Q17: A ✗ (correct: C) Q18: C ✓ Q19: B,C — 2/2 marks',
      q11_passive_voice: 'The meal was prepared by the chef in less than ten minutes.',
      q12_combined_sentence: 'Although it was raining, we decided to go for a walk.',
      q13_error_correction: 'She does not have any money to buy a new phone.',
      q14_writing_task: 'Dear Maria, I am writing to invite you to my birthday party next Saturday...',
      q20_dictation: 'The university library will be closed for renovations during the summer months.',
      q21_speaking_notes: 'My name is... I come from... I have been studying English for...',
      q22_speaking_notes: 'I like to cook in my free time. My favourite dish is...',
      q23_speaking_notes: 'I believe technology has changed education significantly...',
      q24_speaking_notes: 'In my opinion, learning a second language is essential because...',
    };
    document.getElementById('pt-load-status').textContent = 'Demo data loaded (no webhook configured or no test found).';
  } else {
    document.getElementById('pt-load-status').textContent = '✓ Test data loaded for ' + escHtml(name) + '.';
  }

  // Parse MCQ answers from the mcq_answers summary string
  const mcqStr = String(data.mcq_answers || '');
  const re = /Q(\d+):\s*([A-D])/gi;
  const mcqAnswers = {};
  let m;
  while ((m = re.exec(mcqStr)) !== null) mcqAnswers['q' + m[1]] = m[2].toUpperCase();

  // Also check for individual answer fields (fallback if mcq_answers is empty)
  for (var qi = 1; qi <= 18; qi++) {
    var key = 'q' + qi;
    if (!mcqAnswers[key] && data[key]) mcqAnswers[key] = String(data[key]).toUpperCase();
    if (!mcqAnswers[key] && data[key + '_answer']) mcqAnswers[key] = String(data[key + '_answer']).toUpperCase();
  }

  // Q19 multi-select
  const q19m = mcqStr.match(/Q19:\s*([A-D,\s]+)/i);
  const q19answers = q19m ? (q19m[1].match(/[A-D]/gi) || []).map(l => l.toUpperCase()) : [];
  // Fallback for Q19
  if (q19answers.length === 0 && data.q19) {
    var q19raw = String(data.q19);
    var q19parsed = q19raw.match(/[A-D]/gi);
    if (q19parsed) q19parsed.forEach(function(l) { q19answers.push(l.toUpperCase()); });
  }

  // Auto-score reading
  let readingHtml = '';
  Object.entries(PT_READING_CORRECT).forEach(([q, correct]) => {
    const submitted = mcqAnswers[q] || null;
    const isCorrect = submitted && submitted === correct;
    ptScores.reading[q] = isCorrect ? 2 : 0;
    readingHtml += buildPTChip(q, submitted, correct, 2);
  });
  document.getElementById('pt-reading-chips').innerHTML = readingHtml;

  // Auto-score listening Q15-Q18
  let listeningHtml = '';
  Object.entries(PT_LISTENING_CORRECT).forEach(([q, correct]) => {
    const submitted = mcqAnswers[q] || null;
    const isCorrect = submitted && submitted === correct;
    ptScores.listening[q] = isCorrect ? 2 : 0;
    listeningHtml += buildPTChip(q, submitted, correct, 2);
  });
  // Q19 multi-select
  const q19set = new Set(q19answers);
  const q19correct = q19set.size === 2 && [...PT_Q19_CORRECT].every(x => q19set.has(x));
  ptScores.listening['q19'] = q19correct ? 2 : (q19answers.some(x => PT_Q19_CORRECT.has(x)) ? 1 : 0);
  listeningHtml += '<div style="display:flex;align-items:center;gap:6px;padding:6px 12px;background:' + (q19correct ? 'var(--green-bg)' : '#fdecea') + ';border:1px solid ' + (q19correct ? 'var(--green)' : 'var(--rust)') + ';font-size:12px;border-radius:3px;">' +
    '<span style="color:' + (q19correct ? 'var(--green)' : 'var(--rust)') + ';font-weight:600;">' + (q19correct ? '✓' : '✗') + '</span> Q19 ' + q19answers.join(',') + ' <span style="font-size:11px;">' + ptScores.listening['q19'] + '/2</span></div>';
  document.getElementById('pt-listening-chips').innerHTML = listeningHtml;

  // Populate response viewers (try multiple possible field name formats)
  document.getElementById('pt-rv-q11').textContent = data.q11_passive_voice || data.q11 || '(no response)';
  document.getElementById('pt-rv-q12').textContent = data.q12_combined_sentence || data.q12 || '(no response)';
  document.getElementById('pt-rv-q13').textContent = data.q13_error_correction || data.q13 || '(no response)';
  document.getElementById('pt-rv-q14').textContent = data.q14_writing_task || data.q14 || '(no response)';
  document.getElementById('pt-rv-q20').textContent = data.q20_dictation || data.q20 || '(no response)';
  document.getElementById('pt-rv-q21').textContent = data.q21_speaking_notes || data.q21 || '(no response)';
  document.getElementById('pt-rv-q22').textContent = data.q22_speaking_notes || data.q22 || '(no response)';
  document.getElementById('pt-rv-q23').textContent = data.q23_speaking_notes || data.q23 || '(no response)';
  document.getElementById('pt-rv-q24').textContent = data.q24_speaking_notes || data.q24 || '(no response)';

  // Show all cards
  ['pt-reading-card','pt-listening-card','pt-writing-card','pt-speaking-card','pt-results-card'].forEach(id => {
    document.getElementById(id).style.display = 'block';
  });

  updatePTResults();

  // Restore previously graded scores — sheet data first, then supplement from localStorage
  var savedGraded = ex.ptGraded ? JSON.parse(JSON.stringify(ex.ptGraded)) : null;
  if (data.graded) {
    restorePTFromSheetData(data);
    document.getElementById('pt-load-status').textContent += ' Graded scores loaded from sheet.';
  }
  if (savedGraded) {
    ex.ptGraded = savedGraded;
    restorePTGradedState();
    document.getElementById('pt-load-status').textContent += ' Local grading data restored.';
  }
}

/** Restore slider values from graded sheet data (section scores like "18 / 20") */
function restorePTFromSheetData(data) {
  var anyRestored = false;

  // Helper: parse "X / Y" string to get X as number
  function parseScore(str) {
    if (!str) return null;
    var m = String(str).match(/^(\d+(?:\.\d+)?)/);
    return m ? parseFloat(m[1]) : null;
  }

  // Restore individual question scores from sheet (score_q11, score_q12, etc.)
  _ptRestoring = true;
  ['q11','q12','q13','q20','q21','q22','q23','q24'].forEach(function(q) {
    var val = parseScore(data['graded_' + q]);
    if (val != null) {
      ptScores[q] = val;
      var slider = document.getElementById('pt-slider-' + q);
      var disp = document.getElementById('pt-disp-' + q);
      if (slider) slider.value = val;
      if (disp) {
        var max = slider ? parseInt(slider.max) : 5;
        disp.innerHTML = val + ' <span>/ ' + max + '</span>';
      }
      anyRestored = true;
    }
  });

  // Restore Q14 sub-criteria from the total Q14 score (approximate: distribute evenly)
  var q14Total = parseScore(data['graded_q14']);
  if (q14Total != null) {
    ptScores.q14 = q14Total;
    // Distribute evenly across 4 sub-criteria (0-2.5 each)
    var perCrit = Math.min(q14Total / 4, 2.5);
    ['task','grammar','vocab','coherence'].forEach(function(f) {
      var el = document.getElementById('pt-sc-' + f);
      if (el) el.value = Math.round(perCrit * 2) / 2; // round to nearest 0.5
    });
    updatePTSubCriteria();
    anyRestored = true;
  }

  // Restore notes
  ['q11','q12','q13','q14','q21','q22','q23','q24'].forEach(function(q) {
    var note = data['graded_notes_' + q];
    if (note) {
      var el = document.getElementById('pt-notes-' + q);
      if (el) el.value = note;
      anyRestored = true;
    }
  });

  // Restore overall feedback
  if (data.graded_feedback) {
    var el = document.getElementById('pt-overall-feedback');
    if (el) el.value = data.graded_feedback;
    anyRestored = true;
  }

  _ptRestoring = false;
  if (anyRestored) {
    updatePTResults();
    savePTGradedState(); // sync to localStorage
  }
  return anyRestored;
}

async function savePlacementToSheets() {
  if (!WEBHOOK_URL || !WEBHOOK_URL.includes('script.google.com')) {
    document.getElementById('pt-save-status').textContent = 'No webhook configured. Set one in Student Profile.';
    return;
  }
  const r = ptComputeReading(), l = ptComputeListening(), w = ptComputeWriting(), s = ptComputeSpeaking();
  const total = r + l + w + s;
  const payload = {
    sheet_name: 'Examiner Results',
    graded_at: new Date().toLocaleString(),
    candidate_name: ex.studentName,
    test_date: new Date().toISOString().split('T')[0],
    examiner: ex.teacherName,
    reading_score: r + ' / 20',
    writing_score: w + ' / 25',
    listening_score: l + ' / 15',
    speaking_score: s + ' / 20',
    total_score: total + ' / ' + FP.TEST_TOTAL_MARKS,
    cefr_level: ptGetCEFR(total),
    examiner_feedback: document.getElementById('pt-overall-feedback').value || '',
    score_q11: ptScores.q11 || 0,
    score_q12: ptScores.q12 || 0,
    score_q13: ptScores.q13 || 0,
    score_q14: ptScores.q14 || 0,
    score_q20: ptScores.q20 || 0,
    score_q21: ptScores.q21 || 0,
    score_q22: ptScores.q22 || 0,
    score_q23: ptScores.q23 || 0,
    score_q24: ptScores.q24 || 0,
    notes_q11: document.getElementById('pt-notes-q11').value || '',
    notes_q12: document.getElementById('pt-notes-q12').value || '',
    notes_q13: document.getElementById('pt-notes-q13').value || '',
    notes_q14: document.getElementById('pt-notes-q14').value || '',
    notes_q21: document.getElementById('pt-notes-q21').value || '',
    notes_q22: document.getElementById('pt-notes-q22').value || '',
    notes_q23: document.getElementById('pt-notes-q23').value || '',
    notes_q24: document.getElementById('pt-notes-q24').value || '',
  };
  FP.showSaveOverlay('Saving placement test results…');
  document.getElementById('pt-save-status').textContent = 'Saving...';
  try {
    await FP.api.postForm(WEBHOOK_URL, payload);
    savePTGradedState();
    document.getElementById('pt-save-status').textContent = '✓ Results saved to "Examiner Results" sheet.';
    document.getElementById('pt-save-status').style.color = 'var(--green)';
  } catch(e) {
    document.getElementById('pt-save-status').textContent = '⚠ Could not reach webhook. Check the URL.';
    document.getElementById('pt-save-status').style.color = 'var(--rust)';
  }
  FP.hideSaveOverlay();
}

function initApp() {
  document.getElementById('setup-screen').style.display = 'none';
  document.getElementById('app').style.display = 'block';

  // Populate sidebar
  document.getElementById('sb-student-name').textContent = ex.studentName || 'No student yet';
  document.getElementById('sb-student-level').textContent = ex.studentLevel + ' · ' + getLevelTheme(ex.studentLevel);
  document.getElementById('sb-student-day').textContent = `Month ${ex.studentMonth} · Day ${getCurrentDay()}`;

  // Populate dashboard
  document.getElementById('dash-teacher-name').textContent = ex.teacherName;
  document.getElementById('dash-student-summary').textContent = ex.studentName
    ? `Tracking ${ex.studentName}'s progress through the ${ex.studentLevel} course.`
    : 'Set up a student profile to start tracking.';

  // Profile form
  document.getElementById('prof-student-name').value  = ex.studentName;
  document.getElementById('prof-level').value         = ex.studentLevel;
  document.getElementById('prof-month').value         = ex.studentMonth;
  document.getElementById('prof-notes').value         = ex.studentNotes;
  document.getElementById('prof-allow-spanish').checked      = !!ex.allowSpanish;
  document.getElementById('prof-allow-skip-test').checked    = !!ex.allowSkipTest;
  document.getElementById('prof-allow-retake-test').checked  = !!ex.allowRetakeTest;
  var grantEl = document.getElementById('prof-grant-access');
  if (grantEl) grantEl.checked = !!ex.grantAccess;
  document.getElementById('prof-teacher-email').value        = ex.teacherEmail || '';
  document.getElementById('prof-notify-test').checked        = !!ex.notifyOnTest;
  document.getElementById('prof-notify-submission').checked  = !!ex.notifyOnSubmission;
  document.getElementById('prof-notify-call').checked        = ex.notifyOnCallRequest !== false;

  buildAttendanceGrid();
  buildDifficultyGrid();
  buildFocusTags();
  updateDashboardStats();
  updateLessonRecord();

  document.getElementById('pt-student-name-btn').textContent = ex.studentName || 'Student';
  document.getElementById('mark-student-name-display').textContent = ex.studentName || 'your student';

  // Restore profile email
  if (ex.studentEmail) document.getElementById('prof-email').value = ex.studentEmail;
  if (ex.studentEmail) document.getElementById('student-email').value = ex.studentEmail;

  // Restore saved textarea values from localStorage
  var noteFields = ['today_notes', 'absence_notes', 'writing_feedback', 'speaking_feedback', 'overall_feedback', 'ai_instructions'];
  var noteElements = ['today-notes', 'absence-notes', 'writing-feedback', 'speaking-feedback', 'overall-feedback', 'ai-instructions'];
  for (var i = 0; i < noteFields.length; i++) {
    var saved = localStorage.getItem('fp_' + noteFields[i]);
    if (saved) { var el = document.getElementById(noteElements[i]); if (el) el.value = saved; }
  }

  // Fetch course progress from Google Sheets (updates dashboard stats, attendance, lesson records)
  // This is the only network call on init — panel-specific data loads lazily on first visit.
  fetchDashboardData();
  // Load pending call requests
  loadCallRequests();
  // Refresh call requests when tab becomes visible
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) loadCallRequests();
  });
}

async function fetchDashboardData() {
  if (!WEBHOOK_URL || !WEBHOOK_URL.includes('script.google.com') || !ex.studentName) return;
  try {
    var url = WEBHOOK_URL + '?action=get_progress&student=' + encodeURIComponent(ex.studentName);
    var data = await FP.api.get(url);

    // Merge lesson records from sheet with local records (sheet data takes precedence for new entries)
    if (Array.isArray(data.lessons) && data.lessons.length > 0) {
      data.lessons.forEach(function(l) {
        var day = parseInt(l.day_number || l.day);
        if (!day) return;
        var existing = ex.lessonRecords.find(function(r) { return r.day === day; });
        if (!existing) {
          ex.lessonRecords.push({
            day: day,
            topic: l.topic || '',
            writingScore: l.writing_score != null ? parseInt(l.writing_score) : null,
            speakingScore: l.speaking_score != null ? parseInt(l.speaking_score) : null,
            attended: true,
            timeSpent: l.time_spent ? parseInt(l.time_spent) : null,
            answersJson: l.answers_json || '',
          });
        } else {
          if (existing.writingScore == null && l.writing_score != null) {
            existing.writingScore = parseInt(l.writing_score);
            existing.speakingScore = l.speaking_score != null ? parseInt(l.speaking_score) : existing.speakingScore;
            existing.timeSpent = l.time_spent ? parseInt(l.time_spent) : existing.timeSpent;
          }
          if (!existing.answersJson && l.answers_json) existing.answersJson = l.answers_json;
        }
      });
      ex.lessonRecords.sort(function(a,b) { return a.day - b.day; });
    }

    // Update CEFR level if returned from sheet
    if (data.cefr_level && data.cefr_level !== ex.studentLevel) {
      ex.studentLevel = data.cefr_level;
      document.getElementById('sb-student-level').textContent = ex.studentLevel + ' · ' + getLevelTheme(ex.studentLevel);
      document.getElementById('prof-level').value = ex.studentLevel;
    }

    saveToLocalStorage();
    updateDashboardStats();
    updateLessonRecord();
    updateSkillsSnapshot();

    // Fetch attendance from sheet (merge: sheet data fills in if local is empty)
    fetchAttendanceFromSheet();
  } catch(e) {
    console.warn('[FluentPath] Could not fetch dashboard data from sheet:', e.message);
  }
}

async function fetchAttendanceFromSheet() {
  if (!WEBHOOK_URL || !WEBHOOK_URL.includes('script.google.com') || !ex.studentName) return;
  try {
    var url = WEBHOOK_URL + '?action=get_attendance&student=' + encodeURIComponent(ex.studentName);
    var data = await FP.api.get(url);
    if (!data || !data.found) return;
    var sheetAttendance = {};
    try { sheetAttendance = JSON.parse(data.attendance_json); } catch(e) {}
    // Merge: sheet data fills in days not already set locally
    var localHasData = Object.keys(ex.attendance).length > 0;
    if (!localHasData) {
      ex.attendance = sheetAttendance;
    } else {
      Object.keys(sheetAttendance).forEach(function(key) {
        if (!ex.attendance[key] || ex.attendance[key] === 'none') {
          ex.attendance[key] = sheetAttendance[key];
        }
      });
    }
    // Restore absence notes if blank locally
    var notesEl = document.getElementById('absence-notes');
    if (notesEl && !notesEl.value && data.absence_notes) {
      notesEl.value = data.absence_notes;
    }
    buildAttendanceGrid();
    updateDashboardStats();
    saveToLocalStorage();
  } catch(e) {
    console.warn('[FluentPath] Could not fetch attendance from sheet:', e.message);
  }
}

function getLevelTheme(level) {
  const map = { A1:'Everyday Survival', A2:'Community & Life', B1:'The Workplace', B2:'Career & Society', C1:'Professional Mastery', C2:'Full Fluency' };
  return map[level] || '';
}

function getCurrentDay() {
  // Use actual lesson progress: count days marked present, or fall back to lesson records count
  const presentDays = Object.values(ex.attendance).filter(v => v === 'present').length;
  if (presentDays > 0) return Math.min(presentDays, FP.COURSE_DAYS);
  if (ex.lessonRecords.length > 0) return Math.min(ex.lessonRecords.length, FP.COURSE_DAYS);
  return 1;
}

// ══════════════════════════════════════════════════════
// NAVIGATION — lazy-load panel data on first visit
// ══════════════════════════════════════════════════════
var panelLoaded = {};

function showPanel(id) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.sb-link').forEach(l => l.classList.remove('active'));
  document.getElementById('panel-' + id).classList.add('active');
  document.getElementById('nav-' + id)?.classList.add('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });

  // Load panel data only on first visit (or when forced)
  if (!panelLoaded[id]) {
    panelLoaded[id] = true;
    loadPanelData(id);
  }
}

/** Fetch data for a specific panel on first visit. */
function loadPanelData(id) {
  switch (id) {
    case 'classoverview': loadClassOverview(); break;
    case 'placementtest': loadPlacementTest(); break;
    case 'marking':       autoLoadSubmission(); break;
    case 'library':       loadLibraryPanel(); break;
    case 'approvals':     loadApprovalQueue(); break;
    // dashboard, attendance, difficulty, progress, weekly, profile
    // are populated by initApp + fetchDashboardData (already loaded)
  }
}

/** Force a panel to reload its data (e.g. after saving). */
function reloadPanel(id) {
  panelLoaded[id] = false;
  loadPanelData(id);
  panelLoaded[id] = true;
}

// ══════════════════════════════════════════════════════
// CLASS OVERVIEW
// ══════════════════════════════════════════════════════
var classData = null;
var classSortKey = 'name';
var classSortAsc = true;

async function loadClassOverview() {
  var container = document.getElementById('class-table-container');
  if (!WEBHOOK_URL || !WEBHOOK_URL.includes('script.google.com')) {
    container.innerHTML = '<div style="color:var(--muted);font-style:italic;">No webhook configured.</div>';
    return;
  }
  container.innerHTML = '<div style="color:var(--muted);font-style:italic;">Loading class data...</div>';
  try {
    var data = await FP.api.get(WEBHOOK_URL + '?action=get_class_overview', { timeout: 30000 });
    if (data && data.found && Array.isArray(data.students)) {
      classData = data.students;
      renderClassTable();
    } else {
      container.innerHTML = '<div style="color:var(--muted);">No students found.</div>';
    }
  } catch (e) {
    container.innerHTML = '<div style="color:var(--rust);">Could not load class data: ' + escHtml(e.message) + '</div>';
  }
}

function renderClassTable() {
  if (!classData) return;
  var container = document.getElementById('class-table-container');
  var filterAttention = document.getElementById('class-filter-attention')?.checked;

  var rows = classData.slice();
  if (filterAttention) {
    rows = rows.filter(function(s) { return s.status === 'yellow' || s.status === 'red'; });
  }

  // Sort
  rows.sort(function(a, b) {
    var va = a[classSortKey] || '', vb = b[classSortKey] || '';
    if (typeof va === 'number' && typeof vb === 'number') return classSortAsc ? va - vb : vb - va;
    va = String(va).toLowerCase(); vb = String(vb).toLowerCase();
    return classSortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
  });

  if (rows.length === 0) {
    container.innerHTML = '<div style="color:var(--muted);font-style:italic;">' +
      (filterAttention ? 'No students need attention right now.' : 'No students registered yet.') + '</div>';
    return;
  }

  var arrow = classSortAsc ? ' ▲' : ' ▼';
  function th(key, label) {
    return '<th onclick="sortClassTable(\'' + key + '\')">' + label + (classSortKey === key ? arrow : '') + '</th>';
  }

  var html = '<table class="class-table"><thead><tr>' +
    th('name', 'Student') +
    th('level', 'Level') +
    th('days_completed', 'Progress') +
    th('last_active', 'Last Active') +
    th('ungraded', 'Ungraded') +
    th('attendance_pct', 'Attendance') +
    '<th>Action</th></tr></thead><tbody>';

  rows.forEach(function(s) {
    var pct = Math.round((s.days_completed / FP.COURSE_DAYS) * 100);
    var rowClass = 'clickable class-row-' + escHtml(s.status);
    html += '<tr class="' + rowClass + '" onclick="switchToStudent(\'' + escHtml(s.name) + '\')">' +
      '<td><strong>' + escHtml(s.name) + '</strong></td>' +
      '<td>' + escHtml(s.level || '—') + '</td>' +
      '<td><div class="class-progress-bar"><div class="class-progress-fill" style="width:' + pct + '%;"></div></div>' + s.days_completed + '/' + FP.COURSE_DAYS + '</td>' +
      '<td>' + (s.last_active ? formatLessonDate(s.last_active) : '—') + '</td>' +
      '<td>' + (s.ungraded > 0 ? '<strong style="color:var(--rust);">' + s.ungraded + '</strong>' : '0') + '</td>' +
      '<td>' + s.attendance_pct + '%</td>' +
      '<td><button class="btn-secondary" style="font-size:11px;padding:4px 10px;" onclick="event.stopPropagation();switchToStudent(\'' + escHtml(s.name) + '\')">Open</button></td>' +
      '</tr>';
  });

  html += '</tbody></table>';
  container.innerHTML = html;
}

function sortClassTable(key) {
  if (classSortKey === key) classSortAsc = !classSortAsc;
  else { classSortKey = key; classSortAsc = true; }
  renderClassTable();
}

function switchToStudent(name) {
  resetStudentState(name);
  saveToLocalStorage();
  // Reload the page with the new student
  window.location.href = window.location.pathname + '?student=' + encodeURIComponent(name);
}

// ══════════════════════════════════════════════════════
// DASHBOARD
// ══════════════════════════════════════════════════════
function updateDashboardStats() {
  const present = Object.values(ex.attendance).filter(v => v === 'present').length;
  const absent  = Object.values(ex.attendance).filter(v => v === 'absent').length;
  const done    = present + absent;
  const total   = FP.COURSE_DAYS;
  const dayNum  = getCurrentDay();
  const pctOverall = Math.round(done / total * 100);
  const pctAttend  = done > 0 ? Math.round(present/done*100) : 0;
  const markedCount = ex.lessonRecords.filter(r => r.writingScore != null).length;
  const markPct = done > 0 ? Math.round(markedCount/done*100) : 0;

  // Avg lesson time from records (in minutes)
  const timesMs = ex.lessonRecords.filter(r => r.timeSpent).map(r => r.timeSpent);
  const avgTimeMin = timesMs.length > 0 ? Math.round(timesMs.reduce((a,b)=>a+b,0) / timesMs.length) : 0;

  // Helper: safe element setter (prevents null errors if HTML element is missing)
  function s(id, prop, val) { var el = document.getElementById(id); if (el) { if (prop === 'width') el.style.width = val; else el[prop] = val; } }

  s('stat-days-done',   'textContent', present);
  s('stat-attendance',  'textContent', done > 0 ? Math.round(present/done*100) + '%' : '—%');
  s('stat-avg-time',    'textContent', avgTimeMin > 0 ? avgTimeMin + 'm' : '—m');
  s('stat-marked',      'textContent', markedCount);
  s('dash-day-num',     'textContent', dayNum);
  s('prog-overall',     'width',       pctOverall + '%');
  s('prog-overall-val', 'textContent', pctOverall + '%');
  s('prog-attend',      'width',       pctAttend + '%');
  s('prog-attend-val',  'textContent', pctAttend + '%');
  s('prog-writing',     'width',       markPct + '%');
  s('prog-writing-val', 'textContent', markPct + '%');
  s('prog-days',        'textContent', present);
  s('prog-attend-pct',  'textContent', done > 0 ? Math.round(present/done*100)+'%' : '—');

  updateRecentActivity();
}

function updateRecentActivity() {
  const container = document.getElementById('recent-activity');
  if (!container) return;

  // Combine lesson records and recent marking data
  const items = ex.lessonRecords.slice().reverse().slice(0, 5);
  if (items.length === 0) {
    container.innerHTML = '<div style="font-size:14px;color:var(--muted);font-style:italic;">No submissions yet. They will appear here when your student completes a lesson.</div>';
    return;
  }

  container.innerHTML = items.map(r => {
    const score = r.writingScore != null ? (r.writingScore + (r.speakingScore || 0)) + '/45' : 'Ungraded';
    const attended = r.attended ? '<span style="color:var(--green);font-weight:600;">Present</span>' : '<span style="color:var(--rust);">Absent</span>';
    return '<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--cream);">' +
      '<div><strong>Day ' + escHtml(String(r.day)) + '</strong>' +
      (r.topic ? ' <span style="color:var(--muted);font-size:13px;">· ' + escHtml(r.topic) + '</span>' : '') + '</div>' +
      '<div style="display:flex;gap:12px;font-size:13px;">' + attended +
      ' <span style="font-weight:600;">' + escHtml(score) + '</span></div></div>';
  }).join('');
}

// ══════════════════════════════════════════════════════
// ATTENDANCE
// ══════════════════════════════════════════════════════
function buildAttendanceGrid() {
  const grid = document.getElementById('attend-grid');
  const today = getCurrentDay();
  grid.innerHTML = '';
  for (let d = 1; d <= 20; d++) {
    const status = ex.attendance[`day-${d}`] || 'none';
    const isToday = d === today;
    const cell = document.createElement('div');
    cell.className = 'attend-cell' + (status === 'present' ? ' present' : status === 'absent' ? ' absent' : '') + (isToday ? ' today' : '');
    cell.innerHTML = `<span>${status === 'present' ? '✓' : status === 'absent' ? '✗' : '·'}</span><span class="ac-num">D${d}</span>`;
    cell.onclick = () => toggleAttendance(d);
    grid.appendChild(cell);
  }
  updateAttendanceCounts();
}

function toggleAttendance(day) {
  const key = `day-${day}`;
  const cur = ex.attendance[key] || 'none';
  if (cur === 'none') ex.attendance[key] = 'present';
  else if (cur === 'present') ex.attendance[key] = 'absent';
  else ex.attendance[key] = 'none';
  buildAttendanceGrid();
  updateDashboardStats();
}

function updateAttendanceCounts() {
  const present = Object.values(ex.attendance).filter(v => v === 'present').length;
  const absent  = Object.values(ex.attendance).filter(v => v === 'absent').length;
  document.getElementById('attend-present').textContent = present;
  document.getElementById('attend-absent').textContent  = absent;
  document.getElementById('attend-remaining').textContent = 20 - present - absent;
}

async function saveAttendance() {
  saveToLocalStorage();
  const el = document.getElementById('attend-save-status');

  if (!WEBHOOK_URL || !WEBHOOK_URL.includes('script.google.com') || !ex.studentName) {
    el.textContent = '✓ Attendance saved locally.'; el.className = 'send-status ok'; el.style.display = 'block';
    setTimeout(() => el.style.display = 'none', 3000);
    return;
  }

  FP.showSaveOverlay('Saving attendance…');
  el.textContent = 'Saving to Google Sheets...'; el.className = 'send-status'; el.style.display = 'block';
  try {
    await FP.api.postForm(WEBHOOK_URL, {
      action: 'save_attendance',
      student_name: ex.studentName,
      attendance_json: JSON.stringify(ex.attendance),
      absence_notes: document.getElementById('absence-notes')?.value || ''
    });
    el.textContent = '✓ Attendance saved to Google Sheets.'; el.className = 'send-status ok';
  } catch(e) {
    el.textContent = 'Could not save to sheet. Saved locally.'; el.className = 'send-status error';
  }
  FP.hideSaveOverlay();
  setTimeout(() => el.style.display = 'none', 4000);
}

// ══════════════════════════════════════════════════════
// APPROVAL QUEUE
// ══════════════════════════════════════════════════════
async function loadApprovalQueue() {
  const container = document.getElementById('approval-queue');

  // In demo: show demo pending lessons
  if (!WEBHOOK_URL || WEBHOOK_URL.includes('script.google.com') === false) {
    // Show a demo pending lesson
    ex.pendingLessons = [
      { id: 'demo-1', studentName: ex.studentName || 'Student', level: ex.studentLevel, date: new Date().toISOString().split('T')[0], day: getCurrentDay(), status: 'pending', topic: 'Daily Communication at Work', content: getDemoLessonPreview() }
    ];
    renderApprovalQueue();
    updateDashboardStats();
    return;
  }

  container.innerHTML = '<div style="text-align:center;padding:30px;color:var(--muted);font-style:italic;">Loading…<div class="spinner"></div></div>';

  try {
    const url = WEBHOOK_URL + '?action=get_pending&teacher_code=' + encodeURIComponent(ex.teacherCode);
    const data = await FP.api.get(url);
    ex.pendingLessons = data.lessons || [];
    renderApprovalQueue();
  } catch(e) {
    container.innerHTML = '<div style="font-size:14px;color:var(--muted);font-style:italic;">Could not load from sheet. Using demo data.</div>';
  }
  updateDashboardStats();
}

function renderApprovalQueue() {
  const container = document.getElementById('approval-queue');
  if (ex.pendingLessons.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted);font-style:italic;"><div style="font-size:32px;margin-bottom:12px;">✓</div>No pending lessons. All caught up!</div>';
    return;
  }

  container.innerHTML = ex.pendingLessons.map(l => `
    <div class="approval-item ${l.status === 'approved' ? 'approved' : l.status === 'rejected' ? 'rejected' : ''}" id="ai-${escHtml(l.id)}">
      <div class="ai-info">
        <div class="ai-name">${escHtml(l.studentName || ex.studentName)} · <span style="color:var(--gold);">${escHtml(l.level)}</span></div>
        <div class="ai-meta">Day ${escHtml(String(l.day))} · ${escHtml(l.date)} · Topic: <em>${escHtml(l.topic || 'Not yet generated')}</em></div>
        <div style="margin-top:4px;"><span class="pill ${escHtml(l.status || 'pending')}">${escHtml(l.status || 'pending')}</span></div>
      </div>
      <div class="ai-actions">
        <button class="btn-preview" onclick="toggleLessonPreview('${escHtml(l.id)}')">👁 Preview</button>
        ${l.status !== 'approved' ? `<button class="btn-approve" onclick="approveLesson('${escHtml(l.id)}')">✓ Approve</button>` : ''}
        ${l.status !== 'rejected' ? `<button class="btn-reject" onclick="rejectLesson('${escHtml(l.id)}')">✗ Reject</button>` : ''}
      </div>
    </div>
    <div class="lesson-preview" id="preview-${escHtml(l.id)}">
      ${renderLessonPreviewContent(l)}
    </div>
  `).join('');
}

function getDemoLessonPreview() {
  return {
    objective: 'Students will be able to communicate clearly about scheduling and appointments at work.',
    vocabulary: ['appointment /əˈpɔɪntmənt/ — a meeting at a set time', 'schedule /ˈʃedjuːl/ — a plan or timetable', 'available /əˈveɪləbəl/ — free to use or meet'],
    listeningText: 'Hi Sarah, this is Tom from HR. I\'m calling to confirm our meeting tomorrow at 2pm. Please let me know if you need to reschedule.',
    speakingDrill: 'Could we reschedule for Thursday morning?',
    writingPrompt: 'Write an email to your manager asking for a day off next week.',
  };
}

function renderLessonPreviewContent(l) {
  const c = l.content || {};
  return `
    <div style="background:white;border:1px solid var(--rule);border-top:none;padding:20px;margin-bottom:12px;">
      <div style="font-size:11px;letter-spacing:0.2em;text-transform:uppercase;font-weight:600;color:var(--muted);margin-bottom:12px;">LESSON CONTENT PREVIEW</div>

      <div class="lp-section"><div class="lp-label">OBJECTIVE</div><div class="lp-body">${escHtml(c.objective || 'Loading...')}</div></div>
      <div class="lp-section"><div class="lp-label">VOCABULARY</div><div class="lp-body">${Array.isArray(c.vocabulary) ? c.vocabulary.map(v => '<div>• ' + escHtml(v) + '</div>').join('') : escHtml(c.vocabulary || '...')}</div></div>
      <div class="lp-section"><div class="lp-label">LISTENING TEXT</div><div class="lp-body"><em>"${escHtml(c.listeningText || '...')}"</em></div></div>
      <div class="lp-section"><div class="lp-label">SPEAKING DRILL</div><div class="lp-body">"${escHtml(c.speakingDrill || '...')}"</div></div>
      <div class="lp-section"><div class="lp-label">WRITING PROMPT</div><div class="lp-body">${escHtml(c.writingPrompt || '...')}</div></div>

      <div style="margin-top:14px;">
        <div style="font-size:11px;letter-spacing:0.2em;text-transform:uppercase;font-weight:600;color:var(--muted);margin-bottom:8px;">ADJUST DIFFICULTY</div>
        <div class="diff-controls">
          <button class="diff-btn active" onclick="setDiffMode('${escHtml(l.id)}', 'easier', this)">⬇ Easier</button>
          <button class="diff-btn active" style="background:var(--ink);color:var(--paper);border-color:var(--ink);" onclick="setDiffMode('${escHtml(l.id)}', 'normal', this)">✓ As Generated</button>
          <button class="diff-btn" onclick="setDiffMode('${escHtml(l.id)}', 'harder', this)">⬆ Harder</button>
          <button class="diff-btn" onclick="regenerateLesson('${escHtml(l.id)}')">🔄 Regenerate</button>
        </div>
      </div>
    </div>
  `;
}

function toggleLessonPreview(id) {
  const el = document.getElementById(`preview-${id}`);
  el.classList.toggle('show');
}

async function approveLesson(id) {
  const item = document.getElementById(`ai-${id}`);
  const lesson = ex.pendingLessons.find(l => l.id === id);
  if (lesson) lesson.status = 'approved';
  renderApprovalQueue();
  updateDashboardStats();
  await sendApprovalToSheet(id, 'approved');
}

async function rejectLesson(id) {
  const lesson = ex.pendingLessons.find(l => l.id === id);
  if (lesson) lesson.status = 'rejected';
  renderApprovalQueue();
  updateDashboardStats();
  await sendApprovalToSheet(id, 'rejected');
}

async function sendApprovalToSheet(id, status) {
  if (!WEBHOOK_URL || !WEBHOOK_URL.startsWith('https://')) return;
  try {
    await FP.api.postForm(WEBHOOK_URL, { action: 'update_approval', lesson_id: id, status: status, teacher_code: ex.teacherCode });
  } catch(e) {}
}

function setDiffMode(id, mode, btn) {
  btn.closest('.diff-controls').querySelectorAll('.diff-btn').forEach(b => {
    b.classList.remove('active'); b.style.background='white'; b.style.color='var(--muted)'; b.style.borderColor='var(--rule)';
  });
  btn.style.background='var(--ink)'; btn.style.color='var(--paper)'; btn.style.borderColor='var(--ink)';
  const lesson = ex.pendingLessons.find(l => l.id === id);
  if (lesson) lesson.diffMode = mode;
}

async function regenerateLesson(id) {
  alert('Lesson regeneration requires the AI API to be connected to your Google Sheet webhook. In a live deployment, this would request a new lesson from the AI provider.');
}

function createManualLesson() {
  alert('In a live deployment, this would let you create a custom lesson plan for your student.');
}

// ══════════════════════════════════════════════════════
// GRADING
// ══════════════════════════════════════════════════════
function showMarkTab(tab) {
  var tabMap = { writing: 'Writing', speaking: 'Speaking', responses: 'All Responses', summary: 'Final Score' };
  document.querySelectorAll('.mark-section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.m-tab').forEach(t => t.classList.remove('active'));
  document.getElementById('mark-' + tab).classList.add('active');
  var label = tabMap[tab] || tab;
  document.querySelectorAll('.m-tab').forEach(t => { if (t.textContent === label) t.classList.add('active'); });
}

async function autoLoadSubmission() {
  var name = ex.studentName;
  if (!name) { showStatus('load-status', 'Set up a student profile first.', true); return; }
  showStatus('load-status', 'Fetching latest submission for ' + escHtml(name) + '...', false);
  try {
    var url = WEBHOOK_URL + '?action=get_latest_submission&student=' + encodeURIComponent(name);
    var data = await FP.api.get(url);
    if (data && data.found) {
      displaySubmission(data);
      showStatus('load-status', '✓ Loaded Day ' + (data.day_number || '?') + ' submission.', false);
      // Populate day picker in background
      populateDayPicker(name, data.day_number);
      return;
    }
  } catch(e) {}
  // Fallback to demo
  showStatus('load-status', 'No ungraded submission found. Showing demo data.', true);
  loadDemoSubmission();
}

// Cache of all submissions for next-ungraded navigation
var cachedSubmissions = null;

async function goNextUngraded() {
  var name = ex.studentName;
  if (!name) { showStatus('load-status', 'Set up a student profile first.', true); return; }

  // Use cached submissions if available, else fetch
  if (!cachedSubmissions) {
    showStatus('load-status', 'Loading submissions...', false);
    try {
      var url = WEBHOOK_URL + '?action=get_all_submissions&student=' + encodeURIComponent(name);
      var data = await FP.api.get(url);
      if (data && data.found && Array.isArray(data.submissions)) {
        cachedSubmissions = data.submissions;
      }
    } catch (e) { /* fall through */ }
  }

  if (!cachedSubmissions || cachedSubmissions.length === 0) {
    showStatus('load-status', 'No submissions found.', true);
    return;
  }

  // Find the next ungraded submission after the currently loaded day
  var currentDay = ex.markingData ? parseInt(ex.markingData.day_number || 0) : 0;
  var ungraded = cachedSubmissions.filter(function(s) { return !s.has_marks; });

  if (ungraded.length === 0) {
    showStatus('load-status', '✓ All lessons graded!', false);
    return;
  }

  // Pick the first ungraded after currentDay, or wrap to the first ungraded overall
  var next = ungraded.find(function(s) { return parseInt(s.day_number) > currentDay; }) || ungraded[0];
  loadSpecificDay(next.day_number);
}

// Invalidate cached submissions after grading so next-ungraded picks up changes
function invalidateSubmissionCache() {
  cachedSubmissions = null;
}

async function populateDayPicker(studentName, currentDay) {
  try {
    var url = WEBHOOK_URL + '?action=get_all_submissions&student=' + encodeURIComponent(studentName);
    var data = await FP.api.get(url);
    if (!data || !data.found || !Array.isArray(data.submissions)) return;
    var picker = document.getElementById('day-picker');
    picker.innerHTML = '<option value="">Jump to lesson…</option>';
    data.submissions.forEach(function(s) {
      var opt = document.createElement('option');
      opt.value = s.day_number;
      opt.textContent = 'Day ' + s.day_number + ' — ' + (s.topic || 'Untitled') + (s.has_marks ? ' ✓ graded' : '');
      if (String(s.day_number) === String(currentDay)) opt.selected = true;
      picker.appendChild(opt);
    });
    picker.style.display = 'inline-block';
  } catch(e) { console.warn('[FluentPath] Could not load day picker:', e.message); }
}

async function loadSpecificDay(dayNum) {
  if (!dayNum || !ex.studentName) return;
  showStatus('load-status', 'Loading Day ' + dayNum + '...', false);
  try {
    var url = WEBHOOK_URL + '?action=get_latest_submission&student=' + encodeURIComponent(ex.studentName) + '&day=' + encodeURIComponent(dayNum);
    var data = await FP.api.get(url);
    if (data && data.found) {
      displaySubmission(data);
      showStatus('load-status', '✓ Loaded Day ' + dayNum + ' submission.', false);
      return;
    }
  } catch(e) {}
  showStatus('load-status', 'Could not load Day ' + dayNum + '.', true);
}

function loadDemoSubmission() {
  const demo = {
    student_name: ex.studentName || 'Maria Gonzalez',
    lesson_date: new Date().toISOString().split('T')[0],
    day_number: getCurrentDay(),
    level: ex.studentLevel,
    topic: 'Communication at Work',
    writing_response: 'Hi John, I hope you are well. I am writing to ask if I can take next Friday off. I have a doctor appointment in the morning and I need to take my daughter to school in the afternoon. I will finish all my work before I leave. I can also work from home on Thursday evening if needed. Thank you for your consideration. Maria.',
    speaking_transcript: 'I would like to request a day off on Friday the fifteenth. The reason is I have a medical appointment in the morning at nine o clock. I always try to plan ahead and I have already finished my part of the project. I hope this is okay with the team.',
    drill_s1: 'could we reschedule for Thursday morning',
    drill_s2: 'i would like to make an appointment',
    vocab_practice: 'I have an appointment tomorrow. The manager is available this afternoon.',
    warmup_response: 'This morning I woke up at six and made breakfast for my kids. Then I drove to work and started my shift at eight.',
    confidence: 2,
    review_notes: 'The vocabulary was not too hard but the writing task was challenging for me.',
  };
  displaySubmission(demo);
  showStatus('load-status', '✓ Demo submission loaded.', false);
}

function displaySubmission(data) {
  ex.markingData = data;
  document.getElementById('marking-area').style.display = 'block';

  // Parse answers_json
  var answers = {};
  try { if (data.answers_json) answers = JSON.parse(data.answers_json); } catch(e) {}
  ex.markingData.parsedAnswers = answers;

  // ── Graded badge ──
  var badge = document.getElementById('graded-badge');
  badge.style.display = 'inline-block';
  if (data.has_marks) {
    badge.textContent = 'GRADED';
    badge.className = 'pill approved';
  } else {
    badge.textContent = 'UNGRADED';
    badge.className = 'pill pending';
  }

  // ── Writing tab: warmup, vocab, writing task ──
  document.getElementById('student-warmup').textContent = data.warmup_response || answers.warmup || '(none)';
  document.getElementById('student-vocab').textContent = answers.vocab_practice || data.vocab_practice || '(none)';
  document.getElementById('student-writing').textContent = data.writing_response || '(no writing submitted)';

  // ── Speaking tab: transcript + drills ──
  document.getElementById('student-speaking').textContent = data.speaking_transcript || '(no speaking transcript)';
  renderSpeakingAudio(data.speaking_audio_json);

  // ── All Responses tab: listening + practice with chip-style display ──
  var listenKeys = Object.keys(answers).filter(function(k) { return k.startsWith('listening_') && !k.includes('_correct') && !k.includes('_is_right') && k !== 'listening_correct' && k !== 'listening_total'; }).sort();
  if (listenKeys.length > 0) {
    var listenChips = listenKeys.map(function(k) {
      var val = parseInt(answers[k]);
      var letter = !isNaN(val) ? String.fromCharCode(65 + val) : '—';
      var qNum = k.replace('listening_', '');
      var isRight = answers[k + '_is_right'];
      var correctness = (isRight !== undefined) ? !!parseInt(isRight) : null;
      return buildResponseChip('Q' + qNum, letter, correctness);
    }).join('');
    document.getElementById('resp-listening').innerHTML = listenChips;
    if (answers.listening_correct != null && answers.listening_total != null) {
      document.getElementById('resp-listen-score').innerHTML = answers.listening_correct + ' <span>/ ' + answers.listening_total + '</span>';
    } else {
      document.getElementById('resp-listen-score').innerHTML = listenKeys.length + ' <span>answered</span>';
    }
  } else {
    document.getElementById('resp-listening').innerHTML = '<span style="color:var(--muted);">No listening answers recorded.</span>';
    document.getElementById('resp-listen-score').innerHTML = '— <span></span>';
  }

  var practiceKeys = Object.keys(answers).filter(function(k) { return k.startsWith('practice_') && !k.includes('_correct') && !k.includes('_is_right') && k !== 'practice_correct' && k !== 'practice_total'; }).sort();
  if (practiceKeys.length > 0) {
    var practiceChips = practiceKeys.map(function(k) {
      var val = parseInt(answers[k]);
      var letter = !isNaN(val) ? String.fromCharCode(65 + val) : '—';
      var qNum = k.replace('practice_', '');
      var isRight = answers[k + '_is_right'];
      var correctness = (isRight !== undefined) ? !!parseInt(isRight) : null;
      return buildResponseChip('Q' + qNum, letter, correctness);
    }).join('');
    document.getElementById('resp-practice').innerHTML = practiceChips;
    if (answers.practice_correct != null && answers.practice_total != null) {
      document.getElementById('resp-practice-score').innerHTML = answers.practice_correct + ' <span>/ ' + answers.practice_total + '</span>';
    } else {
      document.getElementById('resp-practice-score').innerHTML = practiceKeys.length + ' <span>answered</span>';
    }
  } else {
    document.getElementById('resp-practice').innerHTML = '<span style="color:var(--muted);">No comprehension answers recorded.</span>';
    document.getElementById('resp-practice-score').innerHTML = '— <span></span>';
  }

  const confMap = ['Hard 😕', 'OK 😐', 'Good 🙂', 'Great! 😄'];
  document.getElementById('sum-confidence').textContent = data.confidence != null ? confMap[data.confidence] : '—';

  // Restore existing marks if this submission was previously graded (from sheet)
  if (data.has_marks) {
    restoreMarksFromSheetData(data);
  } else {
    // Try restoring from localStorage
    restoreMarksFromLocalStorage();
  }
}

function buildResponseChip(label, answer, isCorrect, maxMarks) {
  var marks = maxMarks || 2;
  if (isCorrect === undefined || isCorrect === null) {
    // Unknown correctness — neutral chip
    return '<div style="display:flex;align-items:center;gap:6px;padding:6px 12px;background:var(--cream);border:1px solid var(--rule);font-size:12px;border-radius:3px;">' +
      '<span style="font-weight:600;">' + escHtml(label) + '</span> ' +
      '<span style="color:var(--ink);">' + escHtml(answer) + '</span>' +
      '</div>';
  }
  var bg     = isCorrect ? 'var(--green-bg)' : '#fdecea';
  var border = isCorrect ? 'var(--green)' : 'var(--rust)';
  var color  = isCorrect ? 'var(--green)' : 'var(--rust)';
  var icon   = isCorrect ? '✓' : '✗';
  var score  = isCorrect ? marks + '/' + marks : '0/' + marks;
  return '<div style="display:flex;align-items:center;gap:6px;padding:6px 12px;background:' + bg + ';border:1px solid ' + border + ';font-size:12px;border-radius:3px;">' +
    '<span style="color:' + color + ';font-weight:600;">' + icon + '</span> ' +
    '<span style="font-weight:600;">' + escHtml(label) + '</span> ' +
    '<span style="color:var(--ink);">' + escHtml(answer) + '</span> ' +
    '<span style="color:' + color + ';font-size:11px;">' + score + '</span>' +
    '</div>';
}

/**
 * Fetch a Drive audio file via the Apps Script get_audio endpoint
 * and return a local blob URL for playback.
 */
async function fetchAudioBlobUrl(fileId) {
  var url = WEBHOOK_URL + '?action=get_audio&id=' + encodeURIComponent(fileId);
  var resp = await FP.api.get(url, { timeout: 60000 });
  if (!resp || !resp.found || !resp.data) return null;
  var binary = atob(resp.data);
  var bytes = new Uint8Array(binary.length);
  for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  var blob = new Blob([bytes], { type: resp.mime || 'audio/webm' });
  return URL.createObjectURL(blob);
}

/**
 * Render audio players for pronunciation drills and the conversation prompt.
 * audioJsonStr: raw string from speaking_audio_json column, e.g.
 *   '{"s1":"<fileId>","s1_score":0.85,"conversation":"<fileId>"}'
 */
function renderSpeakingAudio(audioJsonStr) {
  const section = document.getElementById('speaking-audio-section');
  const drillContainer = document.getElementById('drill-audio-players');
  const convContainer  = document.getElementById('conv-audio-player');

  section.style.display = 'none';
  drillContainer.innerHTML = '';
  convContainer.innerHTML  = '';

  if (!audioJsonStr) return;
  let audio;
  try { audio = JSON.parse(audioJsonStr); } catch(e) { return; }

  const drillKeys = Object.keys(audio).filter(k => !k.includes('_score') && k !== 'conversation').sort();
  const convId    = audio['conversation'];

  if (drillKeys.length === 0 && !convId) return;
  section.style.display = 'block';

  // Parse drill transcripts from answers_json
  var drillTranscripts = {};
  if (ex.markingData && ex.markingData.parsedAnswers) {
    var ans = ex.markingData.parsedAnswers;
    Object.keys(ans).forEach(function(k) {
      if (k.startsWith('drill_') && !k.includes('_score')) drillTranscripts[k] = ans[k];
    });
  }

  // Build placeholder UI, then fetch audio in background
  drillKeys.forEach((key, i) => {
    const score = audio[key + '_score'];
    const scoreHtml = score != null
      ? `<span style="margin-left:12px;font-size:12px;color:var(--forest);font-weight:600;">Accuracy: ${Math.round(score * 100)}%</span>`
      : '';
    const transcriptKey = 'drill_' + key;
    const transcript = drillTranscripts[transcriptKey] || (ex.markingData ? ex.markingData[transcriptKey] : '');
    const transcriptHtml = transcript
      ? `<blockquote style="margin:6px 0;padding:8px 12px;border-left:3px solid var(--forest);background:rgba(82,107,74,0.08);font-size:13px;font-style:italic;color:var(--ink);">"${escHtml(transcript)}"</blockquote>`
      : '';
    drillContainer.insertAdjacentHTML('beforeend', `
      <div style="margin-bottom:12px;">
        <div style="font-size:12px;font-weight:600;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.05em;">
          Drill ${i + 1}${scoreHtml}
        </div>
        ${transcriptHtml}
        <div id="audio-drill-${key}" style="font-size:12px;color:var(--muted);">Loading audio…</div>
      </div>`);
    fetchAudioBlobUrl(audio[key]).then(blobUrl => {
      const el = document.getElementById('audio-drill-' + key);
      if (el) el.innerHTML = blobUrl
        ? `<audio controls src="${blobUrl}" style="width:100%;max-width:400px;"></audio>`
        : '<span style="color:var(--red);">Could not load audio.</span>';
    });
  });

  if (convId) {
    convContainer.innerHTML = '<div id="audio-conv" style="font-size:12px;color:var(--muted);">Loading audio…</div>';
    fetchAudioBlobUrl(convId).then(blobUrl => {
      const el = document.getElementById('audio-conv');
      if (el) el.innerHTML = blobUrl
        ? `<audio controls src="${blobUrl}" style="width:100%;max-width:400px;"></audio>`
        : '<span style="color:var(--red);">Could not load audio.</span>';
    });
  }
}

function restoreMarksFromSheetData(data) {
  // Parse writing breakdown JSON: { task:X, grammar:X, vocab:X, coherence:X, total:X }
  try {
    var wb = data.marks_writing_breakdown ? JSON.parse(data.marks_writing_breakdown) : null;
    if (wb) {
      if (wb.task != null) document.getElementById('s-task').value = wb.task;
      if (wb.grammar != null) document.getElementById('s-gram').value = wb.grammar;
      if (wb.vocab != null) document.getElementById('s-vocab').value = wb.vocab;
      if (wb.coherence != null) document.getElementById('s-cohe').value = wb.coherence;
      updateWritingScore();
    }
  } catch(e) { console.warn('[FluentPath] Could not parse writing breakdown:', e.message); }

  // Parse speaking breakdown JSON: { fluency:X, pron:X, vocab:X, comm:X, total:X }
  try {
    var sb = data.marks_speaking_breakdown ? JSON.parse(data.marks_speaking_breakdown) : null;
    if (sb) {
      if (sb.fluency != null) document.getElementById('sp-fluency').value = sb.fluency;
      if (sb.pron != null) document.getElementById('sp-pron').value = sb.pron;
      if (sb.vocab != null) document.getElementById('sp-vocab').value = sb.vocab;
      if (sb.comm != null) document.getElementById('sp-comm').value = sb.comm;
      updateSpeakingScore();
    }
  } catch(e) { console.warn('[FluentPath] Could not parse speaking breakdown:', e.message); }

  // Restore overall feedback
  if (data.marks_overall_feedback) {
    var el = document.getElementById('overall-feedback');
    if (el) el.value = data.marks_overall_feedback;
  }

  saveMarksToLocalStorage();
}

function saveMarksToLocalStorage() {
  try {
    var markState = {
      writingSliders: {
        task: parseInt(document.getElementById('s-task').value) || 0,
        grammar: parseInt(document.getElementById('s-gram').value) || 0,
        vocab: parseInt(document.getElementById('s-vocab').value) || 0,
        coherence: parseInt(document.getElementById('s-cohe').value) || 0,
      },
      speakingSliders: {
        fluency: parseInt(document.getElementById('sp-fluency').value) || 0,
        pron: parseInt(document.getElementById('sp-pron').value) || 0,
        vocab: parseInt(document.getElementById('sp-vocab').value) || 0,
        comm: parseInt(document.getElementById('sp-comm').value) || 0,
      },
      feedback: document.getElementById('overall-feedback')?.value || '',
      dayNumber: ex.markingData?.day_number || null,
    };
    localStorage.setItem('fp_lesson_marks', JSON.stringify(markState));
  } catch(e) {}
}

function restoreMarksFromLocalStorage() {
  try {
    var saved = localStorage.getItem('fp_lesson_marks');
    if (!saved) return;
    var ms = JSON.parse(saved);
    // Only restore if it's for the same day
    if (ms.dayNumber && ex.markingData && String(ms.dayNumber) !== String(ex.markingData.day_number)) return;

    if (ms.writingSliders) {
      if (ms.writingSliders.task != null) document.getElementById('s-task').value = ms.writingSliders.task;
      if (ms.writingSliders.grammar != null) document.getElementById('s-gram').value = ms.writingSliders.grammar;
      if (ms.writingSliders.vocab != null) document.getElementById('s-vocab').value = ms.writingSliders.vocab;
      if (ms.writingSliders.coherence != null) document.getElementById('s-cohe').value = ms.writingSliders.coherence;
      updateWritingScore();
    }
    if (ms.speakingSliders) {
      if (ms.speakingSliders.fluency != null) document.getElementById('sp-fluency').value = ms.speakingSliders.fluency;
      if (ms.speakingSliders.pron != null) document.getElementById('sp-pron').value = ms.speakingSliders.pron;
      if (ms.speakingSliders.vocab != null) document.getElementById('sp-vocab').value = ms.speakingSliders.vocab;
      if (ms.speakingSliders.comm != null) document.getElementById('sp-comm').value = ms.speakingSliders.comm;
      updateSpeakingScore();
    }
    if (ms.feedback) {
      var el = document.getElementById('overall-feedback');
      if (el) el.value = ms.feedback;
    }
  } catch(e) {}
}

function updateWritingScore() {
  const t = parseInt(document.getElementById('s-task').value);
  const g = parseInt(document.getElementById('s-gram').value);
  const v = parseInt(document.getElementById('s-vocab').value);
  const c = parseInt(document.getElementById('s-cohe').value);
  document.getElementById('v-task').innerHTML = t + ' <span>/ 8</span>';
  document.getElementById('v-gram').innerHTML = g + ' <span>/ 7</span>';
  document.getElementById('v-vocab').innerHTML = v + ' <span>/ 5</span>';
  document.getElementById('v-cohe').innerHTML = c + ' <span>/ 5</span>';
  const total = t + g + v + c;
  document.getElementById('writing-total').innerHTML = total + ' <span>/ 25</span>';
  document.getElementById('sum-writing').textContent = total + ' / 25';
  ex.writingScores = { task:t, grammar:g, vocab:v, coherence:c, total };
  updateSummaryTotal();
  saveMarksToLocalStorage();
}

function updateSpeakingScore() {
  const f = parseInt(document.getElementById('sp-fluency').value);
  const p = parseInt(document.getElementById('sp-pron').value);
  const v = parseInt(document.getElementById('sp-vocab').value);
  const c = parseInt(document.getElementById('sp-comm').value);
  document.getElementById('vsp-fluency').innerHTML = f + ' <span>/ 5</span>';
  document.getElementById('vsp-pron').innerHTML    = p + ' <span>/ 5</span>';
  document.getElementById('vsp-vocab').innerHTML   = v + ' <span>/ 5</span>';
  document.getElementById('vsp-comm').innerHTML    = c + ' <span>/ 5</span>';
  const total = f + p + v + c;
  document.getElementById('speaking-total').innerHTML = total + ' <span>/ 20</span>';
  document.getElementById('sum-speaking').textContent = total + ' / 20';
  ex.speakingScores = { fluency:f, pron:p, vocab:v, comm:c, total };
  updateSummaryTotal();
  saveMarksToLocalStorage();
}

function updateSummaryTotal() {
  const w = ex.writingScores.total || 0;
  const s = ex.speakingScores.total || 0;

  // Listening & comprehension auto-scores from student answers
  var lCorrect = 0, lTotal = 0, pCorrect = 0, pTotal = 0;
  if (ex.markingData && ex.markingData.parsedAnswers) {
    var a = ex.markingData.parsedAnswers;
    lCorrect = parseInt(a.listening_correct) || 0;
    lTotal   = parseInt(a.listening_total)   || 0;
    pCorrect = parseInt(a.practice_correct)  || 0;
    pTotal   = parseInt(a.practice_total)    || 0;
  }

  var sumListenEl = document.getElementById('sum-listening');
  var sumPracticeEl = document.getElementById('sum-practice');
  sumListenEl.textContent  = lTotal > 0 ? lCorrect + ' / ' + lTotal : '—';
  sumPracticeEl.textContent = pTotal > 0 ? pCorrect + ' / ' + pTotal : '—';

  var grandTotal = w + s + lCorrect + pCorrect;
  var grandMax   = 45 + lTotal + pTotal;
  document.getElementById('sum-total').innerHTML = grandTotal + ' <span style="font-size:14px;color:var(--gold);">/ ' + grandMax + '</span>';
}

// ══════════════════════════════════════════════════════
// WEEKLY SUMMARIES
// ══════════════════════════════════════════════════════
function showWeek(num) {
  ex.currentWeek = num;
  document.querySelectorAll('.wk-tab').forEach((t,i) => t.className = 'wk-tab' + (i+1===num?' active':''));
  document.getElementById('active-week-num').textContent = num;
  const days = [(num-1)*5+1, num*5];
  document.getElementById('week-days-label').textContent = days[0] + '–' + days[1];

  const saved = ex.weeklySummaries[num] || {};
  document.getElementById('week-summary-text').value     = saved.text || '';
  document.getElementById('wk-vocab-prog').value         = saved.vocab || 'Good';
  document.getElementById('wk-speak-prog').value         = saved.speaking || 'Good';
  document.getElementById('wk-write-prog').value         = saved.writing || 'Good';
  document.getElementById('wk-listen-prog').value        = saved.listening || 'Good';
}

function saveWeeklySummary() {
  const num = ex.currentWeek;
  ex.weeklySummaries[num] = {
    text: document.getElementById('week-summary-text').value,
    vocab: document.getElementById('wk-vocab-prog').value,
    speaking: document.getElementById('wk-speak-prog').value,
    writing: document.getElementById('wk-write-prog').value,
    listening: document.getElementById('wk-listen-prog').value,
  };
  saveToLocalStorage();
  showStatus('weekly-save-status', '✓ Week ' + num + ' summary saved.', false);
  updateSkillsSnapshot();
}

async function generateAISummary() {
  const num = ex.currentWeek;
  const btn = event.target;
  btn.textContent = '✨ Generating…';
  btn.disabled = true;

  const attendance = Object.entries(ex.attendance).filter(([k]) => {
    const d = parseInt(k.replace('day-',''));
    return d >= (num-1)*5+1 && d <= num*5;
  }).map(([k,v]) => v);
  const present = attendance.filter(v => v === 'present').length;

  const prompt = `You are a language teacher writing a brief end-of-week summary for a student.
Student: ${ex.studentName || 'the student'}
Level: ${ex.studentLevel}
Week: ${num} of 4 (Days ${(num-1)*5+1}–${num*5})
Days attended this week: ${present} of 5
Vocabulary progress: ${document.getElementById('wk-vocab-prog').value}
Speaking confidence: ${document.getElementById('wk-speak-prog').value}
Writing quality: ${document.getElementById('wk-write-prog').value}
Listening comprehension: ${document.getElementById('wk-listen-prog').value}
Teacher notes: ${document.getElementById('today-notes')?.value || 'none'}

Write a professional but warm 3-4 paragraph summary covering: what was achieved this week, key strengths observed, areas needing improvement, and a brief plan or encouragement for next week. Keep it practical and encouraging for an adult immigrant learner.`;

  try {
    // Route through Apps Script proxy to avoid CORS and keep API key server-side
    const data = await FP.api.postJson(WEBHOOK_URL + '?action=ai_summary', { prompt: prompt });
    const text = data.summary || data.text || '';
    if (!text) throw new Error('Empty response from AI proxy');
    document.getElementById('week-summary-text').value = text;
    showStatus('weekly-save-status', '✓ AI draft generated — review and save.', false);
  } catch(e) {
    console.warn('[FluentPath] AI summary generation failed:', e.message);
    showStatus('weekly-save-status', 'AI summary unavailable — the Apps Script proxy needs an ai_summary action. Write the summary manually for now.', true);
  }
  btn.textContent = '✨ AI Draft Summary'; btn.disabled = false;
}

// ══════════════════════════════════════════════════════
// DIFFICULTY
// ══════════════════════════════════════════════════════
function buildDifficultyGrid() {
  const grid = document.getElementById('diff-grid');
  grid.innerHTML = DIFF_AREAS.map(a => {
    const val = ex.difficultyProfile[a.key] || a.default;
    return `
      <div class="diff-adj-card">
        <div class="dac-label">${a.label}</div>
        <div class="dac-val" id="dv-${a.key}">${val} / 5</div>
        <input type="range" class="diff-range" min="${a.min}" max="${a.max}" step="1" value="${val}"
          oninput="updateDiff('${a.key}', this.value)" id="dr-${a.key}">
        <div class="diff-labels"><span>Easy</span><span>Hard</span></div>
        <div style="font-size:11px;color:var(--muted);font-style:italic;margin-top:6px;">${a.desc}</div>
      </div>`;
  }).join('');
}

function updateDiff(key, val) {
  document.getElementById(`dv-${key}`).textContent = val + ' / 5';
  ex.difficultyProfile[key] = parseInt(val);
}

function saveDifficulty() {
  saveToLocalStorage();
  syncDifficultyToSheet('diff-save-status', '✓ Difficulty profile saved. Applies to next lesson.');
}

function resetDifficulty() {
  ex.difficultyProfile = {};
  buildDifficultyGrid();
  saveToLocalStorage();
  syncDifficultyToSheet('diff-save-status', '✓ Reset to defaults.');
}

/** Build the difficulty payload that ships to the Settings sheet
 *  and is later read by apps-script when generating each lesson. */
function buildDifficultyJson() {
  return JSON.stringify({
    difficultyProfile: ex.difficultyProfile || {},
    focusTags: [...(ex.focusTags || [])],
    aiInstructions: ex.aiInstructions || ''
  });
}

/** POST the difficulty JSON to the Settings sheet via update_settings.
 *  apps-script merges this with the existing row, so unrelated fields
 *  (teacher_name, cefr_level, allow_spanish, …) are preserved. */
function syncDifficultyToSheet(statusId, successMsg) {
  if (!ex.studentName) {
    showStatus(statusId, successMsg + ' (not synced — no student selected)', false);
    return;
  }
  if (!WEBHOOK_URL || !WEBHOOK_URL.startsWith('https://')) {
    showStatus(statusId, successMsg + ' (saved locally only)', false);
    return;
  }
  FP.api.postForm(WEBHOOK_URL, {
    action: 'update_settings',
    student_name: ex.studentName,
    difficulty_json: buildDifficultyJson()
  }).then(function() {
    showStatus(statusId, successMsg, false);
  }).catch(function() {
    showStatus(statusId, successMsg + ' (saved locally; sheet sync failed)', true);
  });
}

function buildFocusTags() {
  const container = document.getElementById('focus-tags');
  container.innerHTML = FOCUS_OPTIONS.map(opt => `
    <button class="diff-btn ${ex.focusTags.has(opt) ? 'active' : ''}" onclick="toggleFocusTag('${escHtml(opt)}', this)">${escHtml(opt)}</button>
  `).join('');
}

function toggleFocusTag(tag, btn) {
  if (ex.focusTags.has(tag)) { ex.focusTags.delete(tag); btn.classList.remove('active'); btn.style.background='white'; btn.style.color='var(--muted)'; btn.style.borderColor='var(--rule)'; }
  else { ex.focusTags.add(tag); btn.style.background='var(--ink)'; btn.style.color='var(--paper)'; btn.style.borderColor='var(--ink)'; }
}

function saveFocusAreas() {
  ex.aiInstructions = document.getElementById('ai-instructions').value;
  saveToLocalStorage();
  syncDifficultyToSheet('focus-save-status', '✓ Focus areas saved. Applied to next AI lesson.');
}

// ══════════════════════════════════════════════════════
// PROGRESS
// ══════════════════════════════════════════════════════
function updateLessonRecord() {
  const container = document.getElementById('lesson-record-table');
  if (ex.lessonRecords.length === 0) {
    container.innerHTML = '<div style="font-size:14px;color:var(--muted);font-style:italic;">No marked lessons yet.</div>';
    return;
  }

  container.innerHTML = `
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead>
        <tr style="border-bottom:2px solid var(--rule);">
          <th style="text-align:left;padding:8px;font-size:9px;letter-spacing:0.2em;text-transform:uppercase;color:var(--muted);">Day</th>
          <th style="text-align:left;padding:8px;font-size:9px;letter-spacing:0.2em;text-transform:uppercase;color:var(--muted);">Topic</th>
          <th style="text-align:center;padding:8px;font-size:9px;letter-spacing:0.2em;text-transform:uppercase;color:var(--muted);">Warmup</th>
          <th style="text-align:center;padding:8px;font-size:9px;letter-spacing:0.2em;text-transform:uppercase;color:var(--muted);">Vocab</th>
          <th style="text-align:center;padding:8px;font-size:9px;letter-spacing:0.2em;text-transform:uppercase;color:var(--muted);">Listening</th>
          <th style="text-align:center;padding:8px;font-size:9px;letter-spacing:0.2em;text-transform:uppercase;color:var(--muted);">Practice</th>
          <th style="text-align:right;padding:8px;font-size:9px;letter-spacing:0.2em;text-transform:uppercase;color:var(--muted);">Writing</th>
          <th style="text-align:right;padding:8px;font-size:9px;letter-spacing:0.2em;text-transform:uppercase;color:var(--muted);">Speaking</th>
          <th style="text-align:center;padding:8px;font-size:9px;letter-spacing:0.2em;text-transform:uppercase;color:var(--muted);">Attend</th>
        </tr>
      </thead>
      <tbody>
        ${ex.lessonRecords.map(r => {
          var aj = {};
          try { if (r.answersJson) aj = JSON.parse(r.answersJson); } catch(e) {}
          var hasWarmup = !!(aj.warmup);
          var hasVocab = !!(aj.vocab_practice);
          var listenCell = '—';
          if (aj.listening_correct != null && aj.listening_total != null) {
            listenCell = aj.listening_correct + '/' + aj.listening_total;
          } else if (Object.keys(aj).some(function(k) { return k.startsWith('listening_'); })) {
            listenCell = '✓';
          }
          var practiceCell = '—';
          if (aj.practice_correct != null && aj.practice_total != null) {
            practiceCell = aj.practice_correct + '/' + aj.practice_total;
          } else if (Object.keys(aj).some(function(k) { return k.startsWith('practice_'); })) {
            practiceCell = '✓';
          }
          return `
          <tr style="border-bottom:1px solid var(--cream);">
            <td style="padding:8px;font-weight:600;">Day ${escHtml(String(r.day))}</td>
            <td style="padding:8px;font-style:italic;color:var(--muted);">${escHtml(r.topic || '—')}</td>
            <td style="padding:8px;text-align:center;">${hasWarmup ? '✓' : '—'}</td>
            <td style="padding:8px;text-align:center;">${hasVocab ? '✓' : '—'}</td>
            <td style="padding:8px;text-align:center;">${listenCell}</td>
            <td style="padding:8px;text-align:center;">${practiceCell}</td>
            <td style="padding:8px;text-align:right;">${r.writingScore != null ? r.writingScore + '/25' : '—'}</td>
            <td style="padding:8px;text-align:right;">${r.speakingScore != null ? r.speakingScore + '/20' : '—'}</td>
            <td style="padding:8px;text-align:center;"><span class="pill ${r.attended ? 'approved' : 'absent'}">${r.attended ? 'Present' : 'Absent'}</span></td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
}

function updateSkillsSnapshot() {
  const records = ex.lessonRecords.filter(r => r.writingScore != null);
  if (records.length === 0) return;
  const avgW = Math.round(records.reduce((a,r) => a+r.writingScore, 0) / records.length);
  const speakRecords = records.filter(r => r.speakingScore != null);
  const avgS = speakRecords.length > 0 ? Math.round(speakRecords.reduce((a,r) => a+r.speakingScore, 0) / speakRecords.length) : 0;
  const wPct = Math.round(avgW/25*100);
  const sPct = Math.round(avgS/20*100);

  // Estimate listening from weekly summary data (Excellent=90%, Good=70%, Needs Work=45%, Struggling=20%)
  var listenPct = 0;
  var listenCount = 0;
  var ratingMap = { 'Excellent': 90, 'Good': 70, 'Needs Work': 45, 'Struggling': 20 };
  Object.values(ex.weeklySummaries).forEach(function(wk) {
    if (wk.listening) { listenPct += (ratingMap[wk.listening] || 50); listenCount++; }
  });
  listenPct = listenCount > 0 ? Math.round(listenPct / listenCount) : 0;

  // Estimate vocabulary from weekly summary data
  var vocabPct = 0;
  var vocabCount = 0;
  Object.values(ex.weeklySummaries).forEach(function(wk) {
    if (wk.vocab) { vocabPct += (ratingMap[wk.vocab] || 50); vocabCount++; }
  });
  vocabPct = vocabCount > 0 ? Math.round(vocabPct / vocabCount) : wPct;

  document.getElementById('skill-vocab').style.width = vocabPct + '%';
  document.getElementById('skill-vocab-val').textContent = vocabPct + '%';
  document.getElementById('skill-speak').style.width = sPct + '%';
  document.getElementById('skill-speak-val').textContent = avgS + '/20 avg';
  document.getElementById('skill-write').style.width = wPct + '%';
  document.getElementById('skill-write-val').textContent = avgW + '/25 avg';
  document.getElementById('skill-listen').style.width = listenPct + '%';
  document.getElementById('skill-listen-val').textContent = listenPct > 0 ? listenPct + '%' : '—';
  document.getElementById('prog-avg-write').textContent = avgW;
  document.getElementById('prog-avg-speak').textContent = avgS;
}

// ══════════════════════════════════════════════════════
// EMAIL & SHEET
// ══════════════════════════════════════════════════════
function sendResultsEmail() {
  const email = document.getElementById('student-email').value.trim() || ex.studentEmail;
  if (!email) { showStatus('send-status', 'Enter student email.', true); return; }

  const w = ex.writingScores.total || 0;
  const s = ex.speakingScores.total || 0;
  const a = (ex.markingData && ex.markingData.parsedAnswers) || {};
  const lCorrect = parseInt(a.listening_correct) || 0;
  const lTotal   = parseInt(a.listening_total)   || 0;
  const pCorrect = parseInt(a.practice_correct)  || 0;
  const pTotal   = parseInt(a.practice_total)    || 0;
  const grandTotal = w + s + lCorrect + pCorrect;
  const grandMax   = 45 + lTotal + pTotal;
  const feedback = document.getElementById('overall-feedback')?.value || '';
  const name = ex.markingData?.student_name || ex.studentName;

  const body = `Dear ${name},

Here are your results for today's English lesson (Day ${ex.markingData?.day_number || '—'}):

LESSON RESULTS
──────────────────────────────
Writing Score:    ${w} / 25
Speaking Score:   ${s} / 20${lTotal > 0 ? '\nListening Score:  ' + lCorrect + ' / ' + lTotal : ''}${pTotal > 0 ? '\nComprehension:    ' + pCorrect + ' / ' + pTotal : ''}
──────────────────────────────
TOTAL:            ${grandTotal} / ${grandMax}

${feedback ? `TEACHER FEEDBACK\n──────────────────────────────\n${feedback}\n` : ''}

Keep up the great work! See you next lesson.

${ex.teacherName || 'Your Teacher'}`;

  window.open(`mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent('Your English Lesson Results · Day ' + (ex.markingData?.day_number||''))}&body=${encodeURIComponent(body)}`);
  showStatus('send-status', '✓ Email client opened. Click Send to deliver results.', false);
}

async function saveToSheet() {
  if (!WEBHOOK_URL || !WEBHOOK_URL.startsWith('https://')) {
    showStatus('sheet-status', 'No webhook configured. Add it in Student Profile.', true);
    return;
  }
  const w = ex.writingScores.total || 0;
  const s = ex.speakingScores.total || 0;
  const ans = (ex.markingData && ex.markingData.parsedAnswers) || {};
  const lCorrect = parseInt(ans.listening_correct) || 0;
  const lTotal   = parseInt(ans.listening_total)   || 0;
  const pCorrect = parseInt(ans.practice_correct)  || 0;
  const pTotal   = parseInt(ans.practice_total)    || 0;
  const grandTotal = w + s + lCorrect + pCorrect;
  const grandMax   = 45 + lTotal + pTotal;
  const payload = {
    action: 'save_marks',
    teacher_name: ex.teacherName,
    student_name: ex.studentName,
    lesson_date: ex.markingData?.lesson_date || new Date().toISOString().split('T')[0],
    day_number: ex.markingData?.day_number || getCurrentDay(),
    level: ex.studentLevel,
    writing_score: w + ' / 25',
    speaking_score: s + ' / 20',
    total_score: grandTotal + ' / ' + grandMax,
    writing_breakdown: JSON.stringify(ex.writingScores),
    speaking_breakdown: JSON.stringify(ex.speakingScores),
    overall_feedback: document.getElementById('overall-feedback')?.value || '',
    graded_at: new Date().toLocaleString(),
  };
  FP.showSaveOverlay('Saving lesson grades…');
  try {
    await FP.api.postForm(WEBHOOK_URL, payload);
    showStatus('sheet-status', '✓ Grades saved to Google Sheet.', false);
    invalidateSubmissionCache();

    // Update local record
    const day = ex.markingData?.day_number || getCurrentDay();
    const existing = ex.lessonRecords.find(r => r.day === day);
    if (existing) { existing.writingScore = w; existing.speakingScore = s; }
    else ex.lessonRecords.push({ day, topic: ex.markingData?.topic||'', writingScore:w, speakingScore:s, attended:true });
    saveToLocalStorage();
    updateLessonRecord();
    updateSkillsSnapshot();
    updateDashboardStats();
  } catch(e) {
    showStatus('sheet-status', '⚠ Could not reach sheet. Check webhook URL.', true);
  }
  FP.hideSaveOverlay();
}

// ══════════════════════════════════════════════════════
// TEACHER NOTES
// ══════════════════════════════════════════════════════
function saveTeacherNotes() {
  autoSave('today_notes', document.getElementById('today-notes').value);
  saveToLocalStorage();
  showStatus('notes-status', '✓ Notes saved.', false);
}

// ══════════════════════════════════════════════════════
// PROFILE
// ══════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════
// VIDEO CALL REQUESTS
// ══════════════════════════════════════════════════════

var callRequestsCache = [];

/** Load all pending/sent call requests — call this periodically or on demand. */
async function loadCallRequests() {
  if (!WEBHOOK_URL || !WEBHOOK_URL.includes('script.google.com')) return;
  try {
    var data = await FP.api.get(WEBHOOK_URL + '?action=get_call_requests');
    callRequestsCache = (data && data.requests) || [];
    renderDashboardCallRequests();
    renderProfileCallRequest();
  } catch (e) {
    console.warn('[FluentPath] Could not load call requests:', e.message);
  }
}

/** Render the pending-requests reminder on the Dashboard panel. */
function renderDashboardCallRequests() {
  var container = document.getElementById('dash-call-requests');
  if (!container) return;
  // Only show requests in pending status (not yet responded to)
  var pending = callRequestsCache.filter(function(r) { return r.status === 'pending'; });
  if (pending.length === 0) {
    container.style.display = 'none';
    container.innerHTML = '';
    return;
  }
  var items = pending.map(function(r) {
    var when = r.requested_at ? formatLessonDate(r.requested_at) : '';
    return '<li style="padding:6px 0;font-size:13px;">' +
      '<strong>' + escHtml(r.student_name) + '</strong>' +
      ' requested a call' + (r.page ? ' from ' + escHtml(r.page) : '') +
      (when ? ' · ' + escHtml(when) : '') +
      ' · <a href="#" onclick="event.preventDefault();switchToStudent(\'' + escHtml(r.student_name) + '\')" style="color:var(--blue);text-decoration:underline;">open dashboard</a>' +
      '</li>';
  }).join('');
  container.style.display = 'block';
  container.innerHTML =
    '<div class="card card-top blue" style="background:#eaf0fb;">' +
      '<div class="card-label" style="color:var(--blue);">📹 PENDING VIDEO CALL REQUESTS</div>' +
      '<ul style="margin:8px 0 0;padding-left:20px;">' + items + '</ul>' +
    '</div>';
}

/** Render the call request card inside the Student Profile panel for the current student. */
function renderProfileCallRequest() {
  var el = document.getElementById('prof-call-request-content');
  if (!el || !ex.studentName) return;
  var target = ex.studentName.toLowerCase().trim();
  var request = callRequestsCache.find(function(r) {
    return String(r.student_name || '').toLowerCase().trim() === target &&
      (r.status === 'pending' || r.status === 'sent');
  });

  if (!request) {
    el.innerHTML = 'No pending call request.';
    return;
  }

  var when = request.requested_at ? formatLessonDate(request.requested_at) : '';
  if (request.status === 'pending') {
    el.innerHTML =
      '<div style="color:var(--ink);font-style:normal;">' +
        '<p style="margin-bottom:12px;"><strong>' + escHtml(ex.studentName) + '</strong> requested a video call' +
          (when ? ' on ' + escHtml(when) : '') + '.</p>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">' +
          '<input type="text" id="call-link-input-' + escHtml(request.id) + '" placeholder="Paste Zoom/WhatsApp/Meet link" style="flex:1;min-width:240px;padding:8px 10px;border:1px solid var(--rule);font-size:13px;">' +
          '<button class="btn-primary" onclick="sendCallLink(\'' + escHtml(request.id) + '\')">Send Link</button>' +
          '<button class="btn-secondary" onclick="markCallDone(\'' + escHtml(request.id) + '\')">Mark as Done</button>' +
        '</div>' +
        '<div class="send-status" id="call-status-' + escHtml(request.id) + '"></div>' +
      '</div>';
  } else if (request.status === 'sent') {
    el.innerHTML =
      '<div style="color:var(--ink);font-style:normal;">' +
        '<p style="margin-bottom:8px;">✓ Call link sent to <strong>' + escHtml(ex.studentName) + '</strong>.</p>' +
        '<p style="font-size:12px;margin-bottom:12px;word-break:break-all;"><a href="' + escHtml(request.call_link) + '" target="_blank">' + escHtml(request.call_link) + '</a></p>' +
        '<button class="btn-secondary" onclick="markCallDone(\'' + escHtml(request.id) + '\')">Mark as Done</button>' +
        '<div class="send-status" id="call-status-' + escHtml(request.id) + '"></div>' +
      '</div>';
  }
}

async function sendCallLink(requestId) {
  var input = document.getElementById('call-link-input-' + requestId);
  var link = (input.value || '').trim();
  if (!link) { showStatus('call-status-' + requestId, 'Please paste a call link first.', true); return; }
  if (!/^https?:\/\//i.test(link)) { showStatus('call-status-' + requestId, 'Link must start with http:// or https://', true); return; }
  try {
    await FP.api.postForm(WEBHOOK_URL, { action: 'send_call_link', id: requestId, call_link: link });
    showStatus('call-status-' + requestId, '✓ Link sent to student.', false);
    setTimeout(loadCallRequests, 500);
  } catch (e) {
    showStatus('call-status-' + requestId, '⚠ Could not send: ' + e.message, true);
  }
}

async function markCallDone(requestId) {
  try {
    await FP.api.postForm(WEBHOOK_URL, { action: 'update_call_status', id: requestId, status: 'done' });
    setTimeout(loadCallRequests, 500);
  } catch (e) { /* silent */ }
}

async function promoteStudent() {
  var name = ex.studentName;
  if (!name) { showStatus('promote-status', 'No student selected.', true); return; }
  var newLevel = document.getElementById('prof-promote-level').value;
  if (!newLevel) { showStatus('promote-status', 'Select the new level.', true); return; }

  showStatus('promote-status', 'Promoting...', false);
  try {
    var result = await FP.api.postJson(
      WEBHOOK_URL + '?action=promote_student',
      { student_name: name, new_level: newLevel }
    );
    if (result && result.result === 'success') {
      ex.studentLevel = newLevel;
      document.getElementById('prof-level').value = newLevel;
      document.getElementById('sb-student-level').textContent = newLevel + ' · ' + getLevelTheme(newLevel);
      saveToLocalStorage();
      showStatus('promote-status', '✓ Promoted to Course ' + result.course_id + ' at level ' + newLevel + '.', false);
    } else {
      showStatus('promote-status', '⚠ ' + (result.message || 'Promotion failed.'), true);
    }
  } catch (e) {
    showStatus('promote-status', '⚠ Could not reach server: ' + e.message, true);
  }
}

function saveProfile() {
  const student = document.getElementById('prof-student-name').value.trim();
  const level   = document.getElementById('prof-level').value;
  if (!student) { showStatus('profile-save-status', 'Student name is required.', true); return; }
  if (!level)   { showStatus('profile-save-status', 'Student level is required.', true); return; }

  ex.studentName         = student;
  ex.studentEmail        = document.getElementById('prof-email').value;
  ex.studentLevel        = level;
  ex.studentMonth        = parseInt(document.getElementById('prof-month').value);
  ex.studentNotes        = document.getElementById('prof-notes').value;
  ex.allowSpanish        = document.getElementById('prof-allow-spanish').checked;
  ex.allowSkipTest       = document.getElementById('prof-allow-skip-test').checked;
  ex.allowRetakeTest     = document.getElementById('prof-allow-retake-test').checked;
  var grantAccessEl      = document.getElementById('prof-grant-access');
  ex.grantAccess         = grantAccessEl ? grantAccessEl.checked : ex.grantAccess;
  ex.teacherEmail        = document.getElementById('prof-teacher-email').value;
  ex.notifyOnTest        = document.getElementById('prof-notify-test').checked;
  ex.notifyOnSubmission  = document.getElementById('prof-notify-submission').checked;
  ex.notifyOnCallRequest = document.getElementById('prof-notify-call').checked;

  saveToLocalStorage();
  document.getElementById('sb-student-name').textContent = ex.studentName || 'No student yet';
  document.getElementById('sb-student-level').textContent = ex.studentLevel + ' · ' + getLevelTheme(ex.studentLevel);
  showStatus('profile-save-status', '✓ Profile saved.', false);

  // Sync settings to Google Sheet
  if (WEBHOOK_URL && WEBHOOK_URL.startsWith('https://')) {
    FP.api.postForm(WEBHOOK_URL, {
      action: 'update_settings',
      student_name: ex.studentName,
      teacher_name: ex.teacherName,
      cefr_level: ex.studentLevel,
      allow_spanish: ex.allowSpanish,
      allow_skip_test: ex.allowSkipTest,
      allow_retake_test: ex.allowRetakeTest,
      access_granted: ex.grantAccess,
      course_month: ex.studentMonth,
      notes: ex.studentNotes,
      difficulty_json: buildDifficultyJson(),
      teacher_email: ex.teacherEmail || '',
      student_email: ex.studentEmail || '',
      notify_on_test: ex.notifyOnTest || false,
      notify_on_submission: ex.notifyOnSubmission || false,
      notify_on_call_request: ex.notifyOnCallRequest !== false,
    }).catch(function() {
      showStatus('profile-save-status', 'Saved locally. Could not sync to Google Sheet.', true);
    });
  }
}

async function exportProfile(format) {
  var name = ex.studentName;
  if (!name) { showStatus('profile-save-status', 'No student selected.', true); return; }
  showStatus('profile-save-status', 'Generating report...', false);

  var report = null;
  // Try fetching a full report from the server
  if (WEBHOOK_URL && WEBHOOK_URL.includes('script.google.com')) {
    try {
      report = await FP.api.get(WEBHOOK_URL + '?action=get_student_report&student=' + encodeURIComponent(name), { timeout: 30000 });
    } catch (e) { /* fallback to local data */ }
  }

  // Fallback: local data if server unavailable
  if (!report || !report.found) {
    report = {
      student: name,
      generated_at: new Date().toISOString(),
      settings: { cefr_level: ex.studentLevel },
      attendance: { attendance_json: JSON.stringify(ex.attendance) },
      course_progress: { submissions: ex.lessonRecords },
      marks: [],
      placement_test: {},
    };
  }

  var safeName = (name || 'student').replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-]/g, '');
  var dateStr = new Date().toISOString().split('T')[0];

  if (format === 'csv') {
    downloadReportCSV(report, safeName, dateStr);
  } else {
    downloadReportJSON(report, safeName, dateStr);
  }
  showStatus('profile-save-status', '✓ Report downloaded.', false);
}

function downloadReportJSON(report, safeName, dateStr) {
  var blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'fluentpath-' + safeName + '-' + dateStr + '.json';
  a.click();
}

function downloadReportCSV(report, safeName, dateStr) {
  var rows = [['Section', 'Field', 'Value']];

  // Student info
  rows.push(['Student', 'Name', report.student || '']);
  rows.push(['Student', 'Generated', report.generated_at || '']);
  if (report.settings) {
    rows.push(['Settings', 'CEFR Level', report.settings.cefr_level || '']);
    rows.push(['Settings', 'Allow Spanish', String(report.settings.allow_spanish || false)]);
  }

  // Placement test
  if (report.placement_test && report.placement_test.found) {
    var pt = report.placement_test;
    rows.push(['Placement Test', 'Reading Score', pt.reading_score || '']);
    rows.push(['Placement Test', 'Listening Score', pt.listening_score || '']);
    rows.push(['Placement Test', 'Writing Score', pt.writing_score || '']);
    rows.push(['Placement Test', 'Speaking Score', pt.speaking_score || '']);
    rows.push(['Placement Test', 'Total', pt.total_score || '']);
    rows.push(['Placement Test', 'CEFR Level', pt.cefr_level || '']);
  }

  // Course progress (submissions)
  var subs = (report.course_progress && report.course_progress.submissions) || [];
  subs.forEach(function(s) {
    rows.push(['Lesson', 'Day ' + (s.day_number || s.day || '?'), 'Topic: ' + (s.topic || '')]);
  });

  // Marks
  var marks = report.marks || [];
  marks.forEach(function(m) {
    rows.push(['Marks', 'Day ' + (m.day_number || '?'), 'Writing: ' + (m.writing_score || '-') + ', Speaking: ' + (m.speaking_score || '-')]);
  });

  // Build CSV string
  var csv = rows.map(function(r) {
    return r.map(function(cell) {
      var s = String(cell).replace(/"/g, '""');
      return '"' + s + '"';
    }).join(',');
  }).join('\n');

  var blob = new Blob([csv], { type: 'text/csv' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'fluentpath-' + safeName + '-' + dateStr + '.csv';
  a.click();
}

// ══════════════════════════════════════════════════════
// LOCAL STORAGE
// ══════════════════════════════════════════════════════
function autoSave(key, value) {
  try { localStorage.setItem('fp_' + key, value); } catch(e) {}
}

function saveToLocalStorage() {
  try {
    const toSave = {
      teacherName: ex.teacherName,
      studentName: ex.studentName, studentLevel: ex.studentLevel,
      studentMonth: ex.studentMonth, studentEmail: ex.studentEmail,
      studentNotes: ex.studentNotes,
      allowSpanish: ex.allowSpanish, allowSkipTest: ex.allowSkipTest, allowRetakeTest: ex.allowRetakeTest,
      webhook: WEBHOOK_URL,
      attendance: ex.attendance, weeklySummaries: ex.weeklySummaries,
      difficultyProfile: ex.difficultyProfile, lessonRecords: ex.lessonRecords,
      aiInstructions: ex.aiInstructions, focusTags: [...ex.focusTags],
      ptGraded: ex.ptGraded || null,
      teacherEmail: ex.teacherEmail, notifyOnTest: ex.notifyOnTest, notifyOnSubmission: ex.notifyOnSubmission, notifyOnCallRequest: ex.notifyOnCallRequest,
    };
    localStorage.setItem('fluentpath_teacher', JSON.stringify(toSave));
  } catch(e) {}
}

function savePTGradedState() {
  ex.ptGraded = {
    ptScores: JSON.parse(JSON.stringify(ptScores)),
    sliders: {},
    subCriteria: {},
    notes: {},
    feedback: document.getElementById('pt-overall-feedback')?.value || '',
  };
  // Save manual slider values (Q11-Q13, Q20-Q24)
  ['q11','q12','q13','q20','q21','q22','q23','q24'].forEach(function(q) {
    var el = document.getElementById('pt-slider-' + q);
    if (el) ex.ptGraded.sliders[q] = parseFloat(el.value);
  });
  // Save Q14 sub-criteria
  ['task','grammar','vocab','coherence'].forEach(function(f) {
    var el = document.getElementById('pt-sc-' + f);
    if (el) ex.ptGraded.subCriteria[f] = parseFloat(el.value);
  });
  // Save notes
  ['q11','q12','q13','q14','q21','q22','q23','q24'].forEach(function(q) {
    var el = document.getElementById('pt-notes-' + q);
    if (el) ex.ptGraded.notes[q] = el.value;
  });
  saveToLocalStorage();
}

function restorePTGradedState() {
  var g = ex.ptGraded;
  if (!g) return false;

  _ptRestoring = true;

  // Restore ptScores
  if (g.ptScores) {
    Object.assign(ptScores, g.ptScores);
  }

  // Restore manual sliders and their displays (only fill in values not already set by sheet)
  if (g.sliders) {
    Object.entries(g.sliders).forEach(function(entry) {
      var q = entry[0], val = entry[1];
      var slider = document.getElementById('pt-slider-' + q);
      var disp = document.getElementById('pt-disp-' + q);
      var current = slider ? parseFloat(slider.value) : 0;
      if (current === 0 && parseFloat(val) !== 0) {
        if (slider) slider.value = val;
        ptScores[q] = parseFloat(val);
      }
      if (disp) {
        var score = ptScores[q] || parseFloat(val);
        var max = slider ? parseInt(slider.max) : 5;
        disp.innerHTML = score + ' <span>/ ' + max + '</span>';
      }
    });
  }

  // Restore Q14 sub-criteria (only if not already set)
  if (g.subCriteria) {
    var anySet = false;
    Object.entries(g.subCriteria).forEach(function(entry) {
      var f = entry[0], val = entry[1];
      var el = document.getElementById('pt-sc-' + f);
      if (el && parseFloat(el.value) === 0 && parseFloat(val) !== 0) {
        el.value = val;
        anySet = true;
      }
    });
    if (anySet) updatePTSubCriteria();
  }

  // Restore notes (only if the textarea is empty; skip corrupted numeric-only values)
  if (g.notes) {
    Object.entries(g.notes).forEach(function(entry) {
      var q = entry[0], val = entry[1];
      if (!val || /^\d+(\.\d+)?$/.test(val.trim())) return; // skip empty or bare numbers
      var el = document.getElementById('pt-notes-' + q);
      if (el && !el.value) el.value = val;
    });
  }

  // Restore overall feedback (only if empty)
  if (g.feedback) {
    var el = document.getElementById('pt-overall-feedback');
    if (el && !el.value) el.value = g.feedback;
  }

  _ptRestoring = false;
  updatePTResults();
  savePTGradedState();
  return true;
}

function loadFromLocalStorage() {
  try {
    const saved = localStorage.getItem('fluentpath_teacher');
    if (!saved) return false;
    const data = JSON.parse(saved);
    Object.assign(ex, data);
    ex.focusTags = new Set(data.focusTags || []);
    return true;
  } catch(e) { return false; }
}

// ══════════════════════════════════════════════════════
// UTILS
// ══════════════════════════════════════════════════════
function showStatus(id, msg, isError) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.className = 'send-status' + (isError ? ' err' : ' ok');
  el.style.display = 'block';
  if (!isError) setTimeout(() => el.style.display = 'none', 4000);
}


// ══════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════
window.addEventListener('DOMContentLoaded', () => {
  // Teacher session guard — the dashboard was previously protected only by
  // being unlinked. Require a teacher session or bounce to the login portal.
  if (!(FP.getSession && FP.getSession()) || localStorage.getItem(FP.KEYS.ROLE) !== 'teacher') {
    location.href = '../teacher.html';
    return;
  }

  const hasSaved = loadFromLocalStorage();

  // Always use hardcoded teacher name
  ex.teacherName = 'Sebastian Galindo';

  // Check URL param for student name (from teacher.html student picker)
  var urlParams = new URLSearchParams(window.location.search);
  var urlStudent = (urlParams.get('student') || '').trim();

  if (urlStudent) {
    // Student selected from teacher portal or class overview — go straight to dashboard
    // Always reset student-specific state when loading via URL param to ensure clean data
    resetStudentState(urlStudent);
    panelLoaded = {}; // force all panels to reload for the new student
    saveToLocalStorage();
    initApp();
  } else if (hasSaved && ex.studentName) {
    // Returning visit with saved student data
    initApp();
  }
  // Otherwise the setup screen stays visible (fallback)
  if (ex.studentName) document.getElementById('setup-student').value = ex.studentName;
});


// ══════════════════════════════════════════════════════
// LESSON LIBRARY PANEL
// ══════════════════════════════════════════════════════
var libData = null; // cached get_library response

function loadLibraryPanel() {
  if (!WEBHOOK_URL || !WEBHOOK_URL.startsWith('https://')) {
    document.getElementById('lib-grid-container').innerHTML =
      '<div style="color:var(--muted);font-style:italic;">Webhook not configured — library unavailable offline.</div>';
    return;
  }
  document.getElementById('lib-grid-container').innerHTML =
    '<div style="font-size:14px;color:var(--muted);font-style:italic;">Loading…</div>';

  FP.api.get(WEBHOOK_URL + '?action=get_library', { timeout: 30000 })
    .then(function(data) {
      libData = data;
      renderLibraryStats(data);
      renderLibraryGrid(data);
      updateDashboardLibraryBadge(data.totalEntries || 0, data.totalRecycled || 0);
    })
    .catch(function(err) {
      document.getElementById('lib-grid-container').innerHTML =
        '<div style="color:var(--rust);font-style:italic;">Failed to load library: ' + escHtml(err.message) + '</div>';
    });
}

function renderLibraryStats(data) {
  var seeded = (data.groups || []).filter(function(g) { return g.count >= 5; }).length;
  var tEl = document.getElementById('lib-stat-total');
  var rEl = document.getElementById('lib-stat-recycled');
  var sEl = document.getElementById('lib-stat-seeded');
  if (tEl) tEl.textContent = data.totalEntries  || 0;
  if (rEl) rEl.textContent = data.totalRecycled || 0;
  if (sEl) sEl.textContent = seeded;
}

function renderLibraryGrid(data) {
  var groupMap = {};
  (data.groups || []).forEach(function(g) { groupMap[g.level + '_' + g.day] = g; });

  var LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  var html = '';
  LEVELS.forEach(function(level) {
    html += '<div class="lib-level-label">' + escHtml(level) + '</div>';
    html += '<div class="lib-day-grid">';
    for (var d = 1; d <= 20; d++) {
      var g     = groupMap[level + '_' + d];
      var count = g ? g.count : 0;
      var cls   = count === 0 ? 'lib-cell-0' : count < 5 ? 'lib-cell-1' : count < 10 ? 'lib-cell-5' : 'lib-cell-10';
      var title = escHtml(level) + ' Day ' + d + ': ' + count + ' entr' + (count === 1 ? 'y' : 'ies');
      html += '<div class="lib-cell ' + cls + '" title="' + title + '"' +
              ' onclick="openLibraryCell(\'' + escHtml(level) + '\',' + d + ')">' + count + '</div>';
    }
    html += '</div>';
  });
  document.getElementById('lib-grid-container').innerHTML = html;
}

function openLibraryCell(level, day) {
  var groupMap = {};
  if (libData && libData.groups) {
    libData.groups.forEach(function(g) { groupMap[g.level + '_' + g.day] = g; });
  }
  var g       = groupMap[level + '_' + day];
  var content = document.getElementById('lib-modal-content');

  var html = '<div class="panel-eyebrow" style="margin-bottom:4px;">LESSON LIBRARY</div>' +
    '<div style="font-family:\'Playfair Display\',serif;font-size:24px;font-weight:700;margin-bottom:4px;">' +
    escHtml(level) + ' &middot; Day ' + day + '</div>';

  if (!g || g.entries.length === 0) {
    html += '<div style="font-size:14px;color:var(--muted);font-style:italic;margin-top:16px;">No entries yet for this day.</div>';
  } else {
    html += '<div style="font-size:13px;color:var(--muted);margin-bottom:18px;">' +
      g.entries.length + ' entr' + (g.entries.length === 1 ? 'y' : 'ies') + '</div>';

    g.entries.forEach(function(entry) {
      var shortId = String(entry.id).replace('lib_', '').slice(0, 20);
      var badge   = entry.times_served > 0
        ? '<span class="lib-recycled-badge">&#9851; served ' + entry.times_served + '&times;</span>'
        : '';
      var diffParsed = null;
      try { if (entry.original_difficulty_json) diffParsed = JSON.parse(entry.original_difficulty_json); } catch (e) {}
      var diffStr = (diffParsed && diffParsed.difficultyProfile && Object.keys(diffParsed.difficultyProfile).length > 0)
        ? Object.keys(diffParsed.difficultyProfile).map(function(k) {
            return k.replace(/_/g,' ') + ':' + diffParsed.difficultyProfile[k];
          }).join(' &middot; ')
        : 'default difficulty';
      var safeId = escHtml(entry.id);

      html += '<div class="lib-entry-row" id="entry-' + safeId + '">' +
        '<div class="lib-entry-meta">' +
          '<div class="lib-entry-id">' + escHtml(shortId) + badge + '</div>' +
          '<div class="lib-entry-detail">Source: ' + escHtml(entry.source_student || '—') +
            ' &nbsp;·&nbsp; Created: ' + escHtml(String(entry.created_at || '').slice(0, 10)) + '</div>' +
          '<div class="lib-entry-detail" style="font-size:10px;margin-top:2px;">' + diffStr + '</div>' +
          '<div id="preview-' + safeId + '" style="display:none;"></div>' +
        '</div>' +
        '<div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0;">' +
          '<button class="btn-preview" onclick="toggleLibraryPreview(\'' + safeId + '\')" style="font-size:11px;padding:6px 12px;">Preview</button>' +
          '<button class="btn-reject" onclick="deleteLibraryEntry(\'' + safeId + '\',\'' + escHtml(level) + '\',' + day + ')" style="font-size:11px;padding:6px 12px;">Delete</button>' +
        '</div>' +
      '</div>';
    });
  }

  content.innerHTML = html;
  document.getElementById('lib-modal').classList.add('open');
}

function toggleLibraryPreview(entryId) {
  var box = document.getElementById('preview-' + entryId);
  if (!box) return;
  if (box.style.display !== 'none') { box.style.display = 'none'; return; }

  box.innerHTML = '<div style="font-size:12px;color:var(--muted);font-style:italic;margin-top:8px;">Loading…</div>';
  box.style.display = 'block';

  var url = WEBHOOK_URL + '?action=get_library_entry&id=' + encodeURIComponent(entryId);
  FP.api.get(url, { timeout: 20000 })
    .then(function(data) {
      if (!data || !data.found || !data.entry) {
        box.innerHTML = '<div style="color:var(--rust);font-size:12px;margin-top:8px;">Entry not found.</div>';
        return;
      }
      var lesson = null;
      try { lesson = JSON.parse(data.entry.lesson_json || ''); } catch (e) {}
      if (!lesson) {
        box.innerHTML = '<div style="color:var(--rust);font-size:12px;margin-top:8px;">Could not parse lesson JSON.</div>';
        return;
      }
      var preview = {
        topic: lesson.topic, objective: lesson.objective,
        warmup: lesson.warmup && lesson.warmup.prompt,
        vocabulary: lesson.vocabulary && (lesson.vocabulary.words || []).map(function(w){ return w.word; }).join(', '),
        speaking: lesson.speaking && lesson.speaking.conversationPrompt,
        writing: lesson.writing && { prompt: lesson.writing.prompt, minWords: lesson.writing.minWords },
        review: lesson.review && lesson.review.keyTakeaways
      };
      box.innerHTML = '<div class="lib-preview-box">' + escHtml(JSON.stringify(preview, null, 2)) + '</div>';
    })
    .catch(function(err) {
      box.innerHTML = '<div style="color:var(--rust);font-size:12px;margin-top:8px;">Failed to load: ' + escHtml(err.message) + '</div>';
    });
}

function deleteLibraryEntry(entryId, level, day) {
  if (!confirm('Soft-delete this lesson from the library?\n\nIt will no longer be served to students. Recoverable by editing the sheet directly (set is_active back to "true").')) return;

  FP.api.postForm(WEBHOOK_URL, { action: 'delete_library_entry', id: entryId })
    .then(function() {
      // Update local cache so the modal and grid refresh immediately
      if (libData && libData.groups) {
        libData.groups.forEach(function(g) {
          if (g.level === level && g.day === day) {
            g.entries = g.entries.filter(function(e) { return e.id !== entryId; });
            g.count   = g.entries.length;
          }
        });
        libData.totalEntries = Math.max(0, (libData.totalEntries || 1) - 1);
      }
      openLibraryCell(level, day);
      renderLibraryStats(libData || {});
      renderLibraryGrid(libData || { groups: [] });
      updateDashboardLibraryBadge(
        (libData && libData.totalEntries)  || 0,
        (libData && libData.totalRecycled) || 0
      );
    })
    .catch(function(err) { alert('Delete failed: ' + escHtml(err.message)); });
}

function closeLibraryModal() {
  document.getElementById('lib-modal').classList.remove('open');
}

function updateDashboardLibraryBadge(total, recycled) {
  var tEl = document.getElementById('dash-lib-total');
  var rEl = document.getElementById('dash-lib-recycled');
  if (tEl) tEl.textContent = total;
  if (rEl) rEl.textContent = recycled;
}

// ══════════════════════════════════════════════════════
// KEYBOARD SHORTCUTS
// ══════════════════════════════════════════════════════
document.addEventListener('keydown', function(e) {
  // Only handle when the marking panel is active
  var markingPanel = document.getElementById('panel-marking');
  if (!markingPanel || !markingPanel.classList.contains('active')) return;

  // Ctrl+S or Cmd+S → save grades to sheet
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    saveToSheet();
  }

  // Ctrl+→ or Cmd+→ → next ungraded
  if ((e.ctrlKey || e.metaKey) && e.key === 'ArrowRight') {
    e.preventDefault();
    goNextUngraded();
  }
});
