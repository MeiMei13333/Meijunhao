// IT 单词打卡 V3 —— 纯本地实现（对应 PRD V3.0：多题型 + 易错本 + 分类进度 + 复习预告）
(function () {
'use strict';

/* ================= 数据与存储 ================= */
const WD = window.WD.map(e => ({ w: e[0], phon: e[1], mean: e[2], root: e[3], ex: e[4], cat: e[5] }));
const CATS = { prog: '编程', net: '网络', db: '数据库', ops: 'DevOps', web: '前端', sec: '安全', ai: 'AI/数据', os: '系统/硬件', custom: '自定义' };
const K = 'wc.v1.';
function load(k, d) { try { const v = localStorage.getItem(K + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
function save(k, v) { localStorage.setItem(K + k, JSON.stringify(v)); }

let STATUS = load('status', {});   // word小写 -> {st:'review'|'mastered', learned, reviews, last}
let CUSTOM = load('custom', []);   // 导入词 [{w,phon,mean,root,ex,cat:'custom',pending}]
let DAYS   = load('days', {});     // 'YYYY-MM-DD' -> {sec,checked,mk,awarded}
let SET    = Object.assign({ dailyN: 20, remindOn: false, remindTime: '20:00', types: ['choice', 'listen', 'cloze'] }, load('set', {}));
if (!Array.isArray(SET.types) || !SET.types.length) SET.types = ['choice', 'listen', 'cloze'];
let HARD   = load('hard', []);     // 易错词本：小写单词数组（累计答错≥2 自动入本 / 手动收藏）

/* ================= 积分与主题（V2） ================= */
let POINTS = load('points', { total: 0, unlocked: ['default'], active: 'default', log: [] });
const THEMES = [
  { id: 'default', name: '默认蓝', desc: '经典蓝白配色', price: 0, c1: '#2563eb', c2: '#1e3a8a', bg: '#f1f5f9' },
  { id: 'dark', name: '暗黑', desc: '夜间通勤护眼', price: 100, c1: '#0f172a', c2: '#334155', bg: '#1e293b' },
  { id: 'green', name: '护眼绿', desc: '柔和草木绿', price: 200, c1: '#2e7d32', c2: '#1b5e20', bg: '#eef5ee' },
  { id: 'orange', name: '活力橙', desc: '元气暖色调', price: 300, c1: '#ea580c', c2: '#9a3412', bg: '#fff5ec' }
];
function applyTheme(id) {
  if (id === 'default') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', id);
}
function unlockTheme(id) {
  const t = THEMES.find(x => x.id === id);
  if (POINTS.unlocked.includes(id)) { POINTS.active = id; save('points', POINTS); applyTheme(id); renderStats(); return; }
  if (POINTS.total < t.price) { toast('积分不足，还需 ' + (t.price - POINTS.total) + ' 分'); return; }
  POINTS.total -= t.price;
  POINTS.unlocked.push(id); POINTS.active = id;
  POINTS.log.unshift({ ds: todayStr(), buy: t.name, cost: t.price });
  save('points', POINTS); applyTheme(id); renderStats(); updHeader();
  toast('已解锁并切换「' + t.name + '」主题 🎨');
}
function awardCheckin(t) {
  const d = DAYS[t];
  if (!d || !d.checked || d.awarded || d.mk) return;
  const s = streak(), p = 10 * s;
  d.awarded = true;
  POINTS.total += p;
  POINTS.log.unshift({ ds: t, pts: p, streak: s });
  save('days', DAYS); save('points', POINTS);
  toast('🪐 打卡成功 +' + p + ' 积分（连续 ' + s + ' 天）');
}

let ALL = [];          // 内置 + 自定义
let BYWORD = {};       // 小写 -> 词条对象
function rebuild() {
  ALL = WD.concat(CUSTOM.map(c => Object.assign({ cat: 'custom' }, c)));
  BYWORD = {};
  ALL.forEach(o => { BYWORD[o.w.toLowerCase()] = o; });
}
rebuild();

/* ================= 北京时间 ================= */
const bjNow = () => new Date(Date.now() + 8 * 3.6e6);
const pad = n => (n < 10 ? '0' : '') + n;
const todayStr = () => bjNow().toISOString().slice(0, 10);
function shiftDay(ds, n) {
  const t = Date.parse(ds + 'T00:00:00+08:00') + n * 864e5;
  return new Date(t + 8 * 3.6e6).toISOString().slice(0, 10);
}
const fmtTime = s => pad(Math.floor(s / 60)) + ':' + pad(s % 60);

/* ================= 状态查询 ================= */
const stOf = w => STATUS[w.toLowerCase()];
function isUnlearned(o) { return !stOf(o.w); }
function reviewQueue() {
  const t = todayStr();
  return ALL.filter(o => { const s = stOf(o.w); return s && s.st === 'review' && s.learned < t; });
}
function learnedToday() {
  const t = todayStr();
  return ALL.filter(o => { const s = stOf(o.w); return s && s.learned === t; });
}
function isChecked(ds) { return DAYS[ds] && DAYS[ds].checked; }
function streak() {
  let d = todayStr();
  if (!isChecked(d)) d = shiftDay(d, -1);
  let n = 0;
  while (isChecked(d)) { n++; d = shiftDay(d, -1); }
  return n;
}

/* ================= 会话（内存，不持久化） ================= */
let session = null; // {mode:'study'|'review'|'hard', queue, idx, tried:{}, wc:{}}
function startStudy() {
  const pool = ALL.filter(isUnlearned);
  if (!pool.length) { toast('词库已学完，可导入新词'); return; }
  shuffle(pool);
  session = { mode: 'study', queue: pool.slice(0, Math.min(SET.dailyN, pool.length)), idx: 0, tried: {}, wc: {} };
  session.total = session.queue.length;
  renderStudy();
}
function startReview() {
  const q = reviewQueue();
  if (!q.length) return;
  shuffle(q);
  session = { mode: 'review', queue: q, idx: 0, tried: {}, wc: {} };
  session.total = session.queue.length;
  renderReview();
}
function startHard() {
  const q = HARD.map(w => BYWORD[w]).filter(Boolean);
  if (!q.length) { toast('易错本暂时是空的'); return; }
  shuffle(q);
  switchTab('study');
  session = { mode: 'hard', queue: q, idx: 0, tried: {}, wc: {} };
  session.total = q.length;
  renderStudy();
}

/* 答错计数与易错本 */
function addHard(key) { if (!HARD.includes(key)) { HARD.push(key); save('hard', HARD); } }
function removeHard(key) { const i = HARD.indexOf(key); if (i >= 0) { HARD.splice(i, 1); save('hard', HARD); } }
function recordWrong(s, o) {
  const key = o.w.toLowerCase();
  if (s.mode === 'study') {
    s.wc[key] = (s.wc[key] || 0) + 1;
    if (s.wc[key] >= 2) addHard(key);
  } else {
    const st = STATUS[key];
    if (st) { st.wrong = (st.wrong || 0) + 1; if (st.wrong >= 2) addHard(key); }
  }
}

/* ================= 计时与打卡 ================= */
setInterval(() => {
  if (document.hidden || !session) return;
  if (curTab !== 'study' && curTab !== 'review') return;
  const t = todayStr();
  const d = DAYS[t] || (DAYS[t] = { sec: 0, checked: false });
  d.sec++;
  if (d.sec % 5 === 0 || !d.checked) save('days', DAYS);
  if (!d.checked && d.sec > 600) { d.checked = true; save('days', DAYS); toast('🎉 今日打卡完成！'); awardCheckin(t); }
  updHeader();
}, 1000);

function updHeader() {
  const d = DAYS[todayStr()] || { sec: 0, checked: false };
  document.getElementById('hdTime').textContent = '⏱ ' + fmtTime(d.sec) + ' / 10:00';
  const bar = document.getElementById('hdBar');
  bar.style.width = Math.min(d.sec / 600, 1) * 100 + '%';
  bar.className = d.sec > 600 ? 'full' : '';
  const badge = document.getElementById('hdBadge');
  badge.textContent = d.checked ? '✓ 已打卡' : '未打卡';
  badge.className = 'pill' + (d.checked ? ' done' : '');
  document.getElementById('hdDate').textContent = todayStr().replace(/-/g, '.');
  document.getElementById('hdPts').textContent = '🪐 ' + POINTS.total;
  const rq = reviewQueue().length;
  document.getElementById('revDot').style.display = rq ? 'block' : 'none';
}

/* ================= 测验渲染 ================= */
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[a[i], a[j]] = [a[j], a[i]]; } return a; }

/* ---- 题型引擎（V3）：choice 看词选义 / listen 听音选词 / cloze 例句挖空 ---- */
function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function pickDistractors(o, field, n) {
  return shuffle(ALL.filter(x => x[field] !== o[field] && x[field]).map(x => x[field])).slice(0, n);
}
function makeQuestion(o) {
  let types = SET.types.slice();
  const parts = (o.ex || '').split('|');
  const clozeOk = !!parts[0] && new RegExp('\\b' + escRe(o.w) + '\\b', 'i').test(parts[0]);
  if (!clozeOk) types = types.filter(t => t !== 'cloze'); // 无可挖空例句时自动降级
  if (!types.length) types = ['choice'];
  const kind = types[Math.floor(Math.random() * types.length)];
  if (kind === 'listen' || kind === 'cloze') {
    const opts = shuffle([o.w].concat(pickDistractors(o, 'w', 3)));
    const sent = kind === 'cloze' ? parts[0].replace(new RegExp('\\b' + escRe(o.w) + '\\b', 'i'), '_____') : '';
    return { kind, o, opts, ans: o.w, sent, zh: parts[1] || '' };
  }
  const opts = shuffle([o.mean].concat(pickDistractors(o, 'mean', 3)));
  return { kind: 'choice', o, opts, ans: o.mean, sent: '', zh: '' };
}

function quizCard(s) {
  const o = s.queue[s.idx];
  const q = s.q = makeQuestion(o);
  const isRev = s.mode === 'review';
  const retry = !isRev && s.queue.length > s.total;
  const label = s.mode === 'hard' ? '易错词' : '新词';
  let head;
  if (q.kind === 'listen') {
    head = '<div class="qword">🎧</div>' +
      '<div class="qhint">听发音，选出听到的单词　<button class="speak" onclick="WC.speak(\'' + esc(o.w) + '\')">🔊</button></div>';
  } else if (q.kind === 'cloze') {
    head = '<div class="qhint">选出填入例句空格处的单词</div><div class="qsent">' + esc(q.sent) + '</div>';
  } else {
    head = '<div class="qword">' + esc(o.w) + '<button class="speak" onclick="WC.speak(\'' + esc(o.w) + '\')">🔊</button></div>' +
      '<div class="qphon">' + esc(o.phon || '') + '</div>' +
      (o.root && o.root !== '—' ? '<div class="qroot">' + esc(o.root) + '</div>' : '');
  }
  return '<div class="card qcard">' +
    '<div class="count">' + (isRev
      ? '第 ' + (s.idx + 1) + ' / ' + s.queue.length + ' 词（复习）'
      : '第 ' + (s.idx + 1) + ' / ' + s.queue.length + ' 题 · 本轮 ' + s.total + ' 词[' + label + ']' + (retry ? '（含重答）' : '')) + '</div>' +
    head +
    '<div class="opts" id="opts">' + q.opts.map(m => '<button class="opt" data-v="' + esc(m) + '">' + esc(m) + '</button>').join('') + '</div>' +
    '<button class="dk" id="dkBtn" onclick="WC.dontKnow()">🤔 不认识</button>' +
    '<div id="fbox"></div>' +
    '<div class="qfoot"><button class="btn" id="nextBtn" disabled onclick="WC.next()">下一词 →</button></div>' +
    '</div>';
}

function bindQuiz(s) {
  const q = s.q, o = q.o, key = o.w.toLowerCase();
  const isRev = s.mode === 'review';
  let done = false;
  if (q.kind === 'listen') setTimeout(() => { if (!done) WC.speak(o.w); }, 350);
  function settle(correct, viaDk) {
    if (done) return;
    done = true;
    document.querySelectorAll('#opts .opt').forEach(x => {
      x.disabled = true;
      if (x.dataset.v === q.ans) x.classList.add('right');
    });
    if (!correct) { s.tried[key] = true; recordWrong(s, o); }
    const parts = (o.ex || '').split('|');
    const reveal = q.kind === 'choice' ? '' :
      '<div class="qreveal"><b>' + esc(o.w) + '</b>' + esc(o.phon || '') + ' · ' + esc(o.mean) + '</div>';
    const tail = correct ? '' : (isRev ? '，明日继续复习' : '，稍后本轮会再考一次');
    const star = HARD.includes(key) ? '⭐ 移出易错本' : '☆ 加入易错本';
    document.getElementById('fbox').innerHTML =
      '<div class="fb ' + (correct ? 'ok' : 'no') + '">' + (correct ? '✅ 回答正确！' : (viaDk ? '💡 已揭示答案' : '❌ 回答错误') + '，正确答案已标出' + tail) +
      reveal +
      (parts[0] ? '<div class="ex">' + esc(parts[0]) + (parts[1] ? '<em>' + esc(parts[1]) + '</em>' : '') + '</div>' : '') +
      '<div class="row" style="margin-top:8px;gap:16px"><a href="javascript:void(0)" onclick="WC.detail(\'' + esc(o.w) + '\')">查看词条详情 ›</a>' +
      '<a href="javascript:void(0)" id="starLnk" onclick="WC.toggleStar(\'' + key + '\')" style="color:var(--warn)">' + star + '</a></div></div>';
    document.getElementById('dkBtn').disabled = true;
    document.getElementById('nextBtn').disabled = false;
    if (isRev) { // 复习：即时持久化，答错顺延次日，不重答
      const st = STATUS[key];
      st.reviews = (st.reviews || 0) + 1;
      st.last = correct ? 'ok' : 'no';
      if (correct) st.st = 'mastered';
      save('status', STATUS);
    } else if (!correct) { // 新词/易错词：排到队尾循环重答
      s.queue.push(o);
    }
  }
  document.querySelectorAll('#opts .opt').forEach(btn => {
    btn.onclick = () => {
      if (done) return;
      if (btn.dataset.v !== q.ans) btn.classList.add('wrong');
      settle(btn.dataset.v === q.ans, false);
    };
  });
  WC.dontKnow = () => settle(false, true);
}

window.WC = {
  speak: w => { try { const u = new SpeechSynthesisUtterance(w); u.lang = 'en-US'; speechSynthesis.speak(u); } catch (e) {} },
  next() {
    const s = session; if (!s) return;
    s.idx++;
    if (s.idx >= s.queue.length) {
      if (s.mode === 'study') {
        const t = todayStr();
        s.queue.forEach(o => {
          const key = o.w.toLowerCase();
          STATUS[key] = { st: 'review', learned: t, reviews: 0, last: null, wrong: s.wc[key] || 0 };
        });
        save('status', STATUS);
        toast('今日新词学习完成，明天全部复习 💪');
      } else if (s.mode === 'hard') {
        const cleared = s.queue.filter(o => !s.tried[o.w.toLowerCase()]).map(o => o.w.toLowerCase());
        cleared.forEach(removeHard);
        toast(cleared.length ? '易错词训练完成，移出 ' + cleared.length + ' 词 🎯' : '训练完成，顽固词留在本里继续练 💪');
      }
      session = null;
      renderStudy(); renderReview(); updHeader();
    } else {
      s.mode === 'review' ? renderReview() : renderStudy();
    }
  },
  detail: w => showDetail(BYWORD[w.toLowerCase()]),
  goto: tab => switchTab(tab),
  startHard: startHard,
  toggleStar(key) {
    if (HARD.includes(key)) removeHard(key); else addHard(key);
    const a = document.getElementById('starLnk');
    if (a) a.textContent = HARD.includes(key) ? '⭐ 移出易错本' : '☆ 加入易错本';
    toast(HARD.includes(key) ? '已加入易错本 ⭐' : '已移出易错本');
  }
};

/* ================= 页面：学习 ================= */
function renderStudy() {
  const el = document.getElementById('page-study');
  const rq = reviewQueue();
  const done = learnedToday().length;
  const pool = ALL.filter(isUnlearned).length;
  const active = session && (session.mode === 'study' || session.mode === 'hard');
  const toMorrow = ALL.filter(o => { const s = stOf(o.w); return s && s.st === 'review'; }).length;
  let h = '';
  if (rq.length && !active) h += '<div class="banner">🔁 今日有 <b>' + rq.length + '</b> 个待复习词（复习优先）<button class="btn sm" onclick="WC.goto(\'review\')">去复习</button></div>';
  if (active) {
    h += quizCard(session);
  } else {
    h += '<div class="card"><h3 style="margin-bottom:8px">今日任务</h3>' +
      '<p class="muted">每日新词量：<b style="color:var(--ink)">' + SET.dailyN + '</b>（⚙ 设置中可改）</p>' +
      '<p class="muted">已学 ' + done + ' / ' + Math.min(SET.dailyN, done + pool) + ' · 词库剩余 ' + pool + ' 词 · 明日待复习 <b style="color:var(--ink)">' + toMorrow + '</b> 词</p>' +
      (pool ? '<button class="btn" onclick="WC.startStudy()" style="margin-top:10px">开始学习' + (done ? '（重开一组）' : '') + '</button>'
            : '<div class="empty">🎉 内置+导入词已全部学完！可在单词本导入更多。</div>') +
      '<p class="muted" style="margin-top:12px">规则：学习/复习累计满 10 分钟自动打卡；中途退出本次会话不保存。</p></div>';
    if (HARD.length) h += '<div class="card"><div class="row spread"><div><b style="font-size:15px">⭐ 易错词本</b>' +
      '<p class="muted">答错≥2次自动收录，也可答题后手动收藏，现有 ' + HARD.length + ' 词</p></div>' +
      '<button class="btn sm ghost" onclick="WC.startHard()">刷易错词</button></div></div>';
  }
  el.innerHTML = h;
  if (active) bindQuiz(session);
}
window.WC.startStudy = startStudy;

/* ================= 页面：复习 ================= */
function renderReview() {
  const el = document.getElementById('page-review');
  const active = session && session.mode === 'review';
  const rq = active ? [] : reviewQueue();
  let h = '';
  if (active) h += quizCard(session);
  else if (rq.length) h += '<div class="card"><h3 style="margin-bottom:8px">今日复习</h3>' +
    '<p class="muted">' + rq.length + ' 个词来自前几天的学习，答对即「已掌握」，答错明日继续复习。</p>' +
    '<button class="btn" onclick="WC.startReview()" style="margin-top:10px">开始复习</button></div>';
  else h += '<div class="empty">✅ 今日没有待复习的词。<br>新学的词将在明天进入复习队列。</div>';
  el.innerHTML = h;
  if (active) bindQuiz(session);
}
window.WC.startReview = startReview;

/* ================= 页面：单词本 ================= */
let bookFilter = 'all', bookKw = '';
function wordStatus(o) {
  const s = stOf(o.w);
  if (!s) return ['new', '未学习'];
  if (s.st === 'mastered') return ['mastered', '已掌握'];
  return ['review', '待复习'];
}
function renderBook() {
  const el = document.getElementById('page-book');
  const kw = bookKw.trim().toLowerCase();
  const list = ALL.filter(o => {
    if (bookFilter === 'hard') {
      if (!HARD.includes(o.w.toLowerCase())) return false;
    } else {
      const [cls] = wordStatus(o);
      if (bookFilter !== 'all' && bookFilter !== cls) return false;
    }
    if (kw && o.w.toLowerCase().indexOf(kw) < 0 && o.mean.toLowerCase().indexOf(kw) < 0) return false;
    return true;
  });
  const counts = { all: ALL.length, new: 0, review: 0, mastered: 0, hard: HARD.length };
  ALL.forEach(o => counts[wordStatus(o)[0]]++);
  el.innerHTML =
    '<input class="search" id="bkSearch" placeholder="搜索单词或释义…" value="' + esc(bookKw) + '">' +
    '<div class="chips">' + [['all', '全部'], ['new', '未学习'], ['review', '待复习'], ['mastered', '已掌握'], ['hard', '⭐易错']]
      .map(([k, n]) => '<button class="chip' + (bookFilter === k ? ' on' : '') + '" data-f="' + k + '">' + n + ' ' + counts[k] + '</button>').join('') + '</div>' +
    '<div class="card" style="padding:12px"><div class="row spread" style="margin-bottom:8px"><b style="font-size:14px">📥 导入我的单词</b><button class="btn sm ghost" id="impToggle">展开</button></div>' +
    '<div id="impBox" style="display:none">' +
    '<textarea class="csv" id="impText" placeholder="每行一个：单词,中文释义&#10;例如：&#10;kubernetes,容器编排系统&#10;idempotent,幂等的"></textarea>' +
    '<div class="row" style="margin-top:8px"><input type="file" id="impFile" accept=".csv,.txt" style="font-size:12px">' +
    '<button class="btn sm" id="impGo">导入并自动补全</button></div>' +
    '<p class="muted" style="margin-top:6px">音标/例句将调用在线词典自动补全；离线时先入库标记「待补全」，联网后自动重试。</p></div></div>' +
    '<div class="card wlist">' + (list.length ? list.slice(0, 300).map(o => {
      const [cls, label] = wordStatus(o);
      const canDel = o.cat === 'custom' && cls === 'new';
      return '<div class="wrow" data-w="' + esc(o.w) + '"><span class="w">' + esc(o.w) + '</span>' +
        (o.pending ? '<span class="st custom">待补全</span>' : '') +
        '<span class="m">' + esc(o.mean) + '</span><span class="st ' + cls + '">' + label + '</span>' +
        (HARD.includes(o.w.toLowerCase()) ? '<span class="st hard">⭐</span>' : '') +
        (canDel ? '<button class="del" data-del="' + esc(o.w) + '">✕</button>' : '') + '</div>';
    }).join('') + (list.length > 300 ? '<p class="muted" style="padding-top:8px">仅显示前 300 条，可搜索缩小范围。</p>' : '')
      : '<div class="empty">没有符合条件的单词</div>') + '</div>';

  document.getElementById('bkSearch').oninput = e => { bookKw = e.target.value; renderBook(); };
  el.querySelectorAll('.chip').forEach(c => c.onclick = () => { bookFilter = c.dataset.f; renderBook(); });
  el.querySelectorAll('.wrow').forEach(r => r.onclick = ev => {
    if (ev.target.dataset.del) {
      const w = ev.target.dataset.del;
      if (confirm('删除导入词「' + w + '」？')) { CUSTOM = CUSTOM.filter(c => c.w !== w); save('custom', CUSTOM); rebuild(); renderBook(); }
      return;
    }
    showDetail(BYWORD[r.dataset.w.toLowerCase()]);
  });
  document.getElementById('impToggle').onclick = function () {
    const b = document.getElementById('impBox');
    const open = b.style.display !== 'none';
    b.style.display = open ? 'none' : 'block';
    this.textContent = open ? '展开' : '收起';
  };
  document.getElementById('impGo').onclick = doImport;
  document.getElementById('impFile').onchange = e => {
    const f = e.target.files[0]; if (!f) return;
    const rd = new FileReader();
    rd.onload = () => { document.getElementById('impText').value = rd.result; };
    rd.readAsText(f, 'utf-8');
  };
}

async function doImport() {
  const raw = document.getElementById('impText').value;
  const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (!lines.length) { toast('请先粘贴或选择内容'); return; }
  let ok = 0, dup = 0, bad = 0;
  const added = [];
  lines.forEach((l, i) => {
    const parts = l.split(/[,，\t]/).map(s => s.trim());
    const w = parts[0], mean = parts.slice(1).join('，');
    if (!w || !mean || !/^[A-Za-z][A-Za-z0-9 .\-_'`]*$/.test(w)) { bad++; return; }
    const key = w.toLowerCase();
    if (BYWORD[key] || added.some(a => a.w.toLowerCase() === key)) { dup++; return; }
    added.push({ w: w, phon: '', mean: mean, root: '', ex: '', pending: true });
  });
  if (!added.length) { renderBook(); toast('导入结果：新增 0 / 重复 ' + dup + ' / 无效 ' + bad); return; }
  CUSTOM = CUSTOM.concat(added);
  save('custom', CUSTOM); rebuild();
  document.getElementById('impText').value = '';
  renderBook();
  toast('已入库 ' + added.length + ' 词，正在自动补全…');
  for (const c of added) await enrich(c);
  save('custom', CUSTOM); renderBook();
  const done = added.filter(c => !c.pending).length;
  toast('导入完成：新增 ' + added.length + ' / 重复 ' + dup + ' / 无效 ' + bad + '；补全成功 ' + done);
}

async function enrich(c) {
  try {
    const r = await fetch('https://api.dictionaryapi.dev/api/v2/entries/en/' + encodeURIComponent(c.w.toLowerCase()));
    if (!r.ok) return;
    const j = await r.json();
    const e0 = j[0] || {};
    const ph = (e0.phonetics || []).find(p => p.text) || {};
    c.phon = ph.text ? '/' + ph.text.replace(/^\/|\/$/g, '') + '/' : c.phon;
    const m = (e0.meanings || [])[0] || {};
    const def = ((m.definitions || [])[0] || {});
    c.ex = def.example || '';
    if (c.ex) c.ex = c.ex + '|' + c.mean;
    c.pending = false;
  } catch (e) { /* 离线：保持待补全 */ }
  await new Promise(res => setTimeout(res, 250));
}

// 启动时重试待补全（单次最多 20 词）
async function retryPending() {
  const pend = CUSTOM.filter(c => c.pending).slice(0, 20);
  if (!pend.length) return;
  for (const c of pend) await enrich(c);
  save('custom', CUSTOM);
  if (curTab === 'book') renderBook();
}

/* ================= 页面：统计 ================= */
let calY, calM;
(function () { const b = bjNow(); calY = b.getUTCFullYear(); calM = b.getUTCMonth() + 1; })();

function renderStats() {
  const el = document.getElementById('page-stats');
  const t = todayStr();
  const total = Object.keys(DAYS).filter(d => DAYS[d].checked).length;
  const learned = Object.keys(STATUS).length;
  const mastered = Object.values(STATUS).filter(s => s.st === 'mastered').length;
  const toReview = reviewQueue().length;
  // 月历
  const first = Date.UTC(calY, calM - 1, 1) + 8 * 3.6e6;
  const firstDow = new Date(first).getUTCDay();
  const dim = new Date(Date.UTC(calY, calM, 0)).getUTCDate();
  let cells = '';
  for (let i = 0; i < firstDow; i++) cells += '<div class="cell" style="background:none"></div>';
  for (let d = 1; d <= dim; d++) {
    const ds = calY + '-' + pad(calM) + '-' + pad(d);
    const rec = DAYS[ds];
    let cls = 'cell';
    if (rec && rec.checked) cls += rec.mk ? ' mk' : ' done';
    else if (ds < t) cls += ' miss';
    else if (ds > t) cls += ' future';
    if (ds === t) cls += ' today';
    cells += '<div class="' + cls + '" data-ds="' + ds + '">' + d + '</div>';
  }
  const shop = THEMES.map(t => {
    const has = POINTS.unlocked.includes(t.id);
    const act = POINTS.active === t.id;
    const btn = act ? '<button class="btn sm" disabled>使用中</button>'
      : has ? '<button class="btn sm ghost" data-theme-id="' + t.id + '">使用</button>'
      : '<button class="btn sm" data-theme-id="' + t.id + '">' + t.price + ' 分解锁</button>';
    return '<div class="shoprow"><span class="swatch" style="background:linear-gradient(135deg,' + t.c1 + ',' + t.c2 + ')"></span>' +
      '<span class="nm">' + t.name + '<small>' + t.desc + (t.price ? ' · ' + t.price + ' 积分' : ' · 免费') + '</small></span>' + btn + '</div>';
  }).join('');
  const log = POINTS.log.slice(0, 5).map(l =>
    l.buy ? '<div class="logline">' + l.ds.replace(/-/g, '.') + ' 兑换「' + l.buy + '」 -' + l.cost + '</div>'
          : '<div class="logline">' + l.ds.replace(/-/g, '.') + ' 连续第 ' + l.streak + ' 天打卡 +' + l.pts + '</div>').join('');
  // 分类进度（V3）
  const catRows = Object.keys(CATS).map(c => {
    const items = ALL.filter(o => o.cat === c);
    if (!items.length) return '';
    const learned = items.filter(o => stOf(o.w)).length;
    const mastered = items.filter(o => { const s = stOf(o.w); return s && s.st === 'mastered'; }).length;
    return '<div class="catrow"><span class="cn">' + CATS[c] + '</span>' +
      '<div class="catbar"><i style="width:' + (learned / items.length * 100).toFixed(1) + '%"></i></div>' +
      '<span class="cnum">掌握 ' + mastered + ' / 已学 ' + learned + ' / 共 ' + items.length + '</span></div>';
  }).join('');
  const toMorrow = ALL.filter(o => { const s = stOf(o.w); return s && s.st === 'review'; }).length;
  el.innerHTML =
    '<div class="grid4" style="margin-bottom:12px">' +
    '<div class="stat"><b>🔥 ' + streak() + '</b><span>连续天数</span></div>' +
    '<div class="stat"><b>' + total + '</b><span>累计打卡（含补卡）</span></div>' +
    '<div class="stat"><b>' + learned + '</b><span>已学词</span></div>' +
    '<div class="stat"><b>' + mastered + '</b><span>已掌握</span></div></div>' +
    '<div class="card"><div class="row spread" style="margin-bottom:6px"><b style="font-size:16px">🪐 我的积分：' + POINTS.total + '</b>' +
    '<span class="muted">真实打卡得 10×连续天数，补卡不得分</span></div>' + shop +
    (log ? '<p class="muted" style="margin-top:10px">最近记录</p>' + log : '') + '</div>' +
    '<div class="card"><div class="row spread"><div><b style="font-size:16px">⭐ 易错词本</b>' +
    '<p class="muted">现有 ' + HARD.length + ' 词（答错≥2次自动收录，可手动收藏）</p></div>' +
    (HARD.length ? '<button class="btn sm" onclick="WC.startHard()">刷易错词</button>' : '') + '</div>' +
    '<p class="muted" style="margin-top:8px">📅 复习预告：今日复习队列 ' + toReview + ' 词 · 明日待复习 <b style="color:var(--ink)">' + toMorrow + '</b> 词（含今日新学与顺延）</p></div>' +
    '<div class="card"><b style="font-size:16px">📚 分类进度</b><div style="margin-top:6px">' + catRows + '</div></div>' +
    '<div class="card"><div class="calhead"><button class="btn sm ghost" id="calPrev">‹</button>' +
    '<b>' + calY + ' 年 ' + calM + ' 月</b><button class="btn sm ghost" id="calNext">›</button></div>' +
    '<div class="cal">' + ['日', '一', '二', '三', '四', '五', '六'].map(h => '<div class="h">' + h + '</div>').join('') + cells + '</div>' +
    '<p class="muted" style="margin-top:10px">● 已打卡　◌ 补卡　■ 漏卡（点击可补）</p></div>';
  document.getElementById('calPrev').onclick = () => { calM--; if (calM < 1) { calM = 12; calY--; } renderStats(); };
  document.getElementById('calNext').onclick = () => { calM++; if (calM > 12) { calM = 1; calY++; } renderStats(); };
  el.querySelectorAll('[data-theme-id]').forEach(b => b.onclick = () => unlockTheme(b.dataset.themeId));
  el.querySelectorAll('.cell.miss').forEach(c => c.onclick = () => {
    const ds = c.dataset.ds;
    if (confirm('为 ' + ds.replace(/-/g, '.') + ' 补卡？')) {
      DAYS[ds] = Object.assign({ sec: 0 }, DAYS[ds], { checked: true, mk: true });
      save('days', DAYS); renderStats(); updHeader();
    }
  });
}

/* ================= 详情弹层 ================= */
function showDetail(o) {
  if (!o) return;
  const s = stOf(o.w);
  const parts = (o.ex || '').split('|');
  document.getElementById('detailBody').innerHTML =
    '<h3>' + esc(o.w) + ' <button class="speak" onclick="WC.speak(\'' + esc(o.w) + '\')">🔊</button>' +
    '<button class="btn sm ghost" style="float:right" onclick="WC.closeMask()">关闭</button></h3>' +
    '<div class="kv"><b>音标</b><span>' + (esc(o.phon) || '<span class="muted">待补全</span>') + '</span></div>' +
    '<div class="kv"><b>释义</b><span>' + esc(o.mean) + '</span></div>' +
    '<div class="kv"><b>分类</b><span>' + (CATS[o.cat] || o.cat) + '</span></div>' +
    (o.root && o.root !== '—' ? '<div class="kv"><b>词根词缀</b><span>' + esc(o.root) + '</span></div>' : '') +
    (parts[0] ? '<div class="kv"><b>例句</b><span>' + esc(parts[0]) + (parts[1] ? '<em style="display:block;color:var(--sub);font-style:normal">' + esc(parts[1]) + '</em>' : '') + '</span></div>' : '') +
    (s ? '<div class="kv"><b>学习记录</b><span>' + wordStatus(o)[1] +
      (HARD.includes(o.w.toLowerCase()) ? '（⭐易错本）' : '') + ' · 学习于 ' + s.learned.replace(/-/g, '.') +
      (s.wrong ? ' · 累计答错 ' + s.wrong + ' 次' : '') +
      (s.reviews ? ' · 复习 ' + s.reviews + ' 次，最近' + (s.last === 'ok' ? '答对' : '答错') : '') + '</span></div>'
      : '<div class="kv"><b>学习记录</b><span class="muted">尚未学习</span></div>');
  document.getElementById('maskDetail').classList.add('on');
}

/* ================= 设置与提醒 ================= */
let remindTimer = null;
function schedule() {
  clearTimeout(remindTimer);
  if (!SET.remindOn) return;
  const b = bjNow();
  const [H, M] = SET.remindTime.split(':').map(Number);
  let ms = (H * 3600 + M * 60) * 1000 - (b.getUTCHours() * 3600 + b.getUTCMinutes() * 60 + b.getUTCSeconds()) * 1000 - b.getUTCMilliseconds();
  if (ms <= 0) ms += 864e5;
  remindTimer = setTimeout(() => {
    if (!isChecked(todayStr()) && 'Notification' in window && Notification.permission === 'granted') {
      new Notification('IT 单词打卡', { body: '今天还没有完成打卡，来 10 分钟吧！' });
    }
    schedule();
  }, ms);
}
function openSet() {
  document.getElementById('setN').value = SET.dailyN;
  document.getElementById('setTime').value = SET.remindTime;
  document.getElementById('remindState').textContent = SET.remindOn ? '已开启' : '未开启';
  document.querySelectorAll('#typeBox input').forEach(cb => { cb.checked = SET.types.includes(cb.value); });
  document.getElementById('maskSet').classList.add('on');
}
document.getElementById('btnSet').onclick = openSet;
document.getElementById('setClose').onclick = () => {
  const n = Math.max(5, Math.min(100, parseInt(document.getElementById('setN').value) || SET.dailyN));
  SET.dailyN = n;
  SET.remindTime = document.getElementById('setTime').value || SET.remindTime;
  const ts = [...document.querySelectorAll('#typeBox input')].filter(cb => cb.checked).map(cb => cb.value);
  if (!ts.length) { toast('至少保留一种题型，已默认看词选义'); SET.types = ['choice']; }
  else SET.types = ts;
  save('set', SET); schedule();
  document.getElementById('maskSet').classList.remove('on');
  renderStudy(); updHeader();
};
document.getElementById('setRemindOn').onclick = async () => {
  if (!('Notification' in window)) { toast('当前浏览器不支持通知'); return; }
  const p = await Notification.requestPermission();
  if (p === 'granted') { SET.remindOn = true; save('set', SET); schedule(); document.getElementById('remindState').textContent = '已开启（仅页面打开时生效）'; }
  else toast('通知权限被拒绝，可在浏览器设置中开启');
};
document.getElementById('setRemindOff').onclick = () => { SET.remindOn = false; save('set', SET); schedule(); document.getElementById('remindState').textContent = '未开启'; };
document.getElementById('copyRemind').onclick = async () => {
  const txt = '⏰ ' + SET.remindTime + ' IT 单词打卡：新词 ' + SET.dailyN + ' 个 + 复习，学满 10 分钟即完成打卡';
  try { await navigator.clipboard.writeText(txt); toast('已复制，去粘贴到手机闹钟/日程吧'); }
  catch (e) { toast('复制失败：' + txt); }
};
document.getElementById('btnReset').onclick = () => {
  if (confirm('确定清空全部本地数据（进度、打卡、导入词）？') && confirm('再次确认：此操作不可恢复。')) {
    ['status', 'custom', 'days', 'set', 'points', 'hard'].forEach(k => localStorage.removeItem(K + k));
    location.reload();
  }
};

/* ================= 导航与工具 ================= */
let curTab = 'study';
function switchTab(tab) {
  if (curTab === tab) return;
  session = null; // 切换即放弃当前会话（复习已答结果已即时保存）
  curTab = tab;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('on'));
  document.getElementById('page-' + tab).classList.add('on');
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t.dataset.tab === tab));
  if (tab === 'study') renderStudy();
  if (tab === 'review') renderReview();
  if (tab === 'book') renderBook();
  if (tab === 'stats') renderStats();
}
document.querySelectorAll('.tab').forEach(t => t.onclick = () => switchTab(t.dataset.tab));
document.querySelectorAll('.mask').forEach(m => m.onclick = e => { if (e.target === m) m.classList.remove('on'); });
window.WC.closeMask = () => document.querySelectorAll('.mask').forEach(m => m.classList.remove('on'));

let toastTimer = null;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), 2600);
}

/* ================= 启动 ================= */
applyTheme(POINTS.active);
updHeader();
renderStudy();
schedule();
retryPending();
setInterval(updHeader, 30000);
})();
