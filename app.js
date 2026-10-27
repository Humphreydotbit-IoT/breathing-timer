/* Breathing Timer — fully offline, no network calls. All data in localStorage. */
(() => {
  'use strict';

  // ---------- Config ----------
  const EXERCISES = {
    belly:  { name: 'Belly breathing', my: 'ဝမ်းဗိုက်ဖြင့် အသက်ရှူခြင်း', inhale: 4, exhale: 6, durations: [3, 4, 5], def: 3,
              inHint: 'Breathe in through the nose · နှာခေါင်းဖြင့် ရှူသွင်း', exHint: 'Breathe out through the mouth · ပါးစပ်ဖြင့် ရှူထုတ်' },
    pursed: { name: 'Pursed-lip breathing', my: 'နှုတ်ခမ်းစု၍ အသက်ရှူခြင်း', inhale: 2, exhale: 4, durations: [2, 3, 5], def: 2,
              inHint: 'Breathe in through the nose · နှာခေါင်းဖြင့် ရှူသွင်း', exHint: 'Out slowly through pursed lips · နှုတ်ခမ်းစု၍ ဖြည်းဖြည်းထုတ်' }
  };
  const STORE_KEY = 'breathingTimer.v1.sessions';
  const PREFS_KEY = 'breathingTimer.v1.prefs';
  const MIN_LOG_SECONDS = 10;
  const DAILY_GOAL = 3;
  const MIN_SCALE = 0.45, MAX_SCALE = 1.0;
  // Undocumented debug: ?speed=N multiplies session clock (for testing).
  const SPEED = (() => {
    const v = parseFloat(new URLSearchParams(location.search).get('speed'));
    return Number.isFinite(v) && v > 0 && v <= 100 ? v : 1;
  })();
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const el = {
    setup: $('setup'), durations: $('durations'), circle: $('circle'), ring: $('ring'),
    phase: $('phase'), hint: $('hint'), count: $('count'), remaining: $('remaining'),
    start: $('btnStart'), pause: $('btnPause'), resume: $('btnResume'), stop: $('btnStop'),
    beep: $('optBeep'), vib: $('optVib'), vibWrap: $('vibWrap'), status: $('status'),
    todayCount: $('todayCount'), streak: $('streak'), slots: $('slots'),
    history: $('history'), histEmpty: $('histEmpty'), exportBtn: $('btnExport'),
    dialog: $('logDialog'), form: $('logForm'), note: $('logNote'), summary: $('logSummary'), dizzyWarn: $('dizzyWarn')
  };

  // ---------- Helpers ----------
  const pad = (n) => String(n).padStart(2, '0');
  const fmtMMSS = (s) => { s = Math.max(0, Math.ceil(s - 1e-6)); return Math.floor(s / 60) + ':' + pad(s % 60); };
  const localISO = (d) => {
    const off = -d.getTimezoneOffset(), sign = off >= 0 ? '+' : '-', a = Math.abs(off);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' +
      pad(d.getMinutes()) + ':' + pad(d.getSeconds()) + sign + pad(Math.floor(a / 60)) + ':' + pad(a % 60);
  };
  const dayKey = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  const easeInOut = (t) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, t)));
  const setStatus = (msg) => { el.status.textContent = msg; };

  // ---------- Storage ----------
  function loadSessions() {
    try { const a = JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); return Array.isArray(a) ? a : []; }
    catch { return []; }
  }
  function saveSessions(list) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(list)); return true; }
    catch (e) { setStatus('Could not save (storage full or blocked).'); return false; }
  }
  function loadPrefs() { try { return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') || {}; } catch { return {}; } }
  function savePrefs() {
    const p = { exercise: currentExercise(), minutes: currentMinutes(), beep: el.beep.checked, vib: el.vib.checked };
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch {}
  }

  // ---------- Setup UI ----------
  const currentExercise = () => document.querySelector('input[name=exercise]:checked').value;
  const currentMinutes = () => { const r = document.querySelector('input[name=minutes]:checked'); return r ? +r.value : EXERCISES[currentExercise()].def; };

  function renderDurations(selected) {
    const ex = EXERCISES[currentExercise()];
    const pick = ex.durations.includes(selected) ? selected : ex.def;
    el.durations.innerHTML = '';
    for (const m of ex.durations) {
      const lab = document.createElement('label'); lab.className = 'opt';
      const inp = document.createElement('input'); inp.type = 'radio'; inp.name = 'minutes'; inp.value = m; inp.checked = m === pick;
      inp.setAttribute('aria-label', m + ' minutes');
      const sp = document.createElement('span'); sp.innerHTML = m + ' min <small lang="my">' + toMyDigits(m) + ' မိနစ်</small>';
      inp.addEventListener('change', () => { savePrefs(); showIdle(); });
      lab.append(inp, sp); el.durations.append(lab);
    }
  }
  const toMyDigits = (n) => String(n).replace(/\d/g, (d) => '၀၁၂၃၄၅၆၇၈၉'[d]);

  // ---------- Timer engine (drift-free: derived from performance.now deltas) ----------
  // state: 'idle' | 'running' | 'paused'
  const T = { state: 'idle', ex: null, plannedSec: 0, accumMs: 0, resumedAt: 0, startDate: null, lastPhaseKey: null, raf: 0, tick: 0 };

  function elapsedSec() {
    let ms = T.accumMs;
    if (T.state === 'running') ms += performance.now() - T.resumedAt;
    return (ms * SPEED) / 1000;
  }
  function phaseAt(t) {
    const ex = T.ex, cycle = ex.inhale + ex.exhale;
    const cycleIdx = Math.floor(t / cycle), inCycle = t - cycleIdx * cycle;
    if (inCycle < ex.inhale) return { kind: 'in', idx: cycleIdx * 2, progress: inCycle / ex.inhale, left: ex.inhale - inCycle };
    return { kind: 'out', idx: cycleIdx * 2 + 1, progress: (inCycle - ex.inhale) / ex.exhale, left: cycle - inCycle };
  }

  function start() {
    const key = currentExercise();
    T.ex = EXERCISES[key]; T.ex.key = key;
    T.plannedSec = currentMinutes() * 60;
    T.accumMs = 0; T.resumedAt = performance.now(); T.startDate = new Date(); T.lastPhaseKey = null;
    T.state = 'running';
    ensureAudio(); requestWakeLock();
    loop(); startTick(); updateButtons();
  }
  function pause() {
    if (T.state !== 'running') return;
    T.accumMs += performance.now() - T.resumedAt; T.state = 'paused';
    stopLoops(); releaseWakeLock(); render(); updateButtons();
    el.phase.innerHTML = 'Paused <span lang="my">ခဏရပ်ထား</span>';
  }
  function resume() {
    if (T.state !== 'paused') return;
    T.resumedAt = performance.now(); T.state = 'running'; T.lastPhaseKey = null; // relabel phase without re-cueing
    ensureAudio(); requestWakeLock(); loop(); startTick(); updateButtons();
  }
  function stop() { finish(false); }

  function finish(completed) {
    if (T.state === 'idle') return;
    const elapsed = Math.min(elapsedSec(), T.plannedSec);
    if (T.state === 'running') T.accumMs += performance.now() - T.resumedAt;
    T.state = 'idle'; stopLoops(); releaseWakeLock(); updateButtons();
    const rec = {
      id: uid(), start: localISO(T.startDate), exercise: T.ex.key, plannedSec: T.plannedSec,
      actualSec: Math.round(completed ? T.plannedSec : elapsed), completed, feeling: '', note: ''
    };
    if (completed) { cue('end'); el.phase.innerHTML = 'Well done <span lang="my">ကောင်းပါတယ်</span>'; }
    else showIdle();
    el.hint.innerHTML = '&nbsp;'; el.count.textContent = '–';
    setCircle(MIN_SCALE, 0);
    if (completed || rec.actualSec >= MIN_LOG_SECONDS) openLog(rec);
    else setStatus('Stopped before ' + MIN_LOG_SECONDS + ' s — not logged.');
  }

  function stopLoops() { cancelAnimationFrame(T.raf); T.raf = 0; clearInterval(T.tick); T.tick = 0; }
  function loop() { cancelAnimationFrame(T.raf); const f = () => { render(); if (T.state === 'running') T.raf = requestAnimationFrame(f); }; T.raf = requestAnimationFrame(f); }
  // rAF pauses in background tabs; this coarse tick keeps phase cues + end detection going (time still comes from performance.now).
  function startTick() { clearInterval(T.tick); T.tick = setInterval(render, 200); }

  function render() {
    if (T.state === 'idle' || !T.ex) return;
    const t = elapsedSec();
    if (T.state === 'running' && t >= T.plannedSec) { finish(true); return; }
    const p = phaseAt(t);
    if (T.state === 'running' && p.idx !== T.lastPhaseKey) {
      if (T.lastPhaseKey !== null || p.idx === 0) cue(p.kind); // single cue even if phases were skipped in background
      T.lastPhaseKey = p.idx;
      el.phase.innerHTML = p.kind === 'in' ? 'Inhale <span lang="my">ရှူသွင်း</span>' : 'Exhale <span lang="my">ရှူထုတ်</span>';
      el.hint.textContent = p.kind === 'in' ? T.ex.inHint : T.ex.exHint;
    }
    const e = easeInOut(p.progress);
    const scale = p.kind === 'in' ? MIN_SCALE + (MAX_SCALE - MIN_SCALE) * e : MAX_SCALE - (MAX_SCALE - MIN_SCALE) * e;
    setCircle(scale, p.progress);
    const c = String(Math.ceil(p.left - 1e-6));
    if (el.count.textContent !== c) el.count.textContent = c;
    const r = fmtMMSS(T.plannedSec - t);
    if (el.remaining.textContent !== r) el.remaining.textContent = r;
  }
  function setCircle(scale, progress) {
    if (reducedMotion.matches) {
      // No growing/shrinking motion: static circle, progress shown by a ring fill instead.
      el.circle.style.transform = 'scale(0.8)';
      el.ring.style.setProperty('--p', progress.toFixed(3));
    } else {
      el.circle.style.transform = 'scale(' + scale.toFixed(4) + ')';
    }
  }

  function updateButtons() {
    const s = T.state;
    el.start.hidden = s !== 'idle';
    el.pause.hidden = s !== 'running';
    el.resume.hidden = s !== 'paused';
    el.stop.hidden = s === 'idle';
    el.setup.disabled = s !== 'idle';
    const focusTarget = s === 'idle' ? el.start : s === 'running' ? el.pause : el.resume;
    if (document.activeElement && document.activeElement.tagName === 'BUTTON' && document.activeElement.hidden) focusTarget.focus();
  }
  function showIdle() {
    if (T.state !== 'idle') return;
    el.phase.innerHTML = 'Ready <span lang="my">အဆင်သင့်</span>';
    el.remaining.textContent = fmtMMSS(currentMinutes() * 60);
    el.count.textContent = '–'; el.hint.innerHTML = '&nbsp;';
  }

  // ---------- Cues: WebAudio beep + vibration ----------
  let audioCtx = null;
  function ensureAudio() {
    if (!el.beep.checked) return;
    try {
      if (!audioCtx) { const AC = window.AudioContext || window.webkitAudioContext; if (AC) audioCtx = new AC(); }
      if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    } catch {}
  }
  function beep(freq, dur = 0.18) {
    if (!el.beep.checked || !audioCtx || audioCtx.state !== 'running') return;
    const t0 = audioCtx.currentTime, o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.18, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(audioCtx.destination); o.start(t0); o.stop(t0 + dur + 0.02);
  }
  const canVibrate = typeof navigator.vibrate === 'function';
  function vibrate(pattern) { if (el.vib.checked && canVibrate) { try { navigator.vibrate(pattern); } catch {} } }
  function cue(kind) {
    if (document.hidden && kind !== 'end') { /* still try; browsers may throttle */ }
    if (kind === 'in') { beep(523.25); vibrate(60); }
    else if (kind === 'out') { beep(392); vibrate([30, 60, 30]); }
    else if (kind === 'end') { beep(523.25, 0.25); setTimeout(() => beep(659.25, 0.35), 260); vibrate([100, 80, 100]); }
  }

  // ---------- Wake Lock (graceful fallback) ----------
  let wakeLock = null;
  async function requestWakeLock() {
    if (!('wakeLock' in navigator)) { setStatus('Screen wake lock not supported — keep the screen on manually.'); return; }
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
      setStatus('Screen will stay awake during the session.');
    } catch { setStatus('Could not keep screen awake (battery saver?).'); }
  }
  function releaseWakeLock() { if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; } }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      if (T.state === 'running') { requestWakeLock(); render(); loop(); }
      renderStats();
    }
  });

  // ---------- Log dialog ----------
  let pendingRec = null;
  function openLog(rec) {
    pendingRec = rec;
    el.form.reset(); el.dizzyWarn.hidden = true;
    const ex = EXERCISES[rec.exercise];
    el.summary.textContent = ex.name + ' · ' + fmtMMSS(rec.actualSec) + ' / ' + fmtMMSS(rec.plannedSec) + (rec.completed ? ' · completed' : ' · stopped early');
    if (typeof el.dialog.showModal === 'function') el.dialog.showModal();
    else { el.dialog.setAttribute('open', ''); }
  }
  el.form.addEventListener('change', (e) => { if (e.target.name === 'feeling') el.dizzyWarn.hidden = e.target.value !== 'dizzy'; });
  el.dialog.addEventListener('close', () => {
    if (!pendingRec) return;
    if (el.dialog.returnValue === 'save') {
      const f = el.form.querySelector('input[name=feeling]:checked');
      pendingRec.feeling = f ? f.value : '';
      pendingRec.note = el.note.value.trim().slice(0, 500);
      const list = loadSessions(); list.push(pendingRec);
      if (saveSessions(list)) setStatus('Saved. ' + (pendingRec.completed ? 'Great job!' : ''));
    } else setStatus('Not saved.');
    pendingRec = null; el.dialog.returnValue = '';
    renderStats(); renderHistory(); showIdle();
  });

  // ---------- Stats: today slots + streak ----------
  const SLOTS = [
    { id: 'morning', label: 'Morning', my: 'မနက်', range: 'before 11:00', test: (h) => h < 11 },
    { id: 'lunch', label: 'After lunch', my: 'နေ့လည်', range: '11:00–16:00', test: (h) => h >= 11 && h < 16 },
    { id: 'evening', label: 'Evening', my: 'ညနေ', range: 'after 16:00', test: (h) => h >= 16 }
  ];
  function renderStats() {
    const list = loadSessions().filter((s) => s.completed);
    const now = new Date(), today = dayKey(now);
    const todays = list.filter((s) => dayKey(new Date(s.start)) === today);
    el.todayCount.textContent = Math.min(todays.length, 99) + '/' + DAILY_GOAL;
    el.slots.innerHTML = '';
    for (const sl of SLOTS) {
      const done = todays.some((s) => sl.test(new Date(s.start).getHours()));
      const li = document.createElement('li');
      li.className = (done ? 'done' : '') + (sl.test(now.getHours()) ? ' now' : '');
      li.innerHTML = '<span class="mark" aria-hidden="true">' + (done ? '✓' : '○') + '</span>' + sl.label +
        '<br><span lang="my">' + sl.my + '</span><br><small class="muted">' + sl.range + '</small>';
      li.setAttribute('aria-label', sl.label + ' (' + sl.range + '): ' + (done ? 'done' : 'not done'));
      el.slots.append(li);
    }
    // Streak: consecutive days with >=1 completed session, ending today (or yesterday if none yet today).
    const days = new Set(list.map((s) => dayKey(new Date(s.start))));
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (!days.has(dayKey(d))) d.setDate(d.getDate() - 1);
    let streak = 0;
    while (days.has(dayKey(d))) { streak++; d.setDate(d.getDate() - 1); }
    el.streak.textContent = streak;
  }

  // ---------- History ----------
  const FEEL = { better: 'Better · ပိုကောင်း', same: 'Same · အတူတူ', worse: 'Worse · ပိုဆိုး', dizzy: 'Dizzy · မူးဝေ' };
  function renderHistory() {
    const list = loadSessions().slice().sort((a, b) => new Date(b.start) - new Date(a.start));
    el.history.innerHTML = '';
    el.histEmpty.hidden = list.length > 0;
    for (const s of list) {
      const li = document.createElement('li');
      const meta = document.createElement('div'); meta.className = 'meta';
      const d = new Date(s.start);
      const when = d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
      const ex = EXERCISES[s.exercise] || { name: s.exercise };
      const t = document.createElement('div'); t.className = 't';
      t.textContent = when + ' · ' + ex.name;
      const b = document.createElement('span'); b.className = 'badge' + (s.completed ? ' ok' : '');
      b.textContent = s.completed ? '✓ done' : 'stopped'; t.append(b);
      const info = document.createElement('div');
      info.textContent = fmtMMSS(s.actualSec) + ' of ' + fmtMMSS(s.plannedSec) + (s.feeling ? ' · ' + (FEEL[s.feeling] || s.feeling) : '');
      meta.append(t, info);
      if (s.note) { const n = document.createElement('div'); n.className = 'note'; n.textContent = s.note; meta.append(n); }
      const del = document.createElement('button'); del.type = 'button'; del.className = 'del'; del.textContent = '✕';
      del.setAttribute('aria-label', 'Delete entry from ' + when);
      del.addEventListener('click', () => {
        if (!confirm('Delete this entry? / ဤမှတ်တမ်းကို ဖျက်မလား?\n' + when + ' · ' + ex.name)) return;
        saveSessions(loadSessions().filter((x) => x.id !== s.id));
        renderHistory(); renderStats(); setStatus('Entry deleted.');
      });
      li.append(meta, del); el.history.append(li);
    }
  }

  // ---------- CSV export ----------
  function csvCell(v) {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // neutralise spreadsheet formula injection in free text
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function buildCSV(list) {
    const head = ['id', 'start', 'exercise', 'planned_seconds', 'actual_seconds', 'completed', 'feeling', 'note'];
    const rows = list.slice().sort((a, b) => new Date(b.start) - new Date(a.start)).map((s) =>
      [s.id, s.start, s.exercise, s.plannedSec, s.actualSec, s.completed ? 'true' : 'false', s.feeling, s.note].map(csvCell).join(','));
    return '\uFEFF' + [head.join(','), ...rows].join('\r\n') + '\r\n';
  }
  el.exportBtn.addEventListener('click', () => {
    const csv = buildCSV(loadSessions());
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'breathing-log-' + dayKey(new Date()) + '.csv';
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    setStatus('CSV exported.');
  });

  // ---------- Wire up ----------
  el.start.addEventListener('click', start);
  el.pause.addEventListener('click', pause);
  el.resume.addEventListener('click', resume);
  el.stop.addEventListener('click', stop);
  el.beep.addEventListener('change', () => { savePrefs(); if (el.beep.checked) ensureAudio(); });
  el.vib.addEventListener('change', () => { savePrefs(); if (el.vib.checked) vibrate(40); });
  document.querySelectorAll('input[name=exercise]').forEach((r) => r.addEventListener('change', () => { renderDurations(); savePrefs(); showIdle(); }));
  reducedMotion.addEventListener && reducedMotion.addEventListener('change', () => { setCircle(MIN_SCALE, 0); });

  const prefs = loadPrefs();
  if (prefs.exercise && EXERCISES[prefs.exercise]) document.querySelector('input[name=exercise][value=' + prefs.exercise + ']').checked = true;
  if (typeof prefs.beep === 'boolean') el.beep.checked = prefs.beep;
  if (!canVibrate) { el.vib.checked = false; el.vib.disabled = true; el.vibWrap.title = 'Vibration not supported on this device/browser'; el.vibWrap.querySelector('span').append(' (n/a)'); }
  else if (typeof prefs.vib === 'boolean') el.vib.checked = prefs.vib; else el.vib.checked = true;
  renderDurations(prefs.minutes);
  setCircle(MIN_SCALE, 0);
  showIdle(); renderStats(); renderHistory();
  // Refresh "today"/slots periodically (e.g. app left open past midnight or 11:00/16:00).
  setInterval(() => { if (T.state === 'idle') renderStats(); }, 60000);

  // Debug/test hooks (harmless; nothing leaves the device).
  window.__bt = { buildCSV, loadSessions, elapsedSec, state: () => T.state, SPEED };

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW registration failed', e)); });
  }
})();
