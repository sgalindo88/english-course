// ══════════════════════════════════════════════════════
// CONFIG — teacher sets these
// ══════════════════════════════════════════════════════
const GOOGLE_SHEET_WEBHOOK = FP.WEBHOOK_URL;

// ══════════════════════════════════════════════════════
// STATE
// ══════════════════════════════════════════════════════
let state = {
  studentName: '',
  teacherCode: '',
  level: null,
  lessonDate: '',
  dayNumber: 1,
  lessonContent: null,   // AI-generated lesson plan
  steps: [],
  currentStep: 0,
  startTime: null,
  answers: {},           // student responses per step
  timerInterval: null,
  timeElapsed: 0,        // seconds
  pollInterval: null,
  approved: false,
};

const LESSON_DURATION = FP.LESSON_DURATION_MIN * 60; // seconds

const LEVEL_THEMES = {
  A1: { name: 'Beginner', theme: 'Everyday Survival', color: '#2e6e45' },
  A2: { name: 'Elementary', theme: 'Community & Life', color: '#1e4d8c' },
  B1: { name: 'Intermediate', theme: 'The Workplace', color: '#7b3fa0' },
  B2: { name: 'Upper-Intermediate', theme: 'Career & Society', color: '#b8471e' },
  C1: { name: 'Advanced', theme: 'Professional Mastery', color: '#c9933a' },
  C2: { name: 'Proficiency', theme: 'Full Fluency', color: '#1a1208' },
};

// Step types for a full 90-min lesson
const STEP_STRUCTURE = [
  { type: 'warmup',      label: 'WARM-UP',       title: 'Let\'s Get Started',       duration: 10 },
  { type: 'vocabulary',  label: 'VOCABULARY',     title: 'New Words Today',          duration: 20 },
  { type: 'listening',   label: 'LISTENING',      title: 'Listen & Understand',      duration: 15 },
  { type: 'speaking',    label: 'PRONUNCIATION',  title: 'Speak & Be Understood',    duration: 20 },
  { type: 'practice',    label: 'PRACTICE',       title: 'Put It All Together',      duration: 15 },
  { type: 'writing',     label: 'WRITING',        title: 'Write It Down',            duration: 15 },
  { type: 'review',      label: 'REVIEW',         title: 'What Did You Learn?',      duration: 5  },
];

// ══════════════════════════════════════════════════════
// CHECKPOINT (session recovery)
// ══════════════════════════════════════════════════════
const CKPT_KEY = 'lesson';
let ckptInterval = null;

function saveLessonCheckpoint() {
  if (!state.lessonContent || !state.steps.length) return;
  // Collect current textarea values from the DOM
  const domAnswers = Object.assign({}, state.answers);
  var wr = document.getElementById('writing-resp');
  if (wr) domAnswers['writing'] = wr.value;
  var rn = document.getElementById('review-notes');
  if (rn) domAnswers['review_notes'] = rn.value;

  Checkpoint.save(CKPT_KEY, {
    studentName: state.studentName,
    level: state.level,
    lessonDate: state.lessonDate,
    dayNumber: state.dayNumber,
    lessonContent: state.lessonContent,
    currentStep: state.currentStep,
    answers: domAnswers,
    timeElapsed: state.timeElapsed,
  });
}

function startLessonAutoSave() {
  if (ckptInterval) return;
  saveLessonCheckpoint();
  ckptInterval = setInterval(saveLessonCheckpoint, 5000);
}

function clearLessonCheckpoint() {
  if (ckptInterval) { clearInterval(ckptInterval); ckptInterval = null; }
  Checkpoint.clear(CKPT_KEY);
}

function tryResumeLesson() {
  var data = Checkpoint.load(CKPT_KEY);
  if (!data || !data.lessonContent) return;
  Checkpoint.showRecoveryModal({
    title: 'Resume Your Lesson?',
    titleEs: '¿Continuar tu Lección?',
    message: 'You have an unfinished lesson (Day ' + data.dayNumber + '). Would you like to pick up where you left off?',
    messageEs: 'Tienes una lección sin terminar (Día ' + data.dayNumber + '). ¿Quieres continuar donde lo dejaste?',
    savedAt: data._savedAt,
    onResume: function() {
      lessonInProgress = true;
      // Restore state
      state.studentName = data.studentName;
      state.level = data.level;
      state.lessonDate = data.lessonDate;
      state.dayNumber = data.dayNumber;
      state.lessonContent = data.lessonContent;
      state.answers = data.answers || {};
      state.timeElapsed = data.timeElapsed || 0;
      state.approved = true;
      state.startTime = new Date(Date.now() - (state.timeElapsed * 1000));

      // Rebuild steps and set position
      state.steps = buildSteps(state.lessonContent);
      state.currentStep = Math.min(data.currentStep || 0, state.steps.length - 1);

      // Show lesson screen and start
      showScreen('screen-lesson');
      var info = LEVEL_THEMES[state.level] || { theme: '' };
      document.getElementById('navInfo').textContent = state.level + ' · ' + info.theme;
      document.getElementById('navDay').textContent = 'Day ' + state.dayNumber + ' / ' + FP.COURSE_DAYS;
      document.getElementById('navDay').style.display = 'block';
      document.getElementById('navTimer').style.display = 'block';
      document.getElementById('lessonLabel').textContent = 'Day ' + state.dayNumber + ' · ' + state.level + ' · ' + info.theme;

      // Resume timer from saved elapsed time
      startTimer(data.timeElapsed || 0);

      buildStepDots();
      renderStep();
      document.getElementById('lessonNav').style.display = '';
      startLessonAutoSave();

      // Update button text
      if (state.currentStep === state.steps.length - 1) {
        document.getElementById('btnNext').textContent = tr('Finish Lesson ✓');
      }
    },
    onStartOver: function() {
      clearLessonCheckpoint();
    }
  });
}

// ══════════════════════════════════════════════════════
// SCREEN CONTROL
// ══════════════════════════════════════════════════════
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ══════════════════════════════════════════════════════
// LEVEL SELECTION
// ══════════════════════════════════════════════════════
function selectLevel(card) {
  document.querySelectorAll('.level-card').forEach(c => c.classList.remove('selected'));
  card.classList.add('selected');
  state.level = card.dataset.level;

  // Update translation mode for the selected level
  if (typeof I18n !== 'undefined') I18n.setLevel(state.level);

}

function lockLevelGrid(levelCode) {
  // Disable clicking on all level cards
  document.querySelectorAll('.level-card').forEach(function(c) {
    c.onclick = null;
    c.style.cursor = 'default';
    if (c.dataset.level !== levelCode) {
      c.style.opacity = '0.3';
      c.style.pointerEvents = 'none';
    }
  });
  // Update instruction text
  var info = LEVEL_THEMES[levelCode] || {};
  document.getElementById('levelInstruction').innerHTML =
    'Your level: <strong>' + levelCode + ' · ' + (info.name || '') + '</strong>' +
    '<span style="display:block;margin-top:4px;font-size:11px;color:var(--rule);">Assigned by your teacher. Contact them if this needs to change.</span>';
}

// ══════════════════════════════════════════════════════
// START COURSE
// ══════════════════════════════════════════════════════
async function startCourse() {
  const name = document.getElementById('studentName').value.trim();
  if (!name) { alert('Please enter your name.'); return; }
  if (!state.level) { alert('Please select your level.'); return; }

  state.studentName = name;
  state.lessonDate  = document.getElementById('lessonDate').value || new Date().toISOString().split('T')[0];

  // Calculate course day (next day after last completed)
  state.dayNumber = getCourseDay();

  // Go straight to lesson generation
  beginLesson();
}

function getCourseDay() {
  // Use last completed day from localStorage + 1, capped at 20
  var last = parseInt(localStorage.getItem('fp_last_lesson_day') || '0', 10);
  return Math.min(last + 1, FP.COURSE_DAYS);
}

// ══════════════════════════════════════════════════════
// BEGIN LESSON — fetch AI content and render
// ══════════════════════════════════════════════════════
// ── beforeunload — warn when lesson is in progress ──
var lessonInProgress = false;
function onBeforeUnload(e) { if (lessonInProgress) { e.preventDefault(); } }
window.addEventListener('beforeunload', onBeforeUnload);

async function beginLesson() {
  lessonInProgress = true;
  showScreen('screen-lesson');
  state.startTime = new Date();
  startTimer();

  // Video call already initialized on the landing screen in required mode

  // Update nav
  const info = LEVEL_THEMES[state.level];
  document.getElementById('navInfo').textContent = `${state.level} · ${info.theme}`;
  document.getElementById('navDay').textContent = `Day ${state.dayNumber} / ${FP.COURSE_DAYS}`;
  document.getElementById('navDay').style.display = 'block';
  document.getElementById('navTimer').style.display = 'block';
  document.getElementById('lessonLabel').textContent = `Day ${state.dayNumber} · ${state.level} · ${info.theme}`;

  // Fetch AI lesson content with a 45-second safety timeout
  document.getElementById('activityWrap').innerHTML = '<div class="spinner"></div><p style="text-align:center;color:var(--muted);font-style:italic;margin-top:16px;">Loading your personalised lesson…</p>';

  var lessonTimeout = setTimeout(function() {
    document.getElementById('activityWrap').innerHTML =
      '<div style="text-align:center;padding:40px;">' +
      '<p style="color:var(--rust);font-weight:600;margin-bottom:12px;">Lesson is taking longer than expected.</p>' +
      '<p style="color:var(--muted);font-size:14px;margin-bottom:20px;">Using a built-in lesson instead.</p>' +
      '</div>';
  }, 45000);

  const lessonData = await generateLesson();
  clearTimeout(lessonTimeout);
  state.lessonContent = lessonData;
  state.steps = buildSteps(lessonData);
  state.currentStep = 0;

  buildStepDots();
  renderStep();
  document.getElementById('lessonNav').style.display = '';
  startLessonAutoSave();
}

// ══════════════════════════════════════════════════════
// AI LESSON GENERATION
// Calls the Apps Script proxy (which calls the AI provider) to generate a fresh lesson
// per (level, day). Cached in localStorage so reloads don't waste API calls.
// Falls back to a varied offline library if anything goes wrong.
// ══════════════════════════════════════════════════════
async function generateLesson() {
  const topicHints = getTopicForDay(state.level, state.dayNumber);
  const cacheKey = 'fp_lesson_' + state.level + '_d' + state.dayNumber;
  const isSpanishLevel = (state.level === 'A1' || state.level === 'A2');

  // 1. Cache check — never re-generate the same day twice
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed && parsed.topic) {
        console.log('[FluentPath] Using cached lesson for', cacheKey);
        return parsed;
      }
    }
  } catch (_) { /* ignore parse errors */ }

  // 2. Call Apps Script → AI provider
  // Passing the student name lets apps-script fold the teacher's
  // difficulty profile, focus areas, and AI instructions into the prompt.
  try {
    const url = GOOGLE_SHEET_WEBHOOK + '?' + [
      'action=generate_lesson',
      'level=' + encodeURIComponent(state.level),
      'day=' + encodeURIComponent(state.dayNumber),
      'topic=' + encodeURIComponent(topicHints.topic),
      'spanish=' + (isSpanishLevel ? 'true' : 'false'),
      'student=' + encodeURIComponent(state.studentName || '')
    ].join('&');

    const data = await FP.api.get(url, { timeout: 60000 });

    if (data && data.found && data.lesson && data.lesson.topic) {
      try { localStorage.setItem(cacheKey, JSON.stringify(data.lesson)); } catch (_) {}
      return data.lesson;
    }

    if (data && data.error) {
      console.warn('[FluentPath] Lesson generation error:', data.error);
    } else {
      console.warn('[FluentPath] Lesson generation returned no lesson');
    }
  } catch (e) {
    console.warn('[FluentPath] Lesson generation request failed:', e.message);
  }

  // 3. Fallback — varied library, with a banner so the teacher notices AI is offline
  showFallbackBanner();
  return getFallbackLesson(state.level, state.dayNumber);
}

/** Show a small banner so the student/teacher knows the AI generator is offline. */
function showFallbackBanner() {
  if (document.getElementById('fp-fallback-banner')) return;
  const banner = document.createElement('div');
  banner.id = 'fp-fallback-banner';
  banner.style.cssText =
    'position:fixed;top:60px;left:50%;transform:translateX(-50%);z-index:198;' +
    'background:#fff8e1;border:1px solid #c9933a;color:#5a3e0a;' +
    'padding:8px 16px;font-size:12px;font-family:"Source Serif 4",serif;' +
    'box-shadow:0 2px 8px rgba(0,0,0,0.1);max-width:90%;text-align:center;';
  banner.innerHTML = '⚠ Offline lesson — please tell your teacher the lesson generator is unavailable.';
  document.body.appendChild(banner);
}

function getTopicForDay(level, day) {
  const topics = {
    A1: ['greetings & introductions','numbers & dates','family members','daily routines','food & drinks','shopping basics','asking for directions','weather','body & health','home & furniture','public transport','money & prices','jobs & workplaces','phone conversations','making appointments','emergencies','time & schedules','neighbourhood','feelings','reviewing basics'],
    A2: ['renting an apartment','talking to a landlord','at the doctor','health insurance basics','school & children','bank & finances','job applications','customer service','community services','neighbour conversations','filing taxes basics','grocery shopping','cooking & recipes','recreation & leisure','travel & transportation','social media basics','email & text messages','understanding bills','government offices','reviewing progress'],
    B1: ['workplace communication','job interviews','professional emails','team meetings','asking for a raise','workplace rights','networking','performance reviews','time management','problem solving at work','customer complaints','writing reports','phone etiquette','managing conflict','presentations basics','contracts & agreements','onboarding process','career goals','remote work','professional development'],
    B2: ['negotiation skills','persuasive language','news & current events','formal writing','critical thinking','debate & discussion','cultural references','idioms in context','complex instructions','leadership communication','media literacy','academic vocabulary','complex grammar','advanced reading','opinion writing','professional networking','research skills','public speaking','complex problem solving','mastery review'],
    C1: ['sophisticated argumentation','nuanced vocabulary','register & tone','academic discourse','strategic communication','complex rhetorical devices','cultural competency','advanced idioms','professional fluency','editorial writing','policy discussion','advanced presentations','research & citations','cross-cultural communication','leadership language','advanced negotiation','media production','complex analysis','synthesis writing','advanced mastery'],
    C2: ['near-native expression','stylistic variation','literary language','philosophical discussion','advanced pragmatics','subtle connotation','humour & irony','regional varieties','professional expertise','creative writing','complex analysis','abstract reasoning','academic writing','advanced media','cultural intelligence','linguistic precision','full fluency tasks','advanced persuasion','complex synthesis','mastery certification'],
  };
  const list = topics[level] || topics['B1'];
  return { topic: list[Math.min(day - 1, list.length - 1)] };
}

// Five hand-curated fallback lessons that cycle by (day - 1) % 5.
// Only used when AI generation fails — student sees the offline banner so the
// teacher knows to fix the API key. Each lesson is a complete, distinct scenario
// for an adult immigrant learner.
const FALLBACK_LESSONS = [
  // ── 0: Appointments & phone calls ──
  {
    topic: 'Making an Appointment',
    objective: 'Make and confirm an appointment over the phone.',
    warmup: {
      title: 'Think About Your Day',
      instruction: 'Take a moment to think and answer in English.',
      prompt: 'When was the last time you had an appointment? Describe it in 2-3 sentences.',
    },
    vocabulary: {
      title: 'Phone & Appointment Words',
      instruction: 'Click each word to see its meaning. Then try to use it in a sentence.',
      words: [
        { word: 'appointment', pronunciation: '/əˈpɔɪntmənt/', partOfSpeech: 'noun', definition: 'A meeting arranged for a specific time', exampleSentence: "I have a doctor's appointment at 3pm." },
        { word: 'available', pronunciation: '/əˈveɪləbəl/', partOfSpeech: 'adjective', definition: 'Free to use or accessible', exampleSentence: 'Is this seat available?' },
        { word: 'confirm', pronunciation: '/kənˈfɜːm/', partOfSpeech: 'verb', definition: 'To make sure something is correct', exampleSentence: 'Please confirm your reservation.' },
        { word: 'urgent', pronunciation: '/ˈɜːdʒənt/', partOfSpeech: 'adjective', definition: 'Requiring immediate action', exampleSentence: 'This is urgent — I need help now.' },
      ],
    },
    listening: {
      title: 'At the Front Desk',
      instruction: 'Listen to the conversation. Then answer the questions.',
      audioText: "Hi, this is Maria calling from the front desk. I'm calling to confirm your appointment for tomorrow at two o'clock. If you need to reschedule, please call us back as soon as possible. We look forward to seeing you.",
      questions: [
        { id: 'l1', question: 'Who is calling?', options: ['A doctor', 'Maria from the front desk', 'A customer', 'A manager'], correct: 1 },
        { id: 'l2', question: 'What is the purpose of the call?', options: ['To cancel an appointment', 'To make a complaint', 'To confirm an appointment', 'To ask for directions'], correct: 2 },
      ],
    },
    speaking: {
      title: 'Phone Phrases',
      instruction: 'Repeat each phrase clearly. Focus on stress and rhythm.',
      drills: [
        { id: 's1', phrase: 'Could I speak to the manager, please?', tip: 'Stress "manager" — COUld I SPEAK to the MANager, PLEASE?' },
        { id: 's2', phrase: "I'd like to make an appointment.", tip: "Notice the linking: I'd-like-to — blend the words smoothly." },
      ],
      conversationPrompt: 'Imagine you are calling a clinic to book an appointment. Record yourself making the call. Include: your name, the reason for the appointment, and ask what times are available.',
    },
    practice: {
      title: 'Quick Check',
      instruction: 'Choose the best answer.',
      questions: [
        { id: 'p1', question: 'You need to see a doctor urgently. What do you say on the phone?', options: ['I want a pizza.', 'I need to make an urgent appointment.', 'Are you open tomorrow?', 'Where is the clinic?'], correct: 1 },
        { id: 'p2', question: 'Which word means "to make certain something is correct"?', options: ['cancel', 'ignore', 'confirm', 'forget'], correct: 2 },
        { id: 'p3', question: 'Fill in the blank: "Is this time _____ for you?"', options: ['urgent', 'available', 'confirmed', 'appointment'], correct: 1 },
      ],
    },
    writing: {
      title: 'Write a Message',
      instruction: 'Write your response in the box below.',
      prompt: "Write a short text message to your boss explaining that you need to leave early today for a doctor's appointment. Be polite and professional.",
      minWords: 30,
    },
    review: {
      title: "Today's Key Points",
      keyTakeaways: [
        'You learned 4 useful words: appointment, available, confirm, urgent.',
        'You practised phone phrases for making appointments.',
        'You wrote a professional message in English.',
      ],
    },
  },

  // ── 1: Shopping & money ──
  {
    topic: 'Shopping and Prices',
    objective: 'Ask about prices, make a purchase, and handle returns at a store.',
    warmup: {
      title: 'Your Last Purchase',
      instruction: 'Think about something you bought recently.',
      prompt: 'What was the last thing you bought? How much did it cost? Describe it in 2-3 sentences.',
    },
    vocabulary: {
      title: 'Shopping Words',
      instruction: 'Click each word to see its meaning. Then try to use it in a sentence.',
      words: [
        { word: 'receipt', pronunciation: '/rɪˈsiːt/', partOfSpeech: 'noun', definition: 'A paper showing what you paid for', exampleSentence: 'Please keep your receipt for the return.' },
        { word: 'refund', pronunciation: '/ˈriːfʌnd/', partOfSpeech: 'noun', definition: 'Money returned to you for an item', exampleSentence: 'I would like a refund, please.' },
        { word: 'discount', pronunciation: '/ˈdɪskaʊnt/', partOfSpeech: 'noun', definition: 'A reduction in the normal price', exampleSentence: 'Is there a student discount?' },
        { word: 'cash', pronunciation: '/kæʃ/', partOfSpeech: 'noun', definition: 'Paper money and coins', exampleSentence: 'Do you accept cash or only card?' },
        { word: 'expensive', pronunciation: '/ɪkˈspɛnsɪv/', partOfSpeech: 'adjective', definition: 'Costing a lot of money', exampleSentence: 'This jacket is too expensive for me.' },
      ],
    },
    listening: {
      title: 'At the Cash Register',
      instruction: 'Listen carefully and answer the questions.',
      audioText: "Good afternoon. Your total comes to twenty-four dollars and fifty cents. Will that be cash or card today? We also have a sale on all winter items — twenty percent off if you'd like to add anything else. And here's your receipt. Have a great day!",
      questions: [
        { id: 'l1', question: 'How much does the customer need to pay?', options: ['$14.50', '$24.50', '$20.00', '$24.00'], correct: 1 },
        { id: 'l2', question: 'What is on sale today?', options: ['All items', 'Winter items', 'Summer items', 'Nothing'], correct: 1 },
      ],
    },
    speaking: {
      title: 'Shopping Phrases',
      instruction: 'Repeat each phrase clearly. Focus on rising intonation for questions.',
      drills: [
        { id: 's1', phrase: 'How much does this cost?', tip: 'Rising tone at the end — How much does this COST?' },
        { id: 's2', phrase: 'Do you accept credit cards?', tip: 'Stress "credit CARDS" — make it clear what you mean.' },
      ],
      conversationPrompt: "You bought a shirt yesterday but it's the wrong size. Record yourself asking the cashier for a refund or exchange. Include: what you bought, why you want to return it, and what you'd prefer instead.",
    },
    practice: {
      title: 'Quick Check',
      instruction: 'Choose the best answer.',
      questions: [
        { id: 'p1', question: 'Which word means "money returned to you"?', options: ['receipt', 'discount', 'refund', 'cash'], correct: 2 },
        { id: 'p2', question: 'What do you ask if you want a lower price?', options: ['Is there a discount?', 'Where is the bathroom?', 'What time is it?', 'Can I have a bag?'], correct: 0 },
        { id: 'p3', question: 'Fill in the blank: "Could I have a _____, please? I need it to return this item."', options: ['refund', 'receipt', 'discount', 'price'], correct: 1 },
      ],
    },
    writing: {
      title: 'Write a Complaint',
      instruction: 'Write your response in the box below.',
      prompt: 'Write a short email to a store explaining that the shoes you bought online arrived damaged. Politely ask for a refund or replacement.',
      minWords: 30,
    },
    review: {
      title: "Today's Key Points",
      keyTakeaways: [
        'You learned 5 shopping words: receipt, refund, discount, cash, expensive.',
        'You practised asking about prices and requesting refunds.',
        'You wrote a polite complaint message.',
      ],
    },
  },

  // ── 2: At work ──
  {
    topic: 'At the Workplace',
    objective: 'Communicate about your schedule, ask for time off, and report a problem at work.',
    warmup: {
      title: 'Your Workday',
      instruction: 'Think about your typical day at work.',
      prompt: 'What time do you start work? What is the first thing you do? Describe it in 2-3 sentences.',
    },
    vocabulary: {
      title: 'Workplace Words',
      instruction: 'Click each word to see its meaning. Then try to use it in a sentence.',
      words: [
        { word: 'shift', pronunciation: '/ʃɪft/', partOfSpeech: 'noun', definition: 'A scheduled period of work', exampleSentence: 'My shift starts at 6am tomorrow.' },
        { word: 'supervisor', pronunciation: '/ˈsuːpəvaɪzə/', partOfSpeech: 'noun', definition: 'The person who manages your work', exampleSentence: 'I need to talk to my supervisor.' },
        { word: 'paycheck', pronunciation: '/ˈpeɪtʃɛk/', partOfSpeech: 'noun', definition: 'The money you receive for your work', exampleSentence: 'I get my paycheck every two weeks.' },
        { word: 'overtime', pronunciation: '/ˈəʊvətaɪm/', partOfSpeech: 'noun', definition: 'Extra hours worked beyond the normal schedule', exampleSentence: 'I worked 5 hours of overtime last week.' },
        { word: 'break', pronunciation: '/breɪk/', partOfSpeech: 'noun', definition: 'A short rest period during work', exampleSentence: 'We get a 30-minute break for lunch.' },
      ],
    },
    listening: {
      title: 'Asking for Time Off',
      instruction: 'Listen to the conversation between an employee and supervisor.',
      audioText: "Excuse me, Linda? I'm sorry to bother you, but I need to ask for next Friday off. My daughter has a school event in the morning. I can switch shifts with Carlos if that helps. I just wanted to give you plenty of notice.",
      questions: [
        { id: 'l1', question: 'What does the employee need?', options: ['A pay raise', 'A day off', 'A new uniform', 'A break'], correct: 1 },
        { id: 'l2', question: 'What does the employee offer to do?', options: ['Work overtime', 'Switch shifts with Carlos', 'Bring her daughter to work', 'Quit her job'], correct: 1 },
      ],
    },
    speaking: {
      title: 'Polite Workplace Phrases',
      instruction: 'Repeat each phrase. Focus on a calm, polite tone.',
      drills: [
        { id: 's1', phrase: "I'm sorry to bother you, but I have a question.", tip: 'Soften your voice — start politely so your supervisor is open to listening.' },
        { id: 's2', phrase: 'Could I take my break now, please?', tip: 'Use rising intonation on "please" to sound polite.' },
      ],
      conversationPrompt: 'Imagine you need to leave work two hours early for a family emergency. Record yourself talking to your supervisor. Include: a polite opening, the reason, and offering to make up the hours.',
    },
    practice: {
      title: 'Quick Check',
      instruction: 'Choose the best answer.',
      questions: [
        { id: 'p1', question: 'Which word means "extra hours worked"?', options: ['shift', 'break', 'overtime', 'paycheck'], correct: 2 },
        { id: 'p2', question: 'Who do you talk to if you have a problem at work?', options: ['Your customer', 'Your supervisor', 'Your neighbour', 'Your doctor'], correct: 1 },
        { id: 'p3', question: 'Fill in the blank: "My _____ starts at 9am and ends at 5pm."', options: ['paycheck', 'break', 'shift', 'supervisor'], correct: 2 },
      ],
    },
    writing: {
      title: 'Email Your Supervisor',
      instruction: 'Write your response in the box below.',
      prompt: 'Write a short, polite email to your supervisor asking for next Tuesday off because you have a doctor appointment. Offer to work an extra shift to cover.',
      minWords: 30,
    },
    review: {
      title: "Today's Key Points",
      keyTakeaways: [
        'You learned 5 workplace words: shift, supervisor, paycheck, overtime, break.',
        'You practised polite ways to talk to your supervisor.',
        'You wrote a professional time-off request.',
      ],
    },
  },

  // ── 3: Health & doctor ──
  {
    topic: 'At the Doctor',
    objective: 'Describe symptoms to a doctor and understand basic medical instructions.',
    warmup: {
      title: 'How Do You Feel?',
      instruction: 'Think about how your body feels today.',
      prompt: 'When was the last time you felt sick? What was wrong? Describe it in 2-3 sentences.',
    },
    vocabulary: {
      title: 'Health Words',
      instruction: 'Click each word to see its meaning. Then try to use it in a sentence.',
      words: [
        { word: 'symptom', pronunciation: '/ˈsɪmptəm/', partOfSpeech: 'noun', definition: 'A sign that you are sick', exampleSentence: 'A headache is a common symptom of the flu.' },
        { word: 'prescription', pronunciation: '/prɪˈskrɪpʃən/', partOfSpeech: 'noun', definition: 'A doctor\'s written order for medicine', exampleSentence: 'I need to fill my prescription at the pharmacy.' },
        { word: 'pain', pronunciation: '/peɪn/', partOfSpeech: 'noun', definition: 'A bad feeling in your body when you are hurt or sick', exampleSentence: 'I have a sharp pain in my back.' },
        { word: 'fever', pronunciation: '/ˈfiːvə/', partOfSpeech: 'noun', definition: 'A high body temperature', exampleSentence: 'My son has a fever of 102 degrees.' },
        { word: 'allergy', pronunciation: '/ˈælədʒi/', partOfSpeech: 'noun', definition: 'A bad reaction your body has to something', exampleSentence: 'I have an allergy to peanuts.' },
      ],
    },
    listening: {
      title: 'In the Doctor\'s Office',
      instruction: 'Listen to the conversation between a patient and doctor.',
      audioText: "So tell me, what brings you in today? I see — a sore throat for three days now. Any fever? Yes, a small one yesterday. Okay, let me take a look. Open your mouth and say 'ah'. Mm-hm. I think you have a throat infection. I'm going to write you a prescription for some antibiotics. Take one pill twice a day for seven days.",
      questions: [
        { id: 'l1', question: 'How long has the patient had a sore throat?', options: ['One day', 'Two days', 'Three days', 'A week'], correct: 2 },
        { id: 'l2', question: 'What does the doctor prescribe?', options: ['Vitamins', 'Antibiotics', 'Pain killers', 'Cough syrup'], correct: 1 },
      ],
    },
    speaking: {
      title: 'Describing How You Feel',
      instruction: 'Repeat each phrase. Focus on clear pronunciation of the body parts.',
      drills: [
        { id: 's1', phrase: 'I have a pain in my chest.', tip: 'Stress "PAIN" — make it clear this is the problem.' },
        { id: 's2', phrase: 'I am allergic to penicillin.', tip: 'Pronounce "allergic" carefully: a-LER-jik.' },
      ],
      conversationPrompt: 'You have had a bad headache for two days. Record yourself talking to a doctor. Include: how long you have had the headache, where the pain is, and any other symptoms.',
    },
    practice: {
      title: 'Quick Check',
      instruction: 'Choose the best answer.',
      questions: [
        { id: 'p1', question: 'What is a "symptom"?', options: ['A type of medicine', 'A sign that you are sick', 'A doctor', 'A hospital'], correct: 1 },
        { id: 'p2', question: 'Where do you go to get medicine?', options: ['The bank', 'The pharmacy', 'The school', 'The post office'], correct: 1 },
        { id: 'p3', question: 'Fill in the blank: "I need to fill my _____ at the drugstore."', options: ['symptom', 'fever', 'prescription', 'allergy'], correct: 2 },
      ],
    },
    writing: {
      title: 'Note for Your Doctor',
      instruction: 'Write your response in the box below.',
      prompt: 'Write a short note describing your symptoms to a doctor. Include at least three symptoms and how long you have had them.',
      minWords: 30,
    },
    review: {
      title: "Today's Key Points",
      keyTakeaways: [
        'You learned 5 health words: symptom, prescription, pain, fever, allergy.',
        'You practised describing how you feel to a doctor.',
        'You wrote a clear note about your health.',
      ],
    },
  },

  // ── 4: Family & community ──
  {
    topic: 'Family and Neighbours',
    objective: 'Talk about your family and have small talk with a neighbour.',
    warmup: {
      title: 'About Your Family',
      instruction: 'Think about the people closest to you.',
      prompt: 'Who do you live with? Tell me a little about one family member. Describe in 2-3 sentences.',
    },
    vocabulary: {
      title: 'Family & Community Words',
      instruction: 'Click each word to see its meaning. Then try to use it in a sentence.',
      words: [
        { word: 'neighbour', pronunciation: '/ˈneɪbə/', partOfSpeech: 'noun', definition: 'A person who lives near you', exampleSentence: 'My neighbour is very friendly.' },
        { word: 'relative', pronunciation: '/ˈrɛlətɪv/', partOfSpeech: 'noun', definition: 'A member of your family', exampleSentence: 'I have many relatives in Mexico.' },
        { word: 'borrow', pronunciation: '/ˈbɒrəʊ/', partOfSpeech: 'verb', definition: 'To use something that belongs to someone else', exampleSentence: 'Can I borrow your pen?' },
        { word: 'invite', pronunciation: '/ɪnˈvaɪt/', partOfSpeech: 'verb', definition: 'To ask someone to come somewhere', exampleSentence: 'We invited our neighbours for dinner.' },
        { word: 'together', pronunciation: '/təˈɡɛðə/', partOfSpeech: 'adverb', definition: 'With another person or group', exampleSentence: 'My family eats dinner together every night.' },
      ],
    },
    listening: {
      title: 'Meeting a Neighbour',
      instruction: 'Listen to two neighbours meeting in the hallway.',
      audioText: "Hi there! I think we're new neighbours. My name is Sandra, I just moved into apartment 4B last week. Oh nice to meet you! I'm Pablo, I live in 4C with my wife and two kids. Welcome to the building. If you ever need anything — sugar, a tool, anything — just knock on our door.",
      questions: [
        { id: 'l1', question: 'Who just moved in?', options: ['Pablo', 'Sandra', 'Pablo\'s wife', 'A child'], correct: 1 },
        { id: 'l2', question: 'How does Pablo respond?', options: ['He ignores her', 'He is angry', 'He is friendly and helpful', 'He is too busy'], correct: 2 },
      ],
    },
    speaking: {
      title: 'Friendly Small Talk',
      instruction: 'Repeat each phrase. Focus on a warm, friendly tone.',
      drills: [
        { id: 's1', phrase: 'Nice to meet you. How are you settling in?', tip: 'Smile while you say it — a friendly tone makes a big difference.' },
        { id: 's2', phrase: 'If you need anything, just let me know.', tip: 'Say it slowly and warmly — this is a kind offer.' },
      ],
      conversationPrompt: 'A new neighbour just moved into your building. Record yourself introducing yourself. Include: your name, how long you have lived there, and offering to help with something.',
    },
    practice: {
      title: 'Quick Check',
      instruction: 'Choose the best answer.',
      questions: [
        { id: 'p1', question: 'Who is a "relative"?', options: ['A friend at work', 'A member of your family', 'Your boss', 'A stranger'], correct: 1 },
        { id: 'p2', question: 'Which is a friendly thing to say to a new neighbour?', options: ['Go away.', 'Welcome to the building!', 'I am too busy.', 'What do you want?'], correct: 1 },
        { id: 'p3', question: 'Fill in the blank: "Can I _____ your ladder for an hour?"', options: ['invite', 'borrow', 'together', 'neighbour'], correct: 1 },
      ],
    },
    writing: {
      title: 'Note for a Neighbour',
      instruction: 'Write your response in the box below.',
      prompt: 'Write a short, friendly note to a new neighbour. Introduce yourself, welcome them, and offer to help if they need anything.',
      minWords: 30,
    },
    review: {
      title: "Today's Key Points",
      keyTakeaways: [
        'You learned 5 community words: neighbour, relative, borrow, invite, together.',
        'You practised friendly phrases for meeting new people.',
        'You wrote a welcoming note to a neighbour.',
      ],
    },
  },
];

function getFallbackLesson(level, day) {
  const dayNum = parseInt(day, 10) || 1;
  const idx = (dayNum - 1) % FALLBACK_LESSONS.length;
  // Return a deep clone so render code can't mutate the shared template across days
  return JSON.parse(JSON.stringify(FALLBACK_LESSONS[idx]));
}

// ══════════════════════════════════════════════════════
// BUILD STEPS FROM LESSON CONTENT
// ══════════════════════════════════════════════════════
function buildSteps(lesson) {
  return [
    { type: 'warmup',     data: lesson.warmup,     meta: STEP_STRUCTURE[0] },
    { type: 'vocabulary', data: lesson.vocabulary, meta: STEP_STRUCTURE[1] },
    { type: 'listening',  data: lesson.listening,  meta: STEP_STRUCTURE[2] },
    { type: 'speaking',   data: lesson.speaking,   meta: STEP_STRUCTURE[3] },
    { type: 'practice',   data: lesson.practice,   meta: STEP_STRUCTURE[4] },
    { type: 'writing',    data: lesson.writing,    meta: STEP_STRUCTURE[5] },
    { type: 'review',     data: lesson.review,     meta: STEP_STRUCTURE[6] },
  ];
}

// ══════════════════════════════════════════════════════
// STEP DOTS
// ══════════════════════════════════════════════════════
function buildStepDots() {
  const container = document.getElementById('stepDots');
  container.innerHTML = state.steps.map((s, i) =>
    `<div class="step-dot ${i === 0 ? 'active' : ''}" id="dot-${i}"></div>`
  ).join('');
}

function updateStepDots() {
  state.steps.forEach((_, i) => {
    const dot = document.getElementById(`dot-${i}`);
    if (!dot) return;
    dot.className = 'step-dot';
    if (i < state.currentStep) dot.classList.add('done');
    else if (i === state.currentStep) dot.classList.add('active');
  });
  document.getElementById('stepCountLabel').textContent = `Step ${state.currentStep + 1} of ${state.steps.length}`;
  document.getElementById('progressBar').style.width = ((state.currentStep + 1) / state.steps.length * 100) + '%';
}

// ══════════════════════════════════════════════════════
// RENDER STEP
// ══════════════════════════════════════════════════════
function renderStep() {
  const step = state.steps[state.currentStep];
  const meta = step.meta;
  const data = step.data;

  // Update header
  document.getElementById('stepNumBadge').textContent = state.currentStep + 1;
  document.getElementById('stepTypeLabel').textContent = meta.label;
  document.getElementById('stepTitleLabel').textContent = data.title || meta.title;

  updateStepDots();

  // Render activity
  const wrap = document.getElementById('activityWrap');
  wrap.innerHTML = '';

  switch(step.type) {
    case 'warmup':     renderWarmup(wrap, data); break;
    case 'vocabulary': renderVocabulary(wrap, data); break;
    case 'listening':  renderListening(wrap, data); break;
    case 'speaking':   renderSpeaking(wrap, data); break;
    case 'practice':   renderPractice(wrap, data); break;
    case 'writing':    renderWriting(wrap, data); break;
    case 'review':     renderReview(wrap, data); break;
  }

  // Focus management: move focus to the first interactive element in the new step
  setTimeout(function() {
    var target = wrap.querySelector('textarea, input, button, [tabindex="0"]');
    if (target) target.focus();
  }, 100);
}

// ── BILINGUAL HELPERS ──
// For A1/A2: show Spanish as primary, English as hint
// For other levels: show English only
function biText(en, es) {
  if (!es) return escHtml(en);
  var lvl = (state.level || '').toUpperCase();
  if (lvl === 'A1' || lvl === 'A2') {
    return escHtml(es) + '<span class="i18n-hint" style="pointer-events:none;">' + escHtml(en) + '</span>';
  }
  return escHtml(en);
}

// Runtime translation lookup for JS-set textContent
// Uses the i18n dictionary if available, returns original if not
var _TR = {
  'Press to start speaking — aim for 30+ seconds': 'Presiona para empezar a hablar — intenta 30+ segundos',
  'Recording… speak clearly': 'Grabando… habla con claridad',
  'Recording saved. You can record again if you want.': 'Grabación guardada. Puedes grabar de nuevo si quieres.',
  '✓ Great job! Your pronunciation was clear.': '✓ ¡Excelente! Tu pronunciación fue clara.',
  '💡 Keep practicing — try again and speak slowly.': '💡 Sigue practicando — intenta de nuevo y habla despacio.',
  '🎤 Record again': '🎤 Grabar de nuevo',
  '🎤 Try again': '🎤 Intentar de nuevo',
  'Playing…': 'Reproduciendo…',
  'Click to listen again': 'Haz clic para escuchar de nuevo',
  'No more plays': 'No más reproducciones',
  '✓ Correct!': '✓ ¡Correcto!',
  'Saving your progress…': 'Guardando tu progreso…',
  'Speech recognition requires Chrome browser.': 'El reconocimiento de voz requiere el navegador Chrome.',
  'Finish Lesson ✓': 'Terminar Lección ✓',
  'Continue →': 'Continuar →',
  'You said:': 'Dijiste:',
  'Day': 'Día',
};
function tr(en) {
  var lvl = (state.level || '').toUpperCase();
  if (lvl === 'A1' || lvl === 'A2') return _TR[en] || en;
  return en;
}

// ── WARMUP ──
function renderWarmup(wrap, data) {
  var lc = state.lessonContent || {};
  wrap.innerHTML = `
    <div class="activity-card">
      <div class="ac-label">TODAY'S OBJECTIVE</div>
      <div class="ac-heading">${biText(lc.topic || 'Today\'s Topic', lc.topic_es)}</div>
      <div class="ac-body">${biText(lc.objective || '', lc.objective_es)}</div>
    </div>
    <div class="activity-card">
      <div class="ac-label">WARM-UP</div>
      <div class="ac-heading">${biText(data.title, data.title_es)}</div>
      <div class="ac-body">${biText(data.instruction, data.instruction_es)}</div>
      <div style="margin-top:20px;background:var(--cream);border-left:4px solid var(--gold);padding:16px 20px;">
        <div style="font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:var(--muted);font-weight:600;margin-bottom:8px;">THINK ABOUT THIS</div>
        <div style="font-size:16px;color:var(--ink);line-height:1.7;font-style:italic;">"${biText(data.prompt, data.prompt_es)}"</div>
      </div>
      <textarea class="writing-area" id="warmup-resp" placeholder="Type your answer here…" style="min-height:100px;" oninput="saveAnswer('warmup', this.value)" required></textarea>
      <label style="display:flex;align-items:center;gap:8px;margin-top:8px;font-size:12px;color:var(--muted);cursor:pointer;"><input type="checkbox" onchange="toggleCourseSkip(this,'warmup-resp','warmup')"> Skip this question</label>
    </div>
  `;
}

// ── VOCABULARY ──
function renderVocabulary(wrap, data) {
  const words = (data.words || []).map((w, i) => `
    <div class="vocab-item" tabindex="0" role="button" aria-label="Vocabulary: ${escHtml(w.word)} — tap to reveal definition" onclick="revealWord(this)" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();revealWord(this);}">
      <div class="vi-word">${escHtml(w.word)}</div>
      <div class="vi-pron">${escHtml(w.pronunciation || '')} · ${escHtml(w.partOfSpeech || '')}</div>
      <div class="vi-hint">Tap to see meaning</div>
      <div class="vi-def">
        <strong>${biText(w.definition, w.definition_es)}</strong><br>
        <em style="font-size:12px;margin-top:4px;display:block;">"${biText(w.exampleSentence, w.exampleSentence_es)}"</em>
        <button onclick="event.stopPropagation();speakWord('${escHtml(w.word)}')" style="margin-top:8px;background:var(--ink);color:var(--paper);border:none;padding:4px 10px;font-size:11px;cursor:pointer;">🔊 Hear it</button>
      </div>
    </div>
  `).join('');

  wrap.innerHTML = `
    <div class="activity-card">
      <div class="ac-label">VOCABULARY · ${(data.words||[]).length} WORDS</div>
      <div class="ac-heading">${biText(data.title, data.title_es)}</div>
      <div class="ac-body">${biText(data.instruction, data.instruction_es)}</div>
      <div class="vocab-grid">${words}</div>
    </div>
    <div class="activity-card">
      <div class="ac-label">PRACTICE WITH THESE WORDS</div>
      <div class="ac-heading">${biText('Use them in sentences', 'Úsalas en oraciones')}</div>
      <div class="ac-body">${biText("Choose any 2 of today's words and write your own sentence using each one.", 'Elige 2 de las palabras de hoy y escribe una oración con cada una.')}</div>
      <textarea class="writing-area" id="vocab-practice" placeholder="Write your sentences here…" style="min-height:80px;" oninput="saveAnswer('vocab_practice', this.value)" required></textarea>
      <label style="display:flex;align-items:center;gap:8px;margin-top:8px;font-size:12px;color:var(--muted);cursor:pointer;"><input type="checkbox" onchange="toggleCourseSkip(this,'vocab-practice','vocab_practice')"> Skip this question</label>
    </div>
  `;
}

function revealWord(el) {
  el.classList.toggle('revealed');
  const hint = el.querySelector('.vi-hint');
  if (hint) hint.style.display = el.classList.contains('revealed') ? 'none' : 'block';
}

function speakWord(word) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(word);
  u.lang = 'en-US'; u.rate = 0.85;
  window.speechSynthesis.speak(u);
}

// ── LISTENING ──
let listeningPlays = 0;
function renderListening(wrap, data) {
  listeningPlays = 0;
  const qs = (data.questions || []).map((q, qi) => {
    const opts = (q.options || []).map((o, oi) => `
      <div class="mcq-opt" id="lo-${q.id}-${oi}" tabindex="0" role="button" aria-label="Option ${String.fromCharCode(65+oi)}: ${escHtml(o)}" onclick="selectListeningOpt('${q.id}', ${oi}, ${q.correct})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();selectListeningOpt('${q.id}', ${oi}, ${q.correct});}">
        <div class="opt-letter">${String.fromCharCode(65+oi)}</div>
        <div>${escHtml(o)}</div>
      </div>`).join('');
    return `
      <div style="margin-bottom:20px;">
        <div style="font-size:14px;font-weight:600;margin-bottom:8px;">${qi+1}. ${biText(q.question, q.question_es)}</div>
        <div class="mcq-options">${opts}</div>
        <div id="lf-${q.id}" aria-live="polite" style="font-size:12px;font-style:italic;margin-top:6px;display:none;"></div>
      </div>`;
  }).join('');

  wrap.innerHTML = `
    <div class="activity-card">
      <div class="ac-label">LISTENING COMPREHENSION</div>
      <div class="ac-heading">${biText(data.title, data.title_es)}</div>
      <div class="ac-body">${biText(data.instruction, data.instruction_es)}</div>
      <div class="audio-box" id="listenBox" style="cursor:default;">
        <div class="audio-btn" id="listenBtn" onclick="playListening()" style="cursor:pointer;">▶</div>
        <div class="audio-btn" id="listenStopBtn" onclick="stopListening()" style="cursor:pointer;display:none;background:var(--rust,#b8471e);color:white;">■</div>
        <div class="audio-info">
          <div class="ai-label">AUDIO</div>
          <div class="ai-status" id="listenStatus">Press play — up to 3 times</div>
          <span id="listenPlayTime" style="font-size:10px;color:var(--muted);display:none;"></span>
        </div>
        <div class="audio-plays" id="listenPlays">3 plays left</div>
      </div>
    </div>
    <div class="activity-card">
      <div class="ac-label">COMPREHENSION QUESTIONS</div>
      <div class="ac-heading">Answer what you heard</div>
      ${qs}
    </div>
  `;
}

var courseListenStart = null;
var courseListenTotal = 0;

function playListening() {
  if (listeningPlays >= 3) return;
  listeningPlays++;
  var left = 3 - listeningPlays;
  document.getElementById('listenPlays').textContent = left === 0 ? 'No plays left' : left + ' play' + (left===1?'':'s') + ' left';
  document.getElementById('listenStatus').textContent = tr('Playing…');
  document.getElementById('listenBtn').style.display = 'none';
  document.getElementById('listenStopBtn').style.display = 'flex';
  courseListenStart = Date.now();
  if (left === 0) document.getElementById('listenBox').style.opacity = '0.7';
  var text = state.steps[state.currentStep]?.data?.audioText || 'No audio available.';
  speakText(text, function() { finishCourseListening(left); });
}

function stopListening() {
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  finishCourseListening(3 - listeningPlays);
}

function finishCourseListening(left) {
  if (courseListenStart) {
    courseListenTotal += Date.now() - courseListenStart;
    courseListenStart = null;
  }
  document.getElementById('listenStopBtn').style.display = 'none';
  document.getElementById('listenBtn').style.display = 'flex';
  document.getElementById('listenStatus').textContent = left > 0 ? tr('Click to listen again') : tr('No more plays');
  var ptEl = document.getElementById('listenPlayTime');
  ptEl.style.display = 'inline';
  var s = Math.round(courseListenTotal / 1000);
  ptEl.textContent = ' · ' + (s < 60 ? s + 's listened' : Math.floor(s/60) + 'm ' + (s%60) + 's listened');
  if (left === 0) { document.getElementById('listenBtn').style.opacity = '0.4'; document.getElementById('listenBtn').style.cursor = 'default'; }
}

function selectListeningOpt(qid, chosen, correct) {
  // disable all options for this question
  const parent = document.getElementById(`lo-${qid}-0`)?.closest('.mcq-options') ||
                  document.getElementById(`lo-${qid}-0`)?.parentElement;
  document.querySelectorAll(`[id^="lo-${qid}-"]`).forEach(el => {
    el.classList.add('disabled');
    el.onclick = null;
  });
  const chosenEl = document.getElementById(`lo-${qid}-${chosen}`);
  const correctEl = document.getElementById(`lo-${qid}-${correct}`);
  const fb = document.getElementById(`lf-${qid}`);
  if (chosen === correct) {
    chosenEl?.classList.add('correct');
    if (fb) { fb.style.display='block'; fb.style.color='var(--green)'; fb.textContent=tr('✓ Correct!'); }
  } else {
    chosenEl?.classList.add('wrong');
    correctEl?.classList.add('correct');
    if (fb) { fb.style.display='block'; fb.style.color='var(--rust)'; fb.textContent=`The correct answer was ${String.fromCharCode(65+correct)}.`; }
  }
  saveAnswer(`listening_${qid}`, chosen);
  saveAnswer(`listening_${qid}_correct`, correct);
  saveAnswer(`listening_${qid}_is_right`, chosen === correct ? 1 : 0);
  // Track listening score
  if (!state.answers['listening_total']) state.answers['listening_total'] = 0;
  if (!state.answers['listening_correct']) state.answers['listening_correct'] = 0;
  state.answers['listening_total']++;
  if (chosen === correct) state.answers['listening_correct']++;
}

// ── SPEAKING ──
let recognition = null;
let isRecording = false;
let currentDrillId = null;
let convRecording = false;

// Audio recording state (MediaRecorder, per drill + conversation)
let audioRecordings = {};     // { drillId: Blob, 'conversation': Blob }
let convMediaRecorder = null; // active MediaRecorder for conversation prompt

// Shared mic stream — acquired once for the whole speaking step so sequential
// drills don't have to compete for the microphone.
let speakingStream = null;

/** Get (or create) the shared mic stream. Returns null if unavailable. */
async function getSpeakingStream() {
  if (speakingStream && speakingStream.active) return speakingStream;
  const mime = getAudioMimeType();
  if (!window.MediaRecorder || !mime) return null;
  try {
    speakingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    return speakingStream;
  } catch (e) {
    console.warn('[FluentPath] Could not acquire mic for audio recording:', e);
    return null;
  }
}

/** Release the shared mic stream (called after lesson is submitted). */
function releaseSpeakingStream() {
  if (speakingStream) {
    speakingStream.getTracks().forEach(t => t.stop());
    speakingStream = null;
  }
}

/** Return the best supported MIME type for audio recording */
function getAudioMimeType() {
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
  for (const t of types) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) return t;
  }
  return '';
}

/** Extract file extension from MIME type string */
function audioExtension(mime) {
  if (mime.includes('mp4'))  return 'mp4';
  if (mime.includes('ogg'))  return 'ogg';
  return 'webm';
}

/** Convert a Blob to a base64 string (returns Promise<string>) */
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      // result is data:<mime>;base64,<data>  — strip the prefix
      const b64 = reader.result.split(',')[1];
      resolve(b64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Upload all collected audio recordings to Apps Script / Drive.
 * Returns the speaking_audio_json string to store in Course Progress,
 * or null if nothing was recorded or upload failed.
 */
async function uploadAudioRecordings() {
  if (!window.MediaRecorder) return null;
  const mime = getAudioMimeType();
  const ext  = audioExtension(mime);
  const keys = Object.keys(audioRecordings);
  if (keys.length === 0) return null;

  const recordings = {};
  const scores     = {};

  for (const key of keys) {
    const blob = audioRecordings[key];
    if (!blob || blob.size === 0) continue;
    try {
      const b64 = await blobToBase64(blob);
      recordings[key] = { data: b64, ext };
    } catch (e) {
      console.warn('[FluentPath] Could not encode audio for', key, e);
    }
    // Phonetic accuracy scores stored in state.answers
    const scoreKey = key === 'conversation' ? null : `drill_${key}_score`;
    if (scoreKey && state.answers[scoreKey] != null) {
      scores[key] = state.answers[scoreKey];
    }
  }

  if (Object.keys(recordings).length === 0) return null;

  const body = {
    action: 'save_audio',
    student_name: state.studentName,
    day_number:   state.dayNumber,
    recordings,
    scores
  };

  try {
    // Use text/plain so the browser sends a simple request (no CORS preflight).
    // Apps Script reads e.postData.contents regardless of content-type.
    var audioUrl = GOOGLE_SHEET_WEBHOOK + '?action=save_audio';
    if (FP.APP_TOKEN) audioUrl += '&token=' + encodeURIComponent(FP.APP_TOKEN);
    const resp = await fetch(audioUrl, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(body)
    });
    const json = await resp.json();
    if (json.result === 'error') {
      console.error('[FluentPath] Audio upload server error:', json.message);
    }
    if (json.warnings) {
      console.warn('[FluentPath] Audio upload warnings:', json.warnings);
    }
    return json.audio_json || null;
  } catch (e) {
    console.error('[FluentPath] Audio upload failed:', e);
    return null;
  }
}

function renderSpeaking(wrap, data) {
  const hasSpeechAPI = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  const browserWarning = hasSpeechAPI ? '' : `
    <div style="background:#fff3e0;border:1px solid #e6a817;border-radius:8px;padding:14px 18px;margin-bottom:18px;font-size:13px;color:#7a5600;">
      <strong>${biText('Browser not supported', 'Navegador no compatible')}</strong><br>
      ${biText('Speech recording requires Chrome or Edge. You can still listen to the model pronunciation and practise aloud with your teacher on the video call.', 'La grabación de voz requiere Chrome o Edge. Aún puedes escuchar la pronunciación modelo y practicar en voz alta con tu profesor en la videollamada.')}
    </div>`;
  const recDisabled = hasSpeechAPI ? '' : 'disabled style="opacity:0.4;cursor:not-allowed;background:var(--muted);"';

  const drills = (data.drills || []).map(d => `
    <div class="activity-card" style="margin-bottom:16px;">
      <div class="ac-label">DRILL · PRONUNCIATION</div>
      <div style="font-size:22px;font-family:'Playfair Display',serif;font-weight:700;margin-bottom:8px;">"${escHtml(d.phrase)}"</div>
      <div style="background:#fff8e6;border-left:3px solid var(--gold);padding:10px 14px;font-size:13px;color:var(--muted);font-style:italic;margin-bottom:16px;">💡 ${biText(d.tip, d.tip_es)}</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        <button data-phrase="${escHtml(d.phrase)}" onclick="speakText(this.dataset.phrase)" style="background:var(--blue);color:white;border:none;padding:8px 18px;font-size:13px;cursor:pointer;">${biText('🔊 Hear model', '🔊 Escuchar modelo')}</button>
        <button data-id="${d.id}" data-phrase="${escHtml(d.phrase)}" onclick="startDrill(this.dataset.id, this.dataset.phrase)" id="drill-btn-${d.id}" ${recDisabled || `style="background:var(--ink);color:white;border:none;padding:8px 18px;font-size:13px;cursor:pointer;"`}>${biText('🎤 Record yourself', '🎤 Grábate')}</button>
      </div>
      <div id="drill-transcript-${d.id}" class="record-transcript"></div>
      <div id="drill-feedback-${d.id}" class="record-feedback"></div>
    </div>
  `).join('');

  wrap.innerHTML = `
    ${browserWarning}
    ${drills}
    <div class="activity-card">
      <div class="ac-label">FREE SPEAKING TASK</div>
      <div class="ac-heading">${biText(data.conversationPrompt || 'Speaking Practice', data.conversationPrompt_es)}</div>
      <div class="ac-body" style="margin-bottom:16px;">${biText(data.instruction || '', data.instruction_es)}</div>
      <div class="recorder-box" id="convRecorder">
        <button class="record-btn" id="convBtn" onclick="toggleConvRecording()" ${hasSpeechAPI ? '' : 'disabled style="opacity:0.4;cursor:not-allowed;"'}>🎤</button>
        <div class="record-label">${biText('FREE SPEAKING', 'CONVERSACIÓN LIBRE')}</div>
        <div class="record-status" id="convStatus">${hasSpeechAPI ? biText('Press to start speaking — aim for 30+ seconds', 'Presiona para empezar a hablar — intenta 30+ segundos') : biText('Speech recording not available in this browser', 'Grabación de voz no disponible en este navegador')}</div>
      </div>
      <div id="conv-transcript" class="record-transcript"></div>
    </div>
  `;
}

// Active drill recorders: { drillId: { rec, mediaRec, phrase } }
var activeDrills = {};

function startDrill(id, phrase) {
  if (!window.SpeechRecognition && !window.webkitSpeechRecognition) {
    alert('Speech recognition is not available in this browser. Please use Chrome.');
    return;
  }
  const btn = document.getElementById(`drill-btn-${id}`);
  const tEl = document.getElementById(`drill-transcript-${id}`);
  const fEl = document.getElementById(`drill-feedback-${id}`);

  // If already recording this drill, stop it
  if (activeDrills[id]) {
    stopDrill(id);
    return;
  }

  btn.textContent = tr('⏹ Stop Recording');
  btn.style.background = 'var(--rust)';
  tEl.classList.add('show');
  tEl.textContent = '…';

  const mime = getAudioMimeType();
  let mediaRec = null;
  const audioChunks = [];

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const rec = new SR();
  rec.lang = 'en-US'; rec.interimResults = true; rec.continuous = true;

  var fullTranscript = '';

  rec.onresult = (e) => {
    var text = '';
    for (var i = 0; i < e.results.length; i++) {
      text += e.results[i][0].transcript;
    }
    fullTranscript = text.trim();
    tEl.textContent = tr('You said:') + ' "' + fullTranscript + '"';
  };
  rec.onend = () => {
    // Restart if the user hasn't explicitly stopped
    if (activeDrills[id]) {
      try { rec.start(); } catch(e) {}
    }
  };
  rec.onerror = (ev) => {
    if (ev.error === 'not-allowed') {
      alert('Microphone access was denied. Please allow microphone access in your browser settings.');
      delete activeDrills[id];
      btn.textContent = tr('🎤 Try again');
      btn.style.background = 'var(--ink)';
    } else if (ev.error !== 'aborted' && ev.error !== 'no-speech') {
      console.warn('[FluentPath] Speech recognition error:', ev.error, ev.message);
    }
  };

  activeDrills[id] = { rec: rec, mediaRec: null, phrase: phrase, getTranscript: () => fullTranscript };

  try {
    rec.start();
  } catch (err) {
    console.error('[FluentPath] Could not start speech recognition:', err);
    btn.textContent = tr('🎤 Try again');
    btn.style.background = 'var(--ink)';
    delete activeDrills[id];
    return;
  }

  getSpeakingStream().then(stream => {
    if (!stream || !activeDrills[id]) return;
    mediaRec = new MediaRecorder(stream, { mimeType: mime });
    mediaRec.ondataavailable = (ev) => { if (ev.data.size > 0) audioChunks.push(ev.data); };
    mediaRec.onstop = () => {
      if (audioChunks.length > 0) audioRecordings[id] = new Blob(audioChunks, { type: mime });
    };
    activeDrills[id].mediaRec = mediaRec;
    mediaRec.start();
  }).catch(() => { /* audio capture unavailable — transcript still works */ });
}

function stopDrill(id) {
  const drill = activeDrills[id];
  if (!drill) return;

  delete activeDrills[id];
  if (drill.rec) try { drill.rec.stop(); } catch(e) {}
  if (drill.mediaRec && drill.mediaRec.state !== 'inactive') try { drill.mediaRec.stop(); } catch(e) {}

  const btn = document.getElementById(`drill-btn-${id}`);
  const tEl = document.getElementById(`drill-transcript-${id}`);
  const fEl = document.getElementById(`drill-feedback-${id}`);

  if (btn) {
    btn.textContent = tr('🎤 Record again');
    btn.style.background = 'var(--ink)';
  }

  const said = drill.getTranscript();
  if (said) {
    if (tEl) { tEl.textContent = tr('You said:') + ' "' + said + '"'; tEl.classList.add('show'); }
    const score = similarity(said.toLowerCase(), drill.phrase.toLowerCase());
    if (fEl) {
      fEl.classList.add('show');
      if (score > 0.7) {
        fEl.className = 'record-feedback show good';
        fEl.textContent = tr('✓ Great job! Your pronunciation was clear.');
      } else {
        fEl.className = 'record-feedback show ok';
        fEl.textContent = tr('💡 Keep practicing — try again and speak slowly.');
      }
    }
    saveAnswer(`drill_${id}`, said);
    saveAnswer(`drill_${id}_score`, Math.round(score * 100) / 100);
  } else {
    if (tEl) tEl.textContent = tr('No speech detected — try again.');
  }
}

function toggleConvRecording() {
  if (!window.SpeechRecognition && !window.webkitSpeechRecognition) {
    alert(tr('Speech recognition requires Chrome browser.'));
    return;
  }
  const btn = document.getElementById('convBtn');
  const box = document.getElementById('convRecorder');
  const tEl = document.getElementById('conv-transcript');
  const statusEl = document.getElementById('convStatus');

  if (!convRecording) {
    convRecording = true;
    btn.classList.add('recording');
    box.classList.add('recording');
    statusEl.textContent = tr('Recording… speak clearly');
    btn.textContent = '⏹';

    // Start MediaRecorder using the shared stream (already granted by the drills).
    const mime = getAudioMimeType();
    const audioChunks = [];
    getSpeakingStream().then(stream => {
      if (!stream) return;
      convMediaRecorder = new MediaRecorder(stream, { mimeType: mime });
      convMediaRecorder.ondataavailable = (ev) => { if (ev.data.size > 0) audioChunks.push(ev.data); };
      convMediaRecorder.onstop = () => {
        // Do NOT stop stream.getTracks() — releaseSpeakingStream() handles cleanup.
        if (audioChunks.length > 0) audioRecordings['conversation'] = new Blob(audioChunks, { type: mime });
      };
      convMediaRecorder.start();
    }).catch(err => console.warn('[FluentPath] MediaRecorder failed for conversation:', err));

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SR();
    recognition.lang = 'en-US'; recognition.interimResults = true; recognition.continuous = true;
    let finalText = '';

    recognition.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalText += e.results[i][0].transcript + ' ';
        else interim += e.results[i][0].transcript;
      }
      tEl.textContent = finalText + interim;
      tEl.classList.add('show');
      saveAnswer('speaking_conv', finalText.trim());
    };
    recognition.onerror = (e) => {
      if (e.error !== 'aborted' && e.error !== 'no-speech') {
        console.warn('[FluentPath] Conversation speech recognition error:', e.error, e.message);
      }
      convRecording = false;
      btn.classList.remove('recording'); box.classList.remove('recording');
      btn.textContent = '🎤';
      // Do not stop convMediaRecorder here — the user may click stop manually,
      // and continuous recognition fires onerror transiently without ending the session
    };
    recognition.start();
  } else {
    convRecording = false;
    recognition?.stop();
    if (convMediaRecorder && convMediaRecorder.state !== 'inactive') convMediaRecorder.stop();
    btn.classList.remove('recording');
    box.classList.remove('recording');
    btn.textContent = '🎤';
    statusEl.textContent = tr('Recording saved. You can record again if you want.');
  }
}

function similarity(a, b) {
  const aW = a.split(' '), bW = b.split(' ');
  const match = aW.filter(w => bW.includes(w)).length;
  return match / Math.max(aW.length, bW.length);
}

// ── PRACTICE ──
function renderPractice(wrap, data) {
  const qs = (data.questions || []).map((q, qi) => {
    const opts = (q.options || []).map((o, oi) => `
      <div class="mcq-opt" id="po-${q.id}-${oi}" tabindex="0" role="button" aria-label="Option ${String.fromCharCode(65+oi)}: ${escHtml(o)}" onclick="selectPracticeOpt('${q.id}', ${oi}, ${q.correct})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();selectPracticeOpt('${q.id}', ${oi}, ${q.correct});}">
        <div class="opt-letter">${String.fromCharCode(65+oi)}</div>
        <div>${escHtml(o)}</div>
      </div>`).join('');
    return `
      <div style="margin-bottom:24px;">
        <div style="font-size:15px;font-weight:600;margin-bottom:10px;">${qi+1}. ${biText(q.question, q.question_es)}</div>
        <div class="mcq-options">${opts}</div>
        <div id="pf-${q.id}" aria-live="polite" style="font-size:12px;font-style:italic;margin-top:6px;display:none;"></div>
      </div>`;
  }).join('');

  wrap.innerHTML = `
    <div class="activity-card">
      <div class="ac-label">COMPREHENSION & PRACTICE</div>
      <div class="ac-heading">${biText(data.title, data.title_es)}</div>
      <div class="ac-body">${biText(data.instruction, data.instruction_es)}</div>
    </div>
    <div class="activity-card">${qs}</div>
  `;
}

function selectPracticeOpt(qid, chosen, correct) {
  document.querySelectorAll(`[id^="po-${qid}-"]`).forEach(el => { el.classList.add('disabled'); el.onclick = null; });
  const chosenEl = document.getElementById(`po-${qid}-${chosen}`);
  const correctEl = document.getElementById(`po-${qid}-${correct}`);
  const fb = document.getElementById(`pf-${qid}`);
  if (chosen === correct) {
    chosenEl?.classList.add('correct');
    if (fb) { fb.style.display='block'; fb.style.color='var(--green)'; fb.textContent=tr('✓ Correct!'); }
  } else {
    chosenEl?.classList.add('wrong');
    correctEl?.classList.add('correct');
    if (fb) { fb.style.display='block'; fb.style.color='var(--rust)'; fb.textContent=`Not quite — the answer was ${String.fromCharCode(65+correct)}.`; }
  }
  saveAnswer(`practice_${qid}`, chosen);
  saveAnswer(`practice_${qid}_correct`, correct);
  saveAnswer(`practice_${qid}_is_right`, chosen === correct ? 1 : 0);
  // Track practice score
  if (!state.answers['practice_total']) state.answers['practice_total'] = 0;
  if (!state.answers['practice_correct']) state.answers['practice_correct'] = 0;
  state.answers['practice_total']++;
  if (chosen === correct) state.answers['practice_correct']++;
}

// ── WRITING ──
function renderWriting(wrap, data) {
  wrap.innerHTML = `
    <div class="activity-card">
      <div class="ac-label">WRITING TASK</div>
      <div class="ac-heading">${biText(data.title, data.title_es)}</div>
      <div class="ac-body">${biText(data.instruction, data.instruction_es)}</div>
      <div style="margin-top:16px;background:var(--cream);border-left:4px solid var(--rust);padding:14px 18px;">
        <div style="font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:var(--muted);font-weight:600;margin-bottom:6px;">YOUR TASK</div>
        <div style="font-size:15px;color:var(--ink);line-height:1.7;">${biText(data.prompt, data.prompt_es)}</div>
      </div>
      <textarea class="writing-area" id="writing-resp" placeholder="Write your response here…" oninput="updateWritingWC(this, ${data.minWords || 50})" required></textarea>
      <div class="wc" id="writing-wc">0 words · aim for ${data.minWords || 50}+</div>
      <label style="display:flex;align-items:center;gap:8px;margin-top:12px;font-size:13px;color:var(--muted);cursor:pointer;">
        <input type="checkbox" id="writing-skip" onchange="toggleWritingSkip(this)"> Skip this writing task
      </label>
    </div>
  `;
}

function updateWritingWC(el, min) {
  const words = el.value.trim() ? el.value.trim().split(/\s+/).length : 0;
  const wc = document.getElementById('writing-wc');
  wc.textContent = `${words} word${words===1?'':'s'}${words >= min ? ' ✓' : ' · aim for ' + min + '+'}`;
  wc.style.color = words >= min ? 'var(--green)' : 'var(--muted)';
  saveAnswer('writing', el.value);
}

function toggleWritingSkip(checkbox) {
  var textarea = document.getElementById('writing-resp');
  if (checkbox.checked) {
    textarea.required = false;
    textarea.style.opacity = '0.4';
    textarea.disabled = true;
    saveAnswer('writing', '[SKIPPED]');
  } else {
    textarea.required = true;
    textarea.style.opacity = '';
    textarea.disabled = false;
    saveAnswer('writing', textarea.value);
  }
}

function toggleCourseSkip(checkbox, elementId, answerKey) {
  var el = document.getElementById(elementId);
  if (!el) return;
  if (checkbox.checked) {
    el.required = false;
    el.disabled = true;
    el.style.opacity = '0.4';
    saveAnswer(answerKey, '[SKIPPED]');
  } else {
    el.required = true;
    el.disabled = false;
    el.style.opacity = '';
    saveAnswer(answerKey, el.value);
  }
}

// ── REVIEW ──
function renderReview(wrap, data) {
  const takeaways = (data.keyTakeaways || []).map((t, i) => `
    <div style="display:flex;gap:14px;padding:12px 0;border-bottom:1px solid var(--rule);">
      <div style="width:24px;height:24px;background:var(--green);border-radius:50%;display:flex;align-items:center;justify-content:center;color:white;font-size:12px;font-weight:700;flex-shrink:0;">${i+1}</div>
      <div style="font-size:14px;line-height:1.7;">${escHtml(t)}</div>
    </div>`).join('');

  wrap.innerHTML = `
    <div class="activity-card">
      <div class="ac-label">LESSON REVIEW</div>
      <div class="ac-heading">${biText(data.title || 'What You Learned Today', data.title_es)}</div>
      <div style="margin-top:16px;">${takeaways}</div>
    </div>
    <div class="activity-card">
      <div class="ac-label">SELF-ASSESSMENT</div>
      <div class="ac-heading">${biText('How did today go?', '¿Cómo te fue hoy?')}</div>
      <div class="ac-body">${biText('Rate your confidence today and leave yourself a note.', 'Califica tu confianza hoy y déjate una nota.')}</div>
      <div style="margin-top:16px;display:flex;gap:10px;flex-wrap:wrap;">
        ${['😕 Hard','😐 OK','🙂 Good','😄 Great!'].map((l,i)=>`
          <button onclick="selectConfidence(this, ${i})" data-val="${i}"
            style="padding:10px 18px;border:1.5px solid var(--rule);background:white;cursor:pointer;font-size:14px;transition:all 0.2s;"
            class="conf-btn">${l}</button>`).join('')}
      </div>
      <textarea class="writing-area" id="review-notes" placeholder="Any notes for your teacher or yourself? What was hard? What was easy?" style="min-height:80px;" oninput="saveAnswer('review_notes', this.value)" required></textarea>
      <label style="display:flex;align-items:center;gap:8px;margin-top:8px;font-size:12px;color:var(--muted);cursor:pointer;"><input type="checkbox" onchange="toggleCourseSkip(this,'review-notes','review_notes')"> Skip this question</label>
    </div>
  `;
}

function selectConfidence(btn, val) {
  document.querySelectorAll('.conf-btn').forEach(b => { b.style.background='white'; b.style.borderColor='var(--rule)'; });
  btn.style.background = 'var(--green-bg)';
  btn.style.borderColor = 'var(--green)';
  saveAnswer('confidence', val);
}

// ══════════════════════════════════════════════════════
// NAVIGATION
// ══════════════════════════════════════════════════════
function nextStep() {
  if (state.currentStep < state.steps.length - 1) {
    state.currentStep++;
    renderStep();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (ckptInterval) saveLessonCheckpoint();
  } else {
    finishLesson();
  }
  if (state.currentStep === state.steps.length - 1) {
    document.getElementById('btnNext').textContent = tr('Finish Lesson ✓');
  } else {
    document.getElementById('btnNext').textContent = tr('Continue →');
  }
}


// ══════════════════════════════════════════════════════
// ANSWER STORAGE
// ══════════════════════════════════════════════════════
function saveAnswer(key, value) {
  state.answers[key] = value;
}

// ══════════════════════════════════════════════════════
// TIMER + PAUSE
// ══════════════════════════════════════════════════════
var paused = false;
var totalPausedTime = 0;  // seconds spent paused (reported to teacher)
var pauseStartedAt = 0;

function startTimer(initialElapsed) {
  state.timeElapsed = initialElapsed || 0;
  paused = false;
  updateTimerDisplay();
  state.timerInterval = setInterval(() => {
    if (paused) return;
    state.timeElapsed++;
    updateTimerDisplay();
    if (state.timeElapsed >= LESSON_DURATION) {
      clearInterval(state.timerInterval);
    }
  }, 1000);
  // Show pause button
  var pb = document.getElementById('navPause');
  if (pb) pb.style.display = '';
}

function updateTimerDisplay() {
  const remaining = Math.max(0, LESSON_DURATION - state.timeElapsed);
  const m = Math.floor(remaining / 60);
  const s = remaining % 60;
  const el = document.getElementById('navTimer');
  el.textContent = `${m}:${String(s).padStart(2,'0')}`;
  var cls = 'nav-timer';
  if (paused) cls += ' paused';
  else if (remaining < 600) cls += ' warning';
  el.className = cls;
}

function togglePause() {
  if (paused) {
    resumeLesson();
  } else {
    pauseLesson();
  }
}

function pauseLesson() {
  paused = true;
  pauseStartedAt = Date.now();
  updateTimerDisplay();
  var btn = document.getElementById('navPause');
  if (btn) { btn.textContent = '▶'; btn.title = 'Resume lesson'; }

  // Show pause overlay
  var overlay = document.getElementById('fp-pause-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'fp-pause-overlay';
    overlay.className = 'pause-overlay';
    overlay.innerHTML =
      '<div class="pause-card">' +
        '<div class="pause-title">Paused</div>' +
        '<div class="pause-sub">Your timer is paused. Click Resume when you\'re ready to continue.</div>' +
        '<button class="pause-resume" onclick="togglePause()">Resume</button>' +
      '</div>';
    document.body.appendChild(overlay);
  } else {
    overlay.style.display = 'flex';
  }
}

function resumeLesson() {
  paused = false;
  if (pauseStartedAt) {
    totalPausedTime += Math.round((Date.now() - pauseStartedAt) / 1000);
    pauseStartedAt = 0;
  }
  updateTimerDisplay();
  var btn = document.getElementById('navPause');
  if (btn) { btn.textContent = '⏸'; btn.title = 'Pause lesson'; }

  var overlay = document.getElementById('fp-pause-overlay');
  if (overlay) overlay.style.display = 'none';
}

// Auto-pause when tab is hidden
document.addEventListener('visibilitychange', function() {
  if (document.hidden && !paused && lessonInProgress) {
    pauseLesson();
  }
});

// ══════════════════════════════════════════════════════
// FINISH LESSON
// ══════════════════════════════════════════════════════
async function finishLesson() {
  lessonInProgress = false;
  if (paused) resumeLesson(); // ensure overlay is removed
  clearLessonCheckpoint();
  clearInterval(state.timerInterval);
  try { if (recognition) { recognition.stop(); convRecording = false; } } catch(e) {}
  // Stop any active drill recordings
  try { Object.keys(activeDrills).forEach(function(id) { stopDrill(id); }); } catch(e) {}

  var pb = document.getElementById('navPause');
  if (pb) pb.style.display = 'none';

  const endTime = new Date();
  const elapsed = Math.round(state.timeElapsed / 60);

  document.getElementById('stat-time').textContent = elapsed + 'm';
  document.getElementById('stat-steps').textContent = state.steps.length;
  document.getElementById('stat-day').textContent = state.dayNumber + ' / ' + FP.COURSE_DAYS;

  showScreen('screen-complete');
  document.getElementById('progressBar').style.width = '100%';

  // Save progress to localStorage so the hub page can track status
  try {
    localStorage.setItem('fp_student_name', state.studentName);
    localStorage.setItem('fp_cefr_level', state.level);
    localStorage.setItem('fp_last_lesson_day', String(state.dayNumber));
    localStorage.setItem('fp_last_lesson_date', state.lessonDate);
  } catch(e) { /* localStorage unavailable */ }

  // Block interaction while saving
  FP.showSaveOverlay('Saving your lesson — please wait…');

  // Upload audio recordings first (may take a few seconds)
  const statusEl = document.getElementById('saveStatus');
  let speakingAudioJson = null;
  if (!GOOGLE_SHEET_WEBHOOK.includes('YOUR_APPS_SCRIPT') && Object.keys(audioRecordings).length > 0) {
    FP.updateSaveOverlay('Uploading your recordings…');
    statusEl.textContent = tr('Uploading your recordings… please wait.');
    statusEl.className = 'save-status';
    speakingAudioJson = await uploadAudioRecordings();
    if (!speakingAudioJson) {
      statusEl.textContent = tr('⚠ Audio upload failed — your written work will still be saved.');
      statusEl.className = 'save-status warn';
    }
  }
  releaseSpeakingStream();

  // Save to Google Sheet
  FP.updateSaveOverlay('Saving your progress to Google Sheets…');
  statusEl.textContent = 'Saving your lesson progress…';
  statusEl.className = 'save-status';
  const saved = await saveProgress(endTime, speakingAudioJson);
  if (saved) {
    // Verify the save by reading back progress
    FP.updateSaveOverlay('Verifying save…');
    try {
      var verifyUrl = GOOGLE_SHEET_WEBHOOK + '?action=get_progress&student=' + encodeURIComponent(state.studentName);
      var verifyData = await FP.api.get(verifyUrl, { timeout: 15000 });
      var found = verifyData && verifyData.lessons && verifyData.lessons.some(function(l) {
        return String(l.day) === String(state.dayNumber);
      });
      if (found) {
        statusEl.textContent = '✓ Progress saved to your record.';
        statusEl.className = 'save-status ok';
      } else {
        statusEl.textContent = '⚠ Save may not have completed. Check your progress on the home page.';
        statusEl.className = 'save-status warn';
        console.warn('[FluentPath] Save verification: day ' + state.dayNumber + ' not found in progress data');
      }
    } catch(verifyErr) {
      // Verification failed but save was sent — show cautious success
      statusEl.textContent = '✓ Progress saved.';
      statusEl.className = 'save-status ok';
    }
  } else {
    statusEl.textContent = '⚠ Could not save to Google Sheets. Your progress was saved locally.';
    statusEl.className = 'save-status warn';
  }
  FP.hideSaveOverlay();
  document.getElementById('btnViewProgress').style.display = 'inline-block';
}

async function saveProgress(endTime, speakingAudioJson) {
  if (GOOGLE_SHEET_WEBHOOK.includes('YOUR_APPS_SCRIPT')) return false;

  const writing = document.getElementById('writing-resp')?.value || state.answers['writing'] || '';
  const notes   = document.getElementById('review-notes')?.value || state.answers['review_notes'] || '';
  const confMap = ['Hard','OK','Good','Great!'];
  const confVal = state.answers['confidence'] != null ? confMap[state.answers['confidence']] : 'Not rated';

  const payload = {
    action: 'save_progress',
    student_name:   state.studentName,
    level:          state.level,
    lesson_date:    state.lessonDate,
    day_number:     state.dayNumber,
    start_time:     state.startTime?.toLocaleTimeString() || '',
    end_time:       endTime.toLocaleTimeString(),
    time_spent_min: Math.round(state.timeElapsed / 60),
    paused_time_min: Math.round(totalPausedTime / 60),
    topic:          state.lessonContent?.topic || '',
    confidence:     confVal,
    writing_response: writing.substring(0, 2000),
    student_notes:  notes.substring(0, 1000),
    warmup_response: (state.answers['warmup'] || '').substring(0, 500),
    speaking_transcript: (state.answers['speaking_conv'] || '').substring(0, 1000),
    answers_json:   JSON.stringify(state.answers).substring(0, 5000),
    speaking_audio_json: speakingAudioJson || '',
    submitted_at:   new Date().toLocaleString(),
    vocabulary_words: JSON.stringify(
      (state.lessonContent && state.lessonContent.vocabulary && state.lessonContent.vocabulary.words)
        ? state.lessonContent.vocabulary.words.map(function(w) { return w.word; })
        : []
    ),
    course_id: localStorage.getItem('fp_course_id') || '1',
  };

  try {
    await FP.api.postForm(GOOGLE_SHEET_WEBHOOK, payload, { maxValueLength: 5000 });
    return true;
  } catch(e) {
    console.error('[FluentPath] Save progress failed:', e);
    return false;
  }
}

// ══════════════════════════════════════════════════════
// SPEECH SYNTHESIS
// ══════════════════════════════════════════════════════
function speakText(text, onEnd) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US'; u.rate = 0.85; u.pitch = 1;
  if (onEnd) u.onend = onEnd;
  window.speechSynthesis.speak(u);
}


// ══════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════
window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('lessonDate').value = new Date().toISOString().split('T')[0];
  if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();

  // Auto-fill name from hub
  var savedName = localStorage.getItem('fp_student_name');
  if (savedName) document.getElementById('studentName').value = savedName;

  // Auto-select and lock level from placement test results
  var savedLevel = localStorage.getItem('fp_cefr_level');
  if (savedLevel) {
    var card = document.querySelector('.level-card[data-level="' + savedLevel + '"]');
    if (card) selectLevel(card);
    lockLevelGrid(savedLevel);
  }

  tryResumeLesson();

  // Initialize video call request button
  if (typeof CallRequest !== 'undefined') {
    CallRequest.init({ page: 'lesson', dayNumber: state.dayNumber });
  }
});
