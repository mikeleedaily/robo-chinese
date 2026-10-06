/* 로보중국어 — 듀오링고 스타일 로봇산업 중국어 게임
   데이터: data.js (CONTENT) — 교재 전체 내용 포함 */
"use strict";

/* ───────────────────────────── 유틸 ───────────────────────────── */
const $ = (s, el) => (el || document).querySelector(s);
const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
const rnd = n => Math.floor(Math.random() * n);
const pick = a => a[rnd(a.length)];
const shuffle = a => { const x = [...a]; for (let i = x.length - 1; i > 0; i--) { const j = rnd(i + 1);[x[i], x[j]] = [x[j], x[i]]; } return x; };
const sample = (a, n) => shuffle(a).slice(0, n);
const dayKey = (d) => { const t = d ? new Date(d) : new Date(); return t.getFullYear() + "-" + String(t.getMonth() + 1).padStart(2, "0") + "-" + String(t.getDate()).padStart(2, "0"); };
const yesterdayKey = () => dayKey(new Date(Date.now() - 864e5));
const esc = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(t._tm); t._tm = setTimeout(() => t.classList.remove("show"), 1900); }

/* ───────────────────────────── 상태/저장 ───────────────────────────── */
const SKEY = "robozh_state_v1";
const DEFAULT_STATE = {
  v: 1, name: "학습자", firstTs: Date.now(),
  xp: 0, gems: 5,
  streak: { n: 0, last: "" },
  xpByDay: {},
  hearts: { n: 5, ts: Date.now() },
  lessons: {},            // id -> {done, plays, best, last}
  items: {},              // SRS itemKey -> {seen, ok, s, last, due}
  settings: { tts: true, ttsRate: 0.85, py: true, goal: 50, sfx: true, sfxVol: 2 },
  goalShown: "",
};
let S = loadState();
function loadState() {
  try {
    const raw = localStorage.getItem(SKEY);
    if (raw) { const o = JSON.parse(raw); return Object.assign(JSON.parse(JSON.stringify(DEFAULT_STATE)), o, { settings: Object.assign({}, DEFAULT_STATE.settings, o.settings || {}) }); }
  } catch (e) { }
  return JSON.parse(JSON.stringify(DEFAULT_STATE));
}
function save() { try { localStorage.setItem(SKEY, JSON.stringify(S)); } catch (e) { } }

/* 하트: 20분당 1개 자동 충전(최대 5) */
const HEART_REFILL_MS = 20 * 60 * 1000, HEART_MAX = 5;
function refillHearts() {
  const h = S.hearts;
  if (h.n >= HEART_MAX) { h.ts = Date.now(); return; }
  const gained = Math.floor((Date.now() - h.ts) / HEART_REFILL_MS);
  if (gained > 0) { h.n = Math.min(HEART_MAX, h.n + gained); h.ts = Date.now(); save(); }
  else { h.ts = Date.now() - ((Date.now() - h.ts) % HEART_REFILL_MS); }
}
function loseHeart() { S.hearts.n = Math.max(0, S.hearts.n - 1); S.hearts.ts = Date.now(); save(); }

/* 연속 학습일 */
function bumpStreak() {
  const t = dayKey();
  if (S.streak.last === t) return;
  S.streak.n = (S.streak.last === yesterdayKey()) ? S.streak.n + 1 : 1;
  S.streak.last = t;
}

/* SRS */
function itemRec(key) { if (!S.items[key]) S.items[key] = { seen: 0, ok: 0, s: 0, last: 0, due: 0 }; return S.items[key]; }
function srsUpdate(key, correct) {
  const r = itemRec(key);
  r.seen++; r.last = Date.now();
  if (correct) { r.ok++; r.s = Math.min(5, r.s + 1); } else { r.s = Math.max(0, r.s - 1); }
  r.due = Date.now() + r.s * 864e5 * 0.5 + (correct ? 0 : 36e5);
}
function dueItems(limit) {
  const now = Date.now();
  return Object.entries(S.items)
    .map(([k, r]) => ({ k, r }))
    .filter(x => x.r.seen > 0 && (x.r.due <= now || x.r.s <= 1) && x.r.ok < x.r.seen + 2)
    .sort((a, b) => (a.r.due - b.r.due) || (a.r.s - b.r.s))
    .slice(0, limit || 9);
}
function weakestItems(limit) {
  return Object.entries(S.items).map(([k, r]) => ({ k, r }))
    .filter(x => x.r.seen > 0).sort((a, b) => (a.r.s - b.r.s) || (b.r.seen - a.r.seen)).slice(0, limit);
}

/* ───────────────────────────── 사운드/TTS ───────────────────────────── */
let AC = null;
function ac() { if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { } } if (AC && AC.state === "suspended") AC.resume(); return AC; }
/* ── 듀오링고풍 SFX 엔진: 배음+엔벨로프 합성 (외부 파일 없음) ── */
function sfxVol() { return [0, 0.35, 0.6, 0.9][S.settings.sfxVol || 2] || 0.6; }
/* 단음: f=주파수, at=시작지연(s), dur=길이, opt{type, vol(0~1), harm(배음 세기 0~1), glide(끝 주파수 배율)} */
function note(f, at, dur, opt) {
  const c = ac(); if (!c || !S.settings.sfx) return;
  opt = opt || {};
  const v = (opt.vol == null ? 0.5 : opt.vol) * sfxVol();
  const t0 = c.currentTime + (at || 0);
  const voices = [[f, 1], [f * 2, (opt.harm == null ? 0.28 : opt.harm)], [f * 3.02, (opt.harm || 0) * 0.35]];
  voices.forEach(([fr, w]) => {
    if (w <= 0.01 || v * w < 0.003) return;
    const o = c.createOscillator(), g = c.createGain();
    o.type = opt.type || "sine";
    o.frequency.setValueAtTime(fr, t0);
    if (opt.glide) o.frequency.exponentialRampToValueAtTime(Math.max(30, fr * opt.glide), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.004, v * w), t0 + 0.012);        /* attack */
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);                          /* decay */
    o.connect(g); g.connect(c.destination); o.start(t0); o.stop(t0 + dur + 0.05);
  });
}
/* 탭 틱 (선택지·타일) */
const sTap = () => note(1250, 0, 0.035, { vol: 0.14, harm: 0 });
/* 짝 맞춤 팝 */
const sPop = () => note(430, 0, 0.09, { vol: 0.3, glide: 2.1, harm: 0.1 });
/* 정답 벨 '띵동' — 콤보가 오를수록 음이 높아짐(3단계마다 +1반음, 최대 +7) */
function sCorrect(combo) {
  const semi = Math.min(7, Math.floor((combo || 1) / 3));
  const r = Math.pow(2, semi / 12);
  note(784 * r, 0, 0.16, { vol: 0.5, harm: 0.3 });
  note(988 * r, 0.1, 0.24, { vol: 0.5, harm: 0.34 });
  if (semi >= 5) note(1319 * r, 0.22, 0.2, { vol: 0.22, harm: 0.2 }); /* 하이콤보 꼬리 */
}
/* 오답: 낮은 톤 두드림 + 서브섬프 */
function sWrong() {
  note(196, 0, 0.16, { type: "triangle", vol: 0.34, glide: 0.92, harm: 0.06 });
  note(98, 0.02, 0.22, { type: "sine", vol: 0.3, harm: 0 });
}
/* 레슨 완료 팡파레: 아르페지오 + 화음 + 쉬머 */
function sFanfare() {
  const seq = [[523, 0], [659, 0.11], [784, 0.22], [1046, 0.33]];
  seq.forEach(([f, t]) => note(f, t, 0.16, { vol: 0.42, harm: 0.3 }));
  [1046, 1318, 1568].forEach((f, i) => note(f, 0.46, 0.55, { vol: 0.3 - i * 0.05, harm: 0.22 }));
  note(2093, 0.5, 0.4, { type: "triangle", vol: 0.06, harm: 0 });
}
/* 일일 목표 달성 팡파레 */
function sGoal() {
  [[392, 0], [523, 0.1], [659, 0.2], [784, 0.3], [1046, 0.42]].forEach(([f, t]) => note(f, t, 0.18, { vol: 0.42, harm: 0.3 }));
  [1046, 1318].forEach((f, i) => note(f, 0.56, 0.6, { vol: 0.28 - i * 0.06, harm: 0.24 }));
}
/* 하트 소실 텁 */
const sHeartLost = () => note(150, 0, 0.25, { type: "sine", vol: 0.22, glide: 0.6, harm: 0 });
/* 햅틱 (Android 크롬 지원, iOS 웹앱은 API 없어 자동 무시) */
function vib(p) { if (S.settings.sfx && navigator.vibrate) { try { navigator.vibrate(p); } catch (e) { } } }

let zhVoice = null;
function findVoice() {
  const vs = speechSynthesis.getVoices();
  zhVoice = vs.find(v => /^zh([-_]CN)?$/i.test(v.lang)) || vs.find(v => /^zh/i.test(v.lang)) || null;
}
if ("speechSynthesis" in window) { findVoice(); speechSynthesis.onvoiceschanged = findVoice; }
function speak(text, rate) {
  if (!("speechSynthesis" in window) || !S.settings.tts) return;
  try {
    const u = new SpeechSynthesisUtterance(String(text).replace(/<[^>]+>/g, ""));
    u.lang = "zh-CN"; if (!zhVoice) findVoice(); if (zhVoice) u.voice = zhVoice;
    u.rate = rate || S.settings.ttsRate || 0.85;
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  } catch (e) { }
}

/* ───────────────────────────── 로봇 ───────────────────────────── */
function robotSVG(mood, size) {
  const s = size || 110;
  const mouth = mood === "sad" ? '<path d="M78 92 Q100 78 122 92" stroke="#3C3C3C" stroke-width="7" fill="none" stroke-linecap="round"/>'
    : mood === "wow" ? '<ellipse cx="100" cy="90" rx="13" ry="15" fill="#3C3C3C"/>'
      : '<path d="M76 88 Q100 108 124 88" stroke="#3C3C3C" stroke-width="7" fill="none" stroke-linecap="round"/>';
  const eyes = mood === "sad"
    ? '<circle cx="76" cy="64" r="9" fill="#3C3C3C"/><circle cx="124" cy="64" r="9" fill="#3C3C3C"/><path d="M64 50 Q76 44 88 50" stroke="#3C3C3C" stroke-width="6" fill="none" stroke-linecap="round"/><path d="M112 50 Q124 44 136 50" stroke="#3C3C3C" stroke-width="6" fill="none" stroke-linecap="round"/>'
    : '<circle cx="76" cy="64" r="10" fill="#3C3C3C"/><circle cx="124" cy="64" r="10" fill="#3C3C3C"/><circle cx="79.5" cy="60.5" r="3.4" fill="#fff"/><circle cx="127.5" cy="60.5" r="3.4" fill="#fff"/>';
  return `<svg class="robot" width="${s}" height="${s}" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
  <line x1="100" y1="10" x2="100" y2="34" stroke="#3C3C3C" stroke-width="7" stroke-linecap="round"/>
  <circle cx="100" cy="10" r="8" fill="#FFC800"/>
  <rect x="34" y="34" width="132" height="104" rx="30" fill="#58CC02" stroke="#3C3C3C" stroke-width="7"/>
  <rect x="50" y="50" width="100" height="70" rx="20" fill="#DDF4FF" stroke="#3C3C3C" stroke-width="5"/>
  ${eyes}${mouth}
  <rect x="24" y="74" width="10" height="26" rx="5" fill="#1CB0F6" stroke="#3C3C3C" stroke-width="4"/>
  <rect x="166" y="74" width="10" height="26" rx="5" fill="#1CB0F6" stroke="#3C3C3C" stroke-width="4"/>
  <rect x="62" y="146" width="76" height="12" rx="6" fill="#3C3C3C"/>
  <rect x="40" y="158" width="120" height="20" rx="10" fill="#CE82FF" stroke="#3C3C3C" stroke-width="5"/>
</svg>`;
}

/* ───────────────────────────── 콘텐츠 인덱스 ───────────────────────────── */
const ALL_WORDS = [], WORD_BY_HZ = {};
const ALL_SENT = [];
CONTENT.vocabChapters.forEach(ch => ch.words.forEach(w => { w._ch = ch.no; ALL_WORDS.push(w); WORD_BY_HZ[w.hz] = w; }));
CONTENT.readings.forEach(r => r.words.forEach(w => { if (!WORD_BY_HZ[w.hz]) { w._ch = "R"; ALL_WORDS.push(w); WORD_BY_HZ[w.hz] = w; } }));
if (CONTENT.reportSections) CONTENT.reportSections.forEach(rs => {
  (rs.vocabChapters || []).forEach(ch => ch.words.forEach(w => { if (!WORD_BY_HZ[w.hz]) { w._ch = "REP" + rs.id; ALL_WORDS.push(w); WORD_BY_HZ[w.hz] = w; } }));
  (rs.sentenceLessons || []).forEach(sl => sl.sents.forEach(x => { x._src = rs.title; ALL_SENT.push(x); }));
});
CONTENT.readings.forEach(r => r.sentences.forEach(s => ALL_SENT.push(Object.assign({ _src: "정독:" + r.title }, s))));
[CONTENT.meeting, CONTENT.curation].forEach(pkg => pkg.sections.forEach(sec => sec.blocks.forEach(b => {
  if (b.t === "dialogue") b.lines.forEach(l => ALL_SENT.push({ cn: l[1], py: "", kr: l[3], _src: sec.title }));
  if (b.t === "script") b.lines.forEach(l => ALL_SENT.push({ cn: l[0], py: l[1], kr: l[2], _src: sec.title }));
})));

/* 간이 형태소 사전(문장 조립용) — 최장 일치 */
const SEG_DICT = (() => {
  const d = new Set();
  ALL_WORDS.forEach(w => d.add(w.hz));
  ["初次见面", "请多关照", "谐波", "减速", "丝杠", "空杯", "力矩", "滚柱", "编码", "雷达", "执行", "降本", "放量", "样机", "量产", "国产", "替代", "渗透率", "市值", "估值", "募资", "融资", "壁垒", "龙头", "受益", "标的", "指的", "有望", "较为", "尚未", "均为", "皆为", "仍为", "仍", "较", "皆", "均"].forEach(x => d.add(x));
  ["机器", "人的", "是在", "可以", "我们", "你们", "他们", "什么", "怎么", "这个", "已经", "还有", "就是", "因为", "但是", "如果", "为了", "通过", "实现", "进行", "方面", "等", "特点", "主要", "目前", "其中", "包括", "应用", "使用", "工作", "合作", "欢迎", "参观", "大家", "请问", "需要", "多少", "怎么样", "便宜", "一点", "作为", "以及", "同时", "不同", "具备", "各种", "多个", "多种", "成为", "最", "大", "小", "多", "少", "好", "很", "都", "也", "还", "再", "又", "就", "才", "只", "和", "与", "及", "或", "的", "了", "在", "是", "有", "没", "不", "会", "能", "要", "想", "去", "来", "看", "听", "说", "做", "给", "让", "被", "把", "将", "从", "到", "为", "以", "于", "对", "向", "上", "下", "中", "里", "个", "一", "二", "三", "吗", "呢", "吧", "啊", "您", "我", "你", "他", "她", "它", "们", "人", "家", "公司", "产品", "技术", "系统", "平台", "方案", "企业", "产业", "行业", "全球", "国内", "海外", "市场", "客户", "用户", "服务", "支持", "提供", "打造", "谢谢", "请", "稍", "后", "回复", "问题", "确认", "当然", "随便", "随时", "问我", "认错"].forEach(x => d.add(x));
  return Array.from(d).filter(x => x && x.length >= 1).sort((a, b) => b.length - a.length);
})();
function segment(cn) {
  const out = []; let i = 0;
  const clean = cn.replace(/[，。、；：？！“”‘’（）,.:;?!]/g, "");
  while (i < clean.length) {
    let hit = null;
    for (const w of SEG_DICT) { if (w.length > 1 && clean.startsWith(w, i)) { hit = w; break; } }
    if (hit) { out.push(hit); i += hit.length; }
    else { out.push(clean[i]); i++; }
  }
  return out;
}

/* ───────────────────────────── 레슨 카탈로그 ───────────────────────────── */
const SEC_COLORS = [
  { key: "green", c: "#58CC02", d: "#46A302" },
  { key: "blue", c: "#1CB0F6", d: "#1899D6" },
  { key: "purple", c: "#CE82FF", d: "#A568CC" },
  { key: "orange", c: "#FF9600", d: "#E08600" },
  { key: "red", c: "#FF4B4B", d: "#EA2B2B" },
  { key: "gold", c: "#FFC800", d: "#E0AC00" },
  { key: "teal", c: "#00CD9C", d: "#00A884" },
  { key: "violet", c: "#8E6CD9", d: "#6E4FB8" },
  { key: "rose", c: "#FF7BAB", d: "#E05E8C" },
  { key: "steel", c: "#3A9BDC", d: "#2B7DB8" },
  { key: "brown", c: "#C98A2D", d: "#A96F1F" },
  { key: "gold2", c: "#FFC800", d: "#E0AC00" },
];
const LESSONS = [];
const SECTIONS = [
  { id: 0, title: "제1장 핵심 어휘", sub: "机器人的世界 · 로봇의 세계", icon: "🤖" },
  { id: 1, title: "제2장 문법 부스터", sub: "语法突破 · 원문 패턴 12", icon: "🏗️" },
  { id: 2, title: "제3장 원문 정독", sub: "原文精读 · 실제 포스터 6편", icon: "📜" },
  { id: 3, title: "제4장 미팅 중국어", sub: "会议中文 · 부스에서 협상까지", icon: "🤝" },
  { id: 4, title: "제5장 큐레이션", sub: "导览中文 · 관람객 안내", icon: "🎤" },
];
if (CONTENT.reportSections) {
  CONTENT.reportSections.forEach(rs => SECTIONS.push({ id: rs.id, title: rs.title, sub: rs.sub, icon: rs.icon, report: true }));
}
SECTIONS.push({ id: 11, title: "보너스 · 최종", sub: "附录 · 브랜드와 종합 시험", icon: "🏆" });
const SEC_BY_ID = {}; SECTIONS.forEach(x => SEC_BY_ID[x.id] = x);

(function buildCatalog() {
  CONTENT.vocabChapters.forEach(ch => {
    const half = Math.ceil(ch.words.length / 2);
    const parts = [["①", ch.words.slice(0, half)], ["②", ch.words.slice(half)]];
    parts.forEach(([sfx, words]) => {
      if (!words.length) return;
      LESSONS.push({
        id: "V" + ch.no + (sfx === "①" ? "a" : "b"), sec: 0, kind: "vocab", icon: "🤖",
        title: `${ch.kr} ${sfx}`, sub: ch.cn, chapter: ch, words,
      });
    });
  });
  for (let i = 0; i < CONTENT.grammar.length; i += 2) {
    const gs = CONTENT.grammar.slice(i, i + 2);
    LESSONS.push({
      id: "G" + (i / 2 + 1), sec: 1, kind: "grammar", icon: "🏗️",
      title: `문법 ${gs[0].no}–${gs[gs.length - 1].no}`, sub: gs.map(g => g.pattern.replace("……", "…")).join(" / "), points: gs,
    });
  }
  CONTENT.readings.forEach(r => LESSONS.push({
    id: "R" + r.no, sec: 2, kind: "reading", icon: "📜", title: "정독 " + r.no, sub: r.title, r,
  }));
  CONTENT.meeting.sections.forEach((sec, i) => LESSONS.push({
    id: "M" + (i + 1), sec: 3, kind: "phrase", icon: "🤝",
    title: "미팅 " + (i + 1), sub: sec.title.replace(/^\d\.\d\s*/, ""), secData: sec,
  }));
  CONTENT.curation.sections.forEach((sec, i) => LESSONS.push({
    id: "C" + (i + 1), sec: 4, kind: "phrase", icon: "🎤",
    title: "큐레이션 " + (i + 1), sub: sec.title.replace(/^\d\.\d\s*/, ""), secData: sec,
  }));
  LESSONS.push({ id: "N1", sec: 4, kind: "numbers", icon: "🔢", title: "숫자·단위 읽기", sub: "数字与单位" });
  if (CONTENT.reportSections) CONTENT.reportSections.forEach(rs => {
    (rs.vocabChapters || []).forEach(ch => {
      const half = Math.ceil(ch.words.length / 2);
      const parts = [["①", ch.words.slice(0, half)], ["②", ch.words.slice(half)]];
      parts.forEach(([sfx, words]) => {
        if (!words.length) return;
        LESSONS.push({
          id: "RU" + ch.no + (sfx === "①" ? "a" : "b"), sec: rs.id, kind: "vocab", icon: rs.icon,
          title: ch.kr + " " + sfx, sub: ch.cn || "", chapter: ch, words,
        });
      });
    });
    (rs.sentenceLessons || []).forEach((sl, i) => LESSONS.push({
      id: "RS" + rs.id + "_" + i, sec: rs.id, kind: "rsent", icon: "🧩",
      title: sl.title, sub: "문장 조립 · 번역", sents: sl.sents,
    }));
    if ((rs.fills || []).length) LESSONS.push({
      id: "RF" + rs.id, sec: rs.id, kind: "rfill", icon: "📐",
      title: "리포트 빈칸 채우기", sub: "语法填空 · 문어체 패턴", fills: rs.fills,
    });
    if ((rs.convs || []).length) LESSONS.push({
      id: "RC" + rs.id, sec: rs.id, kind: "rconv", icon: "💬",
      title: "문어체를 회화체로", sub: "文体转换 · 격식 표현 바꾸기", convs: rs.convs,
    });
    (rs.dialogues || []).forEach((d, i) => LESSONS.push({
      id: "RD" + rs.id + "_" + i, sec: rs.id, kind: "phrase", icon: "🗣",
      title: d.title, sub: "실전 대화", secData: { title: d.title, blocks: [{ t: "dialogue", lines: d.lines }] },
    }));
  });
  LESSONS.push({ id: "B1", sec: 11, kind: "brands", icon: "🏷️", title: "브랜드 발음", sub: "公司名指南" });
  LESSONS.push({ id: "F1", sec: 11, kind: "final", icon: "🏆", title: "최종 종합 시험", sub: "综合考试 · 전 범위" });
})();

function lessonState(id) { return S.lessons[id] || { done: false, plays: 0, best: 0, last: 0 }; }
function isUnlocked(i) {
  if (i <= 0) return true;
  const prev = LESSONS[i - 1];
  if (prev.id === "F1") return LESSONS.slice(0, i).every(l => lessonState(l.id).done);
  return lessonState(prev.id).done;
}
function currentIdx() {
  for (let i = 0; i < LESSONS.length; i++) if (!lessonState(LESSONS[i].id).done) return i;
  return LESSONS.length - 1;
}

/* ───────────────────────────── 연습 문제 생성 ───────────────────────────── */
function distractorWords(pool, excludeHz, n) {
  const p = (pool && pool.length > 3 ? pool : ALL_WORDS).filter(w => w.hz !== excludeHz);
  return sample(p, n || 3);
}
function optList(correct, wrongs, fmt) {
  const arr = shuffle([correct].concat(wrongs));
  return { arr, correctIdx: arr.indexOf(correct) };
}

function exMeaning(w, pool) { // 뜻 고르기 (한자 → 한국어)
  const wrong = distractorWords(pool, w.hz).map(x => x.kr);
  return { type: "mcq", item: { key: "w:" + w.hz, cn: w.hz, py: w.py, kr: w.kr }, q: "다음 단어의 뜻은?", big: w.hz, speakText: w.hz,
    opts: optList(w.kr, wrong).arr, answer: w.kr, sub: "(뜻 고르기)" };
}
function exHanzi(w, pool) { // 한국어 → 한자
  const wrong = distractorWords(pool, w.hz).map(x => x.hz);
  return { type: "mcq", item: { key: "w:" + w.hz, cn: w.hz, py: w.py, kr: w.kr }, q: "'" + w.kr + "'을(를) 중국어로:", hanziOpts: true,
    opts: optList(w.hz, wrong).arr, answer: w.hz, sub: "(한자 고르기)" };
}
function exListen(w, pool) { // 듣고 고르기
  const wrong = distractorWords(pool, w.hz).map(x => x.hz);
  return { type: "listen", item: { key: "w:" + w.hz, cn: w.hz, py: w.py, kr: w.kr }, q: "듣고 알맞은 한자를 고르세요",
    opts: optList(w.hz, wrong).arr, answer: w.hz, speakText: w.hz };
}
function exTrans(cn, py, kr, poolSent) { // 문장 → 한국어
  const wrong = sample((poolSent || ALL_SENT).filter(s => s.kr !== kr), 3).map(s => s.kr);
  return { type: "mcq", item: { key: "s:" + cn.slice(0, 12), cn, py, kr }, q: "이 문장의 뜻은?", big: cn, speakText: cn,
    opts: optList(kr, wrong).arr, answer: kr, sub: "(뜻 고르기)" };
}
function exBuild(cn, py, kr, toksIn) { // 문장 조립 (리포트 제공 토큰 우선)
  const toks = (toksIn && toksIn.length) ? toksIn.filter(t => t.trim()) : segment(cn);
  const extra = sample(segment(pick(ALL_SENT.filter(s => s.cn !== cn)).cn), 4).filter(t => !toks.includes(t)).slice(0, 3);
  while (extra.length < 3) extra.push(pick(["了", "的", "吗", "很", "在"]).repeat(1 + rnd(1)));
  return { type: "build", item: { key: "s:" + cn.slice(0, 12), cn, py, kr }, q: " 한국어와 같은 뜻이 되도록 조립하세요",
    krPrompt: kr, toks, bank: shuffle(toks.concat(extra)) };
}
function exConv(c) { // 문어체 → 회화체 변환
  return { type: "conv", item: { key: "cv:" + c.qzh, cn: c.qzh, py: "", kr: c.ako },
    q: "회의체로 바꿔 말하기 — 문어체 표현은?", promptCn: c.qzh, promptKo: c.qko,
    opts: c.opts, answer: c.answer, answerKo: c.ako };
}
function exPattern(g) { // 문법 패턴 고르기
  const wrong = sample(CONTENT.grammar.filter(x => x.no !== g.no), 3).map(x => x.pattern);
  return { type: "mcq", item: { key: "g:" + g.no, cn: g.pattern, py: g.py, kr: g.mean }, q: "'" + g.mean + "'에 알맞은 패턴은?",
    big: g.mean, patternOpts: true, opts: optList(g.pattern, wrong).arr, answer: g.pattern, sub: "(패턴 고르기)" };
}
function exFill(fb) { // 빈칸 채우기
  const wrong = sample(CONTENT.fillBlank.filter(x => x.ans !== fb.ans), 3).map(x => x.ans);
  return { type: "fill", item: { key: "f:" + fb.sent.slice(0, 10), cn: fb.sent, kr: fb.ans }, q: "빈칸에 알맞은 단어는?",
    sent: fb.sent, opts: optList(fb.ans, wrong).arr, answer: fb.ans, sub: "(빈칸 채우기)" };
}
function exNum(nu) { // 숫자 읽기
  const wrong = sample(CONTENT.numbers.filter(x => x.cn !== nu.cn), 3).map(x => x.cn);
  return { type: "mcq", item: { key: "n:" + nu.disp, cn: nu.cn, py: nu.py, kr: nu.disp }, q: "'" + nu.disp + "'을(를) 중국어로 읽으면?",
    big: nu.disp, numOpts: true, speakText: nu.cn, opts: optList(nu.cn, wrong).arr, answer: nu.cn, sub: "(읽기 고르기)" };
}
function exBrand(b) { // 브랜드
  const wrong = sample(CONTENT.brands.filter(x => x.cn !== b.cn), 3).map(x => x.en);
  return { type: "mcq", item: { key: "b:" + b.cn, cn: b.cn, py: b.py, kr: b.note }, q: "'" + b.cn + "'의 영문 브랜드는?",
    big: b.cn, speakText: b.cn, opts: optList(b.en, wrong).arr, answer: b.en, sub: "(브랜드 매칭)" };
}

function genExercises(lesson) {
  const ex = [];
  const k = lesson.kind;
  if (k === "vocab") {
    const ws = shuffle(lesson.words);
    ws.slice(0, 7).forEach(w => ex.push([exMeaning, exHanzi, exListen][rnd(3)](w, lesson.words)));
    ex.push(exMeaning(ws[7] || ws[0], lesson.words));
    ex.push({ type: "match", q: "짝을 맞추세요", pairs: sample(lesson.words, Math.min(5, lesson.words.length)) });
  } else if (k === "grammar") {
    lesson.points.forEach(g => {
      ex.push(exPattern(g));
      ex.push(exTrans(g.src.cn, g.src.py, g.src.kr));
      const m = pick(g.more);
      ex.push(rnd(2) ? exTrans(m.cn, m.py, m.kr) : exBuild(m.cn, m.py, m.kr));
    });
  } else if (k === "reading") {
    lesson.r.sentences.forEach(s => {
      if (s.cn.replace(/<[^>]+>/g, "").length <= 22 && rnd(2)) ex.push(exBuild(s.cn, s.py, s.kr));
      else ex.push(exTrans(s.cn, s.py, s.kr, lesson.r.sentences.map(x => ({ kr: x.kr }))));
    });
    sample(lesson.r.words, 3).forEach(w => ex.push([exMeaning, exListen][rnd(2)](w, lesson.r.words)));
    if (lesson.r.sentences[0]) ex.push({ type: "listen", item: { key: "s:" + lesson.r.sentences[0].cn.slice(0, 12) }, q: "듣고 알맞은 문장을 고르세요",
      sentListen: true, opts: optList(lesson.r.sentences[0].cn, sample(lesson.r.sentences.slice(1).map(s => s.cn).concat([pick(ALL_SENT).cn]), 3)).arr,
      answer: lesson.r.sentences[0].cn, speakText: lesson.r.sentences[0].cn });
  } else if (k === "phrase") {
    const rows = [], lines = [];
    lesson.secData.blocks.forEach(b => { if (b.t === "pset") rows.push(...b.rows); if (b.t === "dialogue") b.lines.forEach(l => lines.push(l)); if (b.t === "script") b.lines.forEach(l => lines.push([null, l[0], null, l[2]])); });
    shuffle(rows).slice(0, 6).forEach(r => {
      const w = { hz: r[0], py: r[1], kr: r[2] };
      ex.push(rnd(2) ? exListen(w, rows.map(x => ({ hz: x[0], py: x[1], kr: x[2] }))) : exTrans(r[0], r[1], r[2], rows.map(x => ({ kr: x[2] }))));
    });
    sample(lines, rows.length ? Math.min(3, lines.length) : Math.min(6, lines.length)).forEach(l => {
      const cn = l[1], py = l[2] || "", kr = l[3];
      ex.push(cn.length <= 20 && rnd(2) ? exBuild(cn, py, kr) : exTrans(cn, py, kr, lines.map(x => ({ kr: x[3] }))));
    });
    if (rows.length >= 5) ex.push({ type: "match", q: "짝을 맞추세요", pairs: sample(rows.map(r => ({ hz: r[0], py: r[1], kr: r[2] })), 5) });
  } else if (k === "numbers") {
    shuffle(CONTENT.numbers).forEach(nu => ex.push(rnd(2) ? exNum(nu) : exListen({ hz: nu.cn, py: nu.py, kr: nu.disp }, CONTENT.numbers.map(x => ({ hz: x.cn, py: x.py, kr: x.disp })))));
    ex.push({ type: "match", q: "짝을 맞추세요", pairs: CONTENT.numbers.map(n => ({ hz: n.cn, py: n.py, kr: n.disp })).slice(0, 5) });
  } else if (k === "brands") {
    CONTENT.brands.forEach(b => ex.push(rnd(2) ? exBrand(b) : exListen({ hz: b.cn, py: b.py, kr: b.en }, CONTENT.brands.map(x => ({ hz: x.cn, py: x.py, kr: x.en })))));
    ex.push({ type: "match", q: "회사와 영문 브랜드를 연결하세요", pairs: CONTENT.brands.map(b => ({ hz: b.cn, py: b.py, kr: b.en })).slice(0, 6) });
  } else if (k === "rsent") {
    const pool = lesson.sents;
    shuffle(pool).slice(0, 7).forEach(x => {
      const cn = x.cn, py = x.py || "", kr = x.ko;
      if (cn.replace(/<[^>]+>/g, "").length <= 20 && rnd(2)) ex.push(exBuild(cn, py, kr, x.toks));
      else ex.push(exTrans(cn, py, kr, pool));
    });
    const ls = pick(pool);
    if (ls && pool.length >= 4) ex.push({ type: "listen", item: { key: "s:" + ls.cn.slice(0, 12) }, q: "듣고 알맞은 문장을 고르세요",
      sentListen: true, opts: optList(ls.cn, sample(pool.filter(x => x.cn !== ls.cn).map(x => x.cn), 3)).arr,
      answer: ls.cn, speakText: ls.cn });
  } else if (k === "rfill") {
    shuffle(lesson.fills).forEach(f => ex.push(exFill({ sent: f.sent, ans: f.ans })));
    ex.push({ type: "match", q: "짝을 맞추세요", pairs: sample(ALL_WORDS, 5) });
  } else if (k === "rconv") {
    shuffle(lesson.convs).forEach(c => ex.push(exConv(c)));
  } else if (k === "final") {
    sample(ALL_WORDS, 5).forEach(w => ex.push([exMeaning, exListen, exHanzi][rnd(3)](w)));
    sample(CONTENT.grammar, 2).forEach(g => ex.push(exPattern(g)));
    sample(CONTENT.readings, 2).forEach(r => { const s = pick(r.sentences); ex.push(exTrans(s.cn, s.py, s.kr)); });
    sample(CONTENT.meeting.sections[2].blocks[0].rows, 2).forEach(r => ex.push(exTrans(r[0], r[1], r[2])));
    sample(CONTENT.fillBlank, 2).forEach(fb => ex.push(exFill(fb)));
    if (CONTENT.reportSections) sample(CONTENT.reportSections, 2).forEach(rs => {
      const all = (rs.sentenceLessons || []).reduce((a, sl) => a.concat(sl.sents), []);
      if (all.length) { const x = pick(all); ex.push(rnd(2) ? exTrans(x.cn, x.py, x.ko, all) : exBuild(x.cn, x.py || "", x.ko, x.toks)); }
      if ((rs.convs || []).length) ex.push(exConv(pick(rs.convs)));
    });
    sample(CONTENT.numbers, 2).forEach(nu => ex.push(exNum(nu)));
    sample(CONTENT.brands, 1).forEach(b => ex.push(exBrand(b)));
    ex.push({ type: "match", q: "최종 짝 맞추기", pairs: sample(ALL_WORDS, 5) });
  } else if (k === "review") {
    const items = dueItems(9);
    const pool = [];
    items.forEach(({ k: key }) => {
      const [kind, val] = [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1)];
      if (kind === "w" && WORD_BY_HZ[val]) pool.push([exMeaning, exListen, exHanzi][rnd(3)](WORD_BY_HZ[val]));
      else if (kind === "n") { const nu = CONTENT.numbers.find(n => n.disp === val); if (nu) pool.push(exNum(nu)); }
      else if (kind === "b") { const b = CONTENT.brands.find(x => x.cn === val); if (b) pool.push(exBrand(b)); }
      else if (kind === "cv") { let cc = null; (CONTENT.reportSections || []).forEach(rs => (rs.convs || []).forEach(c => { if (c.qzh === val && !cc) cc = c; })); if (cc) pool.push(exConv(cc)); }
      else if (kind === "g") { const g = CONTENT.grammar.find(x => String(x.no) === val); if (g) pool.push(exPattern(g)); }
      else if (kind === "f") { const fb = CONTENT.fillBlank.find(x => x.sent.startsWith(val)); if (fb) pool.push(exFill(fb)); }
      else { const s = ALL_SENT.find(x => x.cn.startsWith(val)); if (s) pool.push(rnd(2) ? exTrans(s.cn, s.py, s.kr) : (s.cn.length <= 20 ? exBuild(s.cn, s.py, s.kr) : exTrans(s.cn, s.py, s.kr))); }
    });
    while (pool.length < 6) { const w = pick(ALL_WORDS); pool.push(exMeaning(w)); }
    return shuffle(pool).slice(0, 9);
  }
  return ex;
}

/* ───────────────────────────── 라우터 ───────────────────────────── */
let VIEW = "home", LESSON = null;
function go(view) {
  VIEW = view;
  if (view === "home") renderHome();
  else if (view === "stats") renderStats();
  else if (view === "profile") renderProfile();
  window.scrollTo(0, 0);
}

/* ───────────────────────────── 홈(학습 경로) ───────────────────────────── */
function topbarHTML() {
  refillHearts();
  return `<div class="topbar">
    <div class="stat-chip streak-on" id="tb-streak"><span class="ico">🔥</span>${S.streak.n || 0}</div>
    <div class="stat-chip" style="color:var(--red)" id="tb-hearts"><span class="ico">❤️</span>${S.hearts.n}</div>
    <div class="stat-chip" style="color:var(--gold-d)" id="tb-gems"><span class="ico">💎</span>${S.gems}</div>
  </div>`;
}
function tabbarHTML(view) {
  return `<div class="tabbar">
    <button class="tab ${view === "home" ? "on" : ""}" data-go="home"><span class="t-ico">📚</span>학습</button>
    <button class="tab ${view === "stats" ? "on" : ""}" data-go="stats"><span class="t-ico">📊</span>기록</button>
    <button class="tab ${view === "profile" ? "on" : ""}" data-go="profile"><span class="t-ico">👤</span>프로필</button>
  </div>`;
}
function nodeHTML(lesson, i) {
  const st = lessonState(lesson.id);
  const unlocked = isUnlocked(i);
  const cur = i === currentIdx() && !st.done && unlocked;
  const col = SEC_COLORS[lesson.sec];
  const off = i % 3 === 0 ? "offset-l" : (i % 3 === 1 ? "" : "offset-r");
  return `<div class="node-row"><div class="node ${st.done ? "done" : ""} ${!unlocked ? "locked" : ""} ${cur ? "pop" : ""} ${off}">
    ${cur ? `<div class="bubble">시작</div>` : ""}
    <button class="dot" style="background:${col.c};box-shadow:0 5px 0 ${col.d}" data-lesson="${lesson.id}"
      aria-label="${esc(lesson.title)}">${lesson.icon}</button>
    ${st.done ? `<div class="badge">✓</div>` : ""}
  </div></div>`;
}
function renderHome() {
  refillHearts();
  let path = "";
  let curSec = -1;
  LESSONS.forEach((l, i) => {
    if (l.sec !== curSec) {
      curSec = l.sec;
      const sec = SEC_BY_ID[curSec], col = SEC_COLORS[curSec];
      const done = LESSONS.filter(x => x.sec === curSec && lessonState(x.id).done).length;
      const total = LESSONS.filter(x => x.sec === curSec).length;
      path += `<div class="section-banner" style="background:linear-gradient(135deg,${col.c},${col.d})">
        <div><div class="sb-title">${sec.icon} ${sec.title}</div><div class="sb-sub">${sec.sub} · ${done}/${total}</div></div>
        <button class="guide-btn" data-guide="${curSec}">가이드</button></div>`;
    }
    path += nodeHTML(l, i);
  });
  $("#app").innerHTML = topbarHTML() + `
    <div class="pathwrap">${path}</div>
    <button class="review-fab" id="review-fab">🔁 복습</button>` + tabbarHTML("home");
  bindCommon();
  $$("#app [data-lesson]").forEach(b => b.addEventListener("click", e => { e.stopPropagation(); openLessonPopup(b.dataset.lesson); }));
  $$("#app [data-guide]").forEach(b => b.addEventListener("click", e => { e.stopPropagation(); openGuide(+b.dataset.guide); }));
  $("#review-fab").addEventListener("click", () => {
    const di = dueItems(1);
    startLesson({ id: "__review", sec: 0, kind: "review", icon: "🔁", title: "복습", sub: "약한 항목 집중 훈련" });
  });
}

/* 노드 팝업 */
function openLessonPopup(id) {
  const i = LESSONS.findIndex(l => l.id === id);
  const l = LESSONS[i]; const st = lessonState(id);
  if (!isUnlocked(i)) { toast("🔒 먼저 이전 단원을 완료하세요!"); return; }
  const col = SEC_COLORS[l.sec];
  const dur = l.kind === "final" ? "15문항" : l.kind === "vocab" ? "10문항" : "8문항";
  modal(`<h2>${l.icon} ${esc(l.title)}</h2>
    <div class="desc">${esc(l.sub || "")}<br>예상 문항 ${dur} · 완료 시 +10 XP ${st.done ? "· 완료됨(다시 풀기 +5 XP)" : ""}</div>
    <div style="height:16px"></div>
    <button class="btn big btn-green" id="pop-start">${st.done ? "다시 풀기" : "시작하기"}</button>
    <div style="height:10px"></div>
    <button class="btn big btn-outline" id="pop-guide">가이드 보기</button>`);
  $("#pop-start").addEventListener("click", () => { closeModal(); startLesson(l); });
  $("#pop-guide").addEventListener("click", () => openGuide(l.sec));
}

/* ───────────────────────────── 가이드(교재 원문 뷰어) ───────────────────────────── */
function guideItemRow(hz, py, kr) {
  return `<div class="guide-item">
    <button class="speaker small" data-say="${esc(hz)}">🔊</button>
    <div class="g-hz hanzi">${esc(hz)}</div>
    <div class="g-mid"><div class="g-py">${esc(py || "")}</div><div class="g-kr">${esc(kr)}</div></div></div>`;
}
function openGuide(secId) {
  let body = "";
  if (secId === 0) {
    CONTENT.vocabChapters.forEach(ch => {
      body += `<div class="guide-block"><b>${ch.no}과 ${esc(ch.kr)} · ${esc(ch.cn)}</b><br>${esc(ch.intro)}</div>` +
        ch.words.map(w => guideItemRow(w.hz, w.py, w.kr)).join("");
    });
  } else if (secId === 1) {
    CONTENT.grammar.forEach(g => {
      body += `<div class="guide-block"><b>${g.no}. ${esc(g.pattern)} <span class="tag">${esc(g.py)}</span></b><br>${esc(g.mean)}<br><br>${esc(g.explain)}
        <div style="height:6px"></div><div class="cn hanzi">${esc(g.src.cn)}</div><div class="py">${esc(g.src.py)}</div><div class="kr">${esc(g.src.kr)}</div></div>`;
    });
  } else if (secId === 2) {
    CONTENT.readings.forEach(r => {
      body += `<div class="guide-block"><b>정독 ${r.no} · ${esc(r.title)}</b> <span class="tag">${esc(r.source)}</span></div>`;
      r.sentences.forEach(s => { body += `<div class="guide-block"><div class="cn hanzi">${esc(s.cn)}</div><div class="py">${esc(s.py)}</div><div class="kr">${esc(s.kr)}</div></div>`; });
      body += r.words.map(w => guideItemRow(w.hz, w.py, w.kr)).join("");
    });
  } else if (secId >= 6 && CONTENT.reportSections) {
    const rs = CONTENT.reportSections.find(x => x.id === secId);
    if (rs) {
      (rs.vocabChapters || []).forEach(ch => {
        body += `<div class="guide-block"><b>${esc(ch.kr)}${ch.cn ? " · " + esc(ch.cn) : ""}</b><br>${esc(ch.intro)}</div>` +
          ch.words.map(w => guideItemRow(w.hz, w.py, w.kr)).join("");
      });
      (rs.sentenceLessons || []).forEach(sl => {
        body += `<div class="guide-block"><b>🧩 ${esc(sl.title)}</b></div>`;
        sl.sents.forEach(x => { body += `<div class="guide-block"><div class="cn hanzi">${esc(x.cn)}</div>${x.py ? `<div class="py">${esc(x.py)}</div>` : ""}<div class="kr">${esc(x.ko)}</div></div>`; });
      });
      (rs.fills || []).forEach(f => { body += `<div class="guide-block cn hanzi">${esc(f.sent)} <b style="color:var(--green-d)">〔${esc(f.ans)}〕</b></div>`; });
      (rs.convs || []).forEach(c => { body += `<div class="guide-block"><span class="cn hanzi">${esc(c.qzh)}</span> → <b class="hanzi" style="color:var(--blue-d)">${esc(c.answer)}</b><div class="kr">${esc(c.ako)}</div></div>`; });
      (rs.dialogues || []).forEach(d => {
        body += `<div class="guide-block"><b>🗣 ${esc(d.title)}</b></div>`;
        d.lines.forEach(l => { body += `<div class="guide-block"><b>${l[0]}:</b> <span class="cn hanzi">${esc(l[1])}</span> <button class="speaker small" data-say="${esc(l[1])}">🔊</button><div class="kr">${esc(l[3])}</div></div>`; });
      });
    }
  } else {
    const pkg = secId === 3 ? CONTENT.meeting : secId === 4 ? CONTENT.curation : null;
    if (pkg) {
      body += `<div class="guide-block">${esc(pkg.intro)}</div>`;
      pkg.sections.forEach(sec => {
        body += `<div class="guide-block"><b>${esc(sec.title)}</b></div>`;
        sec.blocks.forEach(b => {
          if (b.t === "pset") b.rows.forEach(r => body += guideItemRow(r[0], r[1], r[2]));
          if (b.t === "dialogue") b.lines.forEach(l => body += `<div class="guide-block"><b>${l[0]}:</b> <span class="cn hanzi">${esc(l[1])}</span> <button class="speaker small" data-say="${esc(l[1])}">🔊</button><div class="py">${esc(l[2])}</div><div class="kr">${esc(l[3])}</div></div>`);
          if (b.t === "script") b.lines.forEach(l => body += `<div class="guide-block"><span class="cn hanzi">${esc(l[0])}</span> <button class="speaker small" data-say="${esc(l[0])}">🔊</button><div class="py">${esc(l[1])}</div><div class="kr">${esc(l[2])}</div></div>`);
        });
      });
      if (secId === 4) CONTENT.numbers.forEach(n => body += guideItemRow(n.cn, n.py, n.disp + " — " + n.note));
    }
    if (secId === 5 || secId === 11) CONTENT.brands.forEach(b => body += guideItemRow(b.cn, b.py, b.en + " · " + b.note));
  }
  modal(`<h2>📖 ${SEC_BY_ID[secId].title} 가이드</h2><div class="desc">${esc(SEC_BY_ID[secId].sub)} — 교재 원문 전문 (소리 내어 듣기 가능)</div>${body}
    <div style="height:14px"></div><button class="btn big btn-green" id="g-close">닫기</button>`);
  $("#g-close").addEventListener("click", closeModal);
}

/* ───────────────────────────── 레슨 엔진 ───────────────────────────── */
function startLesson(lesson) {
  if (S.hearts.n <= 0) { heartsEmptyModal(); return; }
  LESSON = {
    lesson, queue: genExercises(lesson), idx: 0,
    asked: 0, correct: 0, xp: 0, requeued: new Set(), combo: 0,
  };
  if (!LESSON.queue.length) { toast("학습할 항목이 부족합니다"); return; }
  renderLesson();
}
function renderLesson() {
  const L = LESSON;
  if (L.idx >= L.queue.length) { finishLesson(); return; }
  const ex = L.queue[L.idx];
  const prog = Math.round((L.idx / L.queue.length) * 100);
  $("#app").innerHTML = `
    <div class="lesson-top">
      <button class="close" id="ls-close">✕</button>
      <div class="pbar"><div class="fill" style="width:${prog}%"></div></div>
      <div class="stat-chip" style="color:var(--red);font-size:16px"><span class="ico">❤️</span>${S.hearts.n}</div>
    </div>
    <div class="lesson-body" id="ex-area"></div>
    <div class="corner-robot" id="crobot">${robotSVG("happy", 46)}</div>
    <div class="checkbar" id="checkbar">
      <button class="btn big btn-gray" id="btn-check" disabled>확인</button>
    </div>
    <div class="feedback" id="feedback"></div>`;
  $("#ls-close").addEventListener("click", () => {
    modal(`<h2>정말 그만둘까요?</h2><div class="desc">지금까지의 진행 상황은 저장되지 않아요.</div><div style="height:14px"></div>
      <button class="btn big btn-red" id="q-yes">그만두기</button><div style="height:10px"></div>
      <button class="btn big btn-outline" id="q-no">계속하기</button>`);
    $("#q-yes").addEventListener("click", () => { closeModal(); LESSON = null; go("home"); });
    $("#q-no").addEventListener("click", closeModal);
  });
  renderExercise(ex);
}

function renderExercise(ex) {
  const area = $("#ex-area");
  $("#checkbar").innerHTML = `<button class="btn big btn-gray" id="btn-check" disabled>확인</button>`;
  let html = `<div class="q-kind">${kindLabel(ex)}</div>`;
  if (ex.type === "mcq") {
    html += `<div class="q-prompt">${esc(ex.q)}</div>`;
    if (ex.big) {
      const py = ex.item && ex.item.py && S.settings.py && !ex.numOpts && !ex.patternOpts ? `<div class="py-line">${esc(ex.item.py)}</div>` : "";
      html += `<div class="q-cn hanzi">${esc(ex.big)} ${ex.speakText ? `<button class="speaker small" data-say="${esc(ex.speakText)}">🔊</button>` : ""}</div>${py}`;
    }
    html += `<div class="opts" id="opts">` + ex.opts.map((o, i) =>
      `<button class="opt" data-i="${i}"><span class="key">${i + 1}</span><span class="${ex.hanziOpts ? "o-hz hanzi" : ""}">${esc(o)}</span></button>`).join("") + `</div>`;
    area.innerHTML = html;
    let sel = null;
    $$("#opts .opt").forEach(b => b.addEventListener("click", () => {
      $$("#opts .opt").forEach(x => x.classList.remove("sel"));
      b.classList.add("sel"); sel = +b.dataset.i; $("#btn-check").disabled = false; sTap();
    }));
    onCheck(() => {
      const val = ex.opts[sel];
      grade(ex, val === ex.answer, () => {
        $$("#opts .opt").forEach(x => x.classList.remove("sel"));
        $$("#opts .opt")[ex.opts.indexOf(ex.answer)].classList.add("ok");
        if (sel !== null && val !== ex.answer) $$("#opts .opt")[sel].classList.add("no");
      });
    });
    if (ex.speakText) bindSay(area);
  }
  else if (ex.type === "listen") {
    html += `<div class="q-prompt">${esc(ex.q)}</div>
      <div style="text-align:center;margin:22px 0 26px"><button class="speaker" id="big-speaker">🔊</button>
      <div class="py-line" style="margin-top:12px">버튼을 눌러 소리를 듣세요</div></div>
      <div class="opts" id="opts">` + ex.opts.map((o, i) =>
      `<button class="opt" data-i="${i}"><span class="key">${i + 1}</span><span class="o-hz hanzi">${esc(o)}</span></button>`).join("") + `</div>`;
    area.innerHTML = html;
    $("#big-speaker").addEventListener("click", () => speak(ex.speakText || ex.answer));
    speak(ex.speakText || ex.answer);
    let sel = null;
    $$("#opts .opt").forEach(b => b.addEventListener("click", () => {
      $$("#opts .opt").forEach(x => x.classList.remove("sel"));
      b.classList.add("sel"); sel = +b.dataset.i; $("#btn-check").disabled = false; sTap();
    }));
    onCheck(() => {
      const val = ex.opts[sel];
      grade(ex, val === ex.answer, () => {
        $$("#opts .opt").forEach(x => x.classList.remove("sel"));
        $$("#opts .opt")[ex.opts.indexOf(ex.answer)].classList.add("ok");
        if (sel !== null && val !== ex.answer) $$("#opts .opt")[sel].classList.add("no");
      });
    });
  }
  else if (ex.type === "match") {
    html += `<div class="q-prompt">${esc(ex.q)} <span class="tag">모든 짝을 맞추면 완료</span></div>`;
    const left = shuffle(ex.pairs), right = shuffle(ex.pairs);
    html += `<div class="match-grid" id="mg-l">` + left.map((p, i) => `<button class="mt hanzi" data-k="${esc(p.hz)}">${esc(p.hz)}</button>`).join("") + `</div>`;
    html += `<div class="match-grid" id="mg-r" style="margin-top:14px">` + right.map((p, i) => `<button class="mt" data-k="${esc(p.hz)}">${esc(p.kr)}</button>`).join("") + `</div>`;
    area.innerHTML = html;
    let selL = null, matched = 0, mistakes = 0;
    const need = ex.pairs.length;
    const tryMatch = () => {
      if (!selL) return;
      const r = matchState.selR; if (!r) return;
      if (selL.dataset.k === r.dataset.k) {
        selL.classList.remove("sel"); selL.classList.add("ok"); r.classList.remove("sel"); r.classList.add("ok");
        sPop(); speak(selL.dataset.k); matched++;
        selL = null; matchState.selR = null;
        if (matched === need) { setTimeout(() => grade(ex, mistakes === 0, () => { }), 350); }
      } else {
        mistakes++;
        const a = selL, b = r;
        a.classList.add("no-anim"); b.classList.add("no-anim"); sBad();
        setTimeout(() => { a.classList.remove("no-anim", "sel"); b.classList.remove("no-anim", "sel"); }, 380);
        selL = null; matchState.selR = null;
      }
    };
    const matchState = { selR: null };
    $$("#mg-l .mt").forEach(b => b.addEventListener("click", () => { if (b.classList.contains("ok")) return; $$("#mg-l .mt").forEach(x => x.classList.remove("sel")); b.classList.add("sel"); selL = b; tryMatch(); }));
    $$("#mg-r .mt").forEach(b => b.addEventListener("click", () => { if (b.classList.contains("ok")) return; $$("#mg-r .mt").forEach(x => x.classList.remove("sel")); b.classList.add("sel"); matchState.selR = b; tryMatch(); }));
    $("#btn-check").style.display = "none";
  }
  else if (ex.type === "build") {
    html += `<div class="q-prompt">${esc(ex.q)}</div><div class="q-cn" style="font-size:19px;color:var(--muted2)">${esc(ex.krPrompt)}</div>
      <div class="assembly" id="asm"></div>
      <div class="bank" id="bank">` + ex.bank.map((t, i) => `<button class="tile hanzi" data-i="${i}">${esc(t)}</button>`).join("") + `</div>`;
    area.innerHTML = html;
    const chosen = []; // {t, bankIdx}
    const refresh = () => {
      $("#asm").innerHTML = chosen.map(c => `<button class="tile hanzi" data-b="${c.bankIdx}">${esc(c.t)}</button>`).join("");
      $$("#asm .tile").forEach(t => t.addEventListener("click", () => {
        const bi = +t.dataset.b;
        const pos = chosen.findIndex(c => c.bankIdx === bi);
        chosen.splice(pos, 1); refresh();
      }));
      $$("#bank .tile").forEach(t => t.classList.toggle("used", chosen.some(c => c.bankIdx === +t.dataset.i)));
      $("#btn-check").disabled = chosen.length === 0;
    };
    $$("#bank .tile").forEach(t => t.addEventListener("click", () => {
      const bi = +t.dataset.i;
      if (chosen.some(c => c.bankIdx === bi)) return;
      chosen.push({ t: ex.bank[bi], bankIdx: bi }); refresh(); sTap();
    }));
    refresh();
    onCheck(() => {
      const val = chosen.map(c => c.t).join("");
      grade(ex, val === ex.toks.join(""), () => { });
    });
  }
  else if (ex.type === "conv") {
    html += `<div class="q-prompt">${esc(ex.q)}</div>
      <div class="q-cn hanzi" style="font-size:24px">${esc(ex.promptCn)}</div>
      <div class="py-line">${esc(ex.promptKo)}</div>
      <div class="opts" id="opts">` + ex.opts.map((o, i) =>
      `<button class="opt" data-i="${i}"><span class="key">${i + 1}</span><span><span class="o-hz hanzi">${esc(o.zh)}</span><br><span class="o-sub" style="font-size:12.5px;color:var(--muted)">${esc(o.ko)}</span></span></button>`).join("") + `</div>`;
    area.innerHTML = html;
    let sel = null;
    $$("#opts .opt").forEach(b => b.addEventListener("click", () => {
      $$("#opts .opt").forEach(x => x.classList.remove("sel"));
      b.classList.add("sel"); sel = +b.dataset.i; $("#btn-check").disabled = false; sTap();
    }));
    onCheck(() => {
      const val = ex.opts[sel] && ex.opts[sel].zh;
      grade(ex, val === ex.answer, () => {
        const ai = ex.opts.findIndex(o => o.zh === ex.answer);
        $$("#opts .opt").forEach((x, i) => { x.classList.remove("sel"); if (i === ai) x.classList.add("ok"); else if (i === sel) x.classList.add("no"); });
      });
    });
  }
  else if (ex.type === "fill") {
    html += `<div class="q-prompt">${esc(ex.q)}</div><div class="q-cn hanzi" style="font-size:23px">${esc(ex.sent).replace(/_{3,}/, `<span id="blank" style="color:var(--blue);border-bottom:3px dashed var(--blue);padding:0 26px">?</span>`)}</div>
      <div class="opts" id="opts">` + ex.opts.map((o, i) =>
      `<button class="opt" data-i="${i}"><span class="key">${i + 1}</span><span class="o-hz hanzi">${esc(o)}</span></button>`).join("") + `</div>`;
    area.innerHTML = html;
    let sel = null;
    $$("#opts .opt").forEach(b => b.addEventListener("click", () => {
      $$("#opts .opt").forEach(x => x.classList.remove("sel"));
      b.classList.add("sel"); sel = +b.dataset.i; $("#btn-check").disabled = false; sTap();
      const bl = $("#blank"); if (bl) bl.textContent = ex.opts[sel];
    }));
    onCheck(() => {
      const val = ex.opts[sel];
      grade(ex, val === ex.answer, () => {
        $$("#opts .opt")[ex.opts.indexOf(ex.answer)].classList.add("ok");
        if (sel !== ex.opts.indexOf(ex.answer)) $$("#opts .opt")[sel].classList.add("no");
      });
    });
  }
  bindSay(area);
}
function kindLabel(ex) {
  return { mcq: ex.sub || "SELECT", listen: "듣고 고르기 🔊", match: "짝 맞추기", build: "문장 조립", fill: "빈칸 채우기" }[ex.type] || "문제";
}
function bindSay(root) { $$("[data-say]", root).forEach(b => b.addEventListener("click", e => { e.stopPropagation(); speak(b.dataset.say); })); }
function onCheck(fn) {
  const b = $("#btn-check");
  b.className = "btn big btn-green";
  b.onclick = fn;
}
function praiseText(combo) {
  if (combo >= 8) return "완벽해요! 🔥";
  if (combo >= 5) return "대단해요!";
  if (combo >= 3) return "훌륭해요!";
  return "좋아요!";
}
function grade(ex, ok, highlight) {
  $("#btn-check").style.pointerEvents = "none";
  LESSON.asked++;
  if (ex.item && ex.item.key) srsUpdate(ex.item.key, ok);
  const fill = $(".pbar .fill");
  if (ok) {
    LESSON.correct++; LESSON.combo++;
    sCorrect(LESSON.combo); vib(12);
    flash("correct");
    highlight();
    if (fill) { fill.classList.remove("glow"); void fill.offsetWidth; fill.classList.add("glow"); }
    cornerRobot(LESSON.combo >= 3 ? "wow" : "happy");
    const badge = LESSON.combo >= 3 ? ` <span class="combo-badge">×${LESSON.combo}</span>` : "";
    feedback(true, praiseText(LESSON.combo) + badge, ex.item ? solutionLine(ex.item) : "", "계속");
  } else {
    loseHeart(); LESSON.combo = 0;
    sWrong(); sHeartLost(); vib(90);
    flash("wrong");
    highlight();
    LESSON.queue.push(ex); // 다시 출제
    cornerRobot("sad");
    feedback(false, "오답!", solutionLine(ex.item, ex.answer !== undefined ? ex.answer : null), "계속");
    if (S.hearts.n <= 0) { setTimeout(heartsEmptyDuring, 400); }
  }
  updateTopHearts();
}
/* 코너 미니 로봇 반응 */
function cornerRobot(mood) {
  const el = $("#crobot");
  if (!el) return;
  el.innerHTML = robotSVG(mood === "wow" ? "wow" : mood === "sad" ? "sad" : "happy", 46);
  el.className = "corner-robot " + (mood === "sad" ? "sad" : "jump");
  clearTimeout(el._tm);
  el._tm = setTimeout(() => { el.className = "corner-robot"; el.innerHTML = robotSVG("happy", 46); }, 1600);
}
function solutionLine(item, fallbackAns) {
  if (!item) return "";
  let s = "";
  if (item.cn) s += `<span class="hanzi" style="font-size:17px">${esc(item.cn)}</span> `;
  if (item.py) s += `<span style="opacity:.85">${esc(item.py)}</span> `;
  if (item.kr) s += `— ${esc(item.kr)}`;
  if (!s && fallbackAns) s = esc(fallbackAns);
  return s;
}
function feedback(good, title, body, btn) {
  const f = $("#feedback");
  f.className = "feedback show " + (good ? "good" : "bad");
  f.innerHTML = `<div class="fb-title">${good ? "🎉" : "💔"} ${title}</div>
    ${body ? `<div class="fb-body">${body}</div>` : ""}
    <button class="btn ${good ? "btn-gold" : "btn-gold"}" id="fb-next" style="background:#fff;color:${good ? "var(--green-d)" : "var(--red-d)"};box-shadow:0 4px 0 rgba(0,0,0,.2)">${btn}</button>`;
  $("#fb-next").addEventListener("click", () => {
    f.classList.remove("show");
    LESSON.idx++;
    renderLesson();
  });
}
function updateTopHearts() { const h = $(".lesson-top .stat-chip"); if (h) h.innerHTML = `<span class="ico">❤️</span>${S.hearts.n}`; }
function flash(cls) {
  const d = document.createElement("div");
  d.className = cls === "correct" ? "correct-flash" : "wrong-flash";
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 520);
}

/* 하트 소진 */
function heartsEmptyDuring() {
  LESSON.paused = true;
  modal(`<div style="text-align:center">${robotSVG("sad", 100)}</div>
    <h2 style="margin-top:10px">하트가 없어요! ❤️→🤍</h2>
    <div class="desc">하트는 20분마다 1개씩 자동 충전됩니다. 보석 10개로 바로 채울 수도 있어요.<br>보유 보석: 💎 ${S.gems}</div>
    <div style="height:16px"></div>
    <button class="btn big btn-blue" id="h-refill">💎 10개로 하트 5개 충전</button>
    <div style="height:10px"></div>
    <button class="btn big btn-gray" id="h-quit">그만두기 (진행 초기화)</button>`, true);
  $("#h-refill").addEventListener("click", () => {
    if (S.gems < 10) { toast("보석이 부족해요! 레슨을 완료하면 보석을 얻어요"); return; }
    S.gems -= 10; S.hearts.n = HEART_MAX; S.hearts.ts = Date.now(); save();
    closeModal(); updateTopHearts(); toast("하트가 가득 찼어요! ❤️❤️❤️❤️❤️");
  });
  $("#h-quit").addEventListener("click", () => { closeModal(); LESSON = null; go("home"); });
}
function heartsEmptyModal() {
  modal(`<div style="text-align:center">${robotSVG("sad", 100)}</div>
    <h2 style="margin-top:10px">하트가 없어요</h2>
    <div class="desc">하트는 20분마다 1개씩 충전됩니다 (최대 5개).<br>보유 보석: 💎 ${S.gems} · 다음 하트까지 기다려 보세요!</div>
    <div style="height:16px"></div>
    <button class="btn big btn-blue" id="h-refill2">💎 10개로 하트 5개 충전</button>
    <div style="height:10px"></div>
    <button class="btn big btn-outline" id="h-close">닫기</button>`);
  $("#h-refill2").addEventListener("click", () => {
    if (S.gems < 10) { toast("보석이 부족해요"); return; }
    S.gems -= 10; S.hearts.n = HEART_MAX; S.hearts.ts = Date.now(); save();
    closeModal(); renderHome(); toast("하트 충전 완료! ❤️");
  });
  $("#h-close").addEventListener("click", () => { closeModal(); });
}

/* 완료 */
function finishLesson() {
  const L = LESSON, lesson = L.lesson;
  const acc = L.asked ? Math.round((L.correct / L.asked) * 100) : 100;
  const first = !lessonState(lesson.id).done && lesson.id !== "__review";
  let xp = lesson.id === "__review" ? 5 : (first ? 10 : 5);
  if (acc === 100) xp += 5;
  const gems = first ? 5 : 2;
  const beforeXP = S.xpByDay[dayKey()] || 0;
  S.xp += xp; S.gems += gems;
  S.xpByDay[dayKey()] = beforeXP + xp;
  bumpStreak();
  if (lesson.id !== "__review") {
    const st = lessonState(lesson.id);
    st.done = true; st.plays++; st.best = Math.max(st.best, acc); st.last = Date.now();
    S.lessons[lesson.id] = st;
  }
  save(); sFanfare(); vib([30, 60, 30]);
  confetti();
  $("#app").innerHTML = `
    <div class="lesson-top"><div style="flex:1"></div><div class="stat-chip" style="color:var(--gold-d)"><span class="ico">💎</span>+${gems}</div></div>
    <div class="done-wrap">
      <div class="done-robot robot-anim">${robotSVG(acc >= 80 ? "happy" : "wow")}</div>
      <h1 style="font-size:26px;margin:8px 0 2px">${lesson.id === "__review" ? "복습 완료!" : "레슨 완료!"}</h1>
      <div style="color:var(--muted2);font-weight:700">${esc(lesson.title)} ${first ? "· 첫 완료!" : ""}</div>
      <div class="ph-stat">
        <div class="ph pop" style="animation-delay:.05s"><div class="p-lab">획득 XP</div><div class="p-val xp-gold" id="xp-num">+0</div></div>
        <div class="ph pop" style="animation-delay:.22s"><div class="p-lab">정확도</div><div class="p-val acc-green">${acc}%</div></div>
        <div class="ph pop" style="animation-delay:.39s"><div class="p-lab">연속 학습</div><div class="p-val sc-blue">🔥${S.streak.n}</div></div>
      </div>
      <button class="btn big btn-green" id="done-go">계속하기</button>
    </div>`;
  /* XP 카운트업 (rAF 없이 타이머 기반 — 백그라운드 탭에서도 진행) */
  const el = $("#xp-num"), t0 = Date.now(), DUR = 850;
  const tm = setInterval(() => {
    const k = Math.min(1, (Date.now() - t0) / DUR);
    const eased = 1 - Math.pow(1 - k, 3);
    el.textContent = "+" + Math.round(xp * eased);
    if (k >= 1) { clearInterval(tm); note(1568, 0, 0.12, { vol: 0.2, harm: 0.25 }); }
  }, 40);
  /* 일일 목표 달성 (당일 1회) */
  const goal = S.settings.goal || 50;
  if (beforeXP < goal && (S.xpByDay[dayKey()] || 0) >= goal && S.goalShown !== dayKey()) {
    S.goalShown = dayKey(); save();
    setTimeout(() => {
      sGoal(); confetti(); vib([20, 40, 20, 40, 60]);
      modal(`<div style="text-align:center">${robotSVG("wow", 110)}</div>
        <h2 style="margin-top:8px">🎯 오늘의 목표 달성!</h2>
        <div class="desc">오늘 ${S.xpByDay[dayKey()]} XP를 얻었어요 (${goal} XP 목표 초과).<br>이대로 매일 이어 가면 🔥 연속 학습일도 계속 늘어납니다!</div>
        <div style="height:14px"></div>
        <button class="btn big btn-gold" id="goal-ok">계속하기</button>`);
      $("#goal-ok").addEventListener("click", closeModal);
    }, 1100);
  }
  $("#done-go").addEventListener("click", () => { LESSON = null; go("home"); });
}
function confetti() {
  const colors = ["#58CC02", "#1CB0F6", "#FFC800", "#CE82FF", "#FF9600", "#FF4B4B"];
  for (let i = 0; i < 60; i++) {
    const d = document.createElement("div");
    d.className = "confetti";
    const size = 6 + rnd(8);
    d.style.cssText += `left:${rnd(100)}vw;width:${size}px;height:${size * (rnd(2) ? 1 : 0.4)}px;background:${pick(colors)};border-radius:${rnd(2) ? "50%" : "2px"};animation-duration:${1.6 + Math.random() * 1.4}s;animation-delay:${Math.random() * 0.5}s`;
    document.body.appendChild(d);
    setTimeout(() => d.remove(), 3600);
  }
}

/* ───────────────────────────── 기록(통계) ───────────────────────────── */
function renderStats() {
  refillHearts();
  const today = S.xpByDay[dayKey()] || 0;
  const goal = S.settings.goal;
  const pct = Math.min(100, Math.round(today / goal * 100));
  /* 14일 캘린더 × 7주 */
  let cal = "";
  const days = [];
  for (let i = 97; i >= 0; i--) { const k = dayKey(new Date(Date.now() - i * 864e5)); const xp = S.xpByDay[k] || 0; days.push({ k, xp }); }
  cal = days.map(d => {
    const lv = d.xp === 0 ? "" : d.xp < 20 ? "l1" : d.xp < 50 ? "l2" : "l3";
    return `<div class="c ${lv}" title="${d.k}: ${d.xp}XP"></div>`;
  }).join("");
  const secBars = SECTIONS.map(sec => {
    const ls = LESSONS.filter(l => l.sec === sec.id);
    const done = ls.filter(l => lessonState(l.id).done).length;
    const p = Math.round(done / ls.length * 100);
    return `<div class="secbar"><div class="row"><span>${sec.icon} ${sec.title}</span><span style="color:var(--muted)">${done}/${ls.length}</span></div>
      <div class="mini-track"><div class="mini-fill" style="width:${p}%"></div></div></div>`;
  }).join("");
  const weak = weakestItems(8).map(({ k, r }) => {
    const [kind, val] = [k.slice(0, k.indexOf(":")), k.slice(k.indexOf(":") + 1)];
    let label = val, sub = "";
    if (kind === "w" && WORD_BY_HZ[val]) { label = WORD_BY_HZ[val].hz; sub = WORD_BY_HZ[val].kr; }
    else if (kind === "s") { const s2 = ALL_SENT.find(x => x.cn.startsWith(val)); if (s2) { label = s2.cn.slice(0, 14) + "…"; sub = s2.kr.slice(0, 16); } }
    else return "";
    return `<span class="tag" style="font-size:13px;margin:2px">💪<b class="hanzi" style="font-size:14px">${esc(label)}</b> ${esc(sub)} (${r.ok}/${r.seen})</span> `;
  }).join("");
  $("#app").innerHTML = topbarHTML() + `
    <div style="padding:16px 0 0"><h1 style="font-size:24px;margin:0 18px;font-weight:900">📊 나의 기록</h1></div>
    <div class="card"><div class="big-row">
        <div class="big-cell"><div class="n" style="color:var(--gold-d)">${S.xp}</div><div class="l">총 XP</div></div>
        <div class="big-cell"><div class="n" style="color:var(--orange)">🔥 ${S.streak.n}</div><div class="l">연속 학습</div></div>
        <div class="big-cell"><div class="n" style="color:var(--blue)">💎 ${S.gems}</div><div class="l">보석</div></div>
      </div></div>
    <div class="card"><h3>오늘의 목표 (${today}/${goal} XP)</h3>
      <div class="goal-ring"><div class="ring" style="--p:${pct}%"><div class="inner"><span style="color:var(--gold-d);font-size:18px">${today}</span><span style="font-size:10px;color:var(--muted)">XP</span></div></div>
      <div style="flex:1;font-size:13.5px;color:var(--muted2);font-weight:600;line-height:1.6">${pct >= 100 ? "🎉 오늘 목표 달성! 대단해요!" : "레슨 하나면 목표에 가까워져요. 오늘도 화이팅!"}<br>하트 ❤️ ${S.hearts.n}/5 · 20분마다 1개 충전</div></div></div>
    <div class="card"><h3>학습 캘린더 (최근 98일)</h3><div class="cal">${cal}</div>
      <div style="display:flex;gap:10px;margin-top:10px;font-size:11px;color:var(--muted);font-weight:700"><span>▢ 0</span><span><span class="c l1" style="display:inline-block;width:10px;height:10px"></span> 1–19</span><span><span class="c l2" style="display:inline-block;width:10px;height:10px"></span> 20–49</span><span><span class="c l3" style="display:inline-block;width:10px;height:10px"></span> 50+</span></div></div>
    <div class="card"><h3>단원별 진도</h3>${secBars}</div>
    <div class="card"><h3>약한 항목 (복습 추천)</h3><div class="weak-list" style="line-height:2.2">${weak || '<span class="tag">아직 데이터가 없어요. 레슨을 시작해 보세요!</span>'}</div></div>
    <div class="card"><h3>데이터 백업</h3>
      <div style="display:flex;gap:8px"><button class="btn btn-outline" style="flex:1" id="exp">📤 내보내기</button>
      <button class="btn btn-outline" style="flex:1" id="imp">📥 가져오기</button></div>
      <div id="imp-area" style="display:none;margin-top:10px"><textarea class="io" id="io" placeholder="백업한 텍스트를 붙여넣으세요"></textarea>
      <button class="btn big btn-green" id="imp-go" style="margin-top:8px">복원하기</button></div></div>
  ` + tabbarHTML("stats");
  bindCommon();
  $("#exp").addEventListener("click", () => {
    const ta = document.createElement("textarea");
    ta.value = JSON.stringify(S); document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); toast("클립보드에 복사됨! 메모앱에 붙여넣어 보관하세요"); } catch (e) { }
    ta.remove();
  });
  $("#imp").addEventListener("click", () => { $("#imp-area").style.display = "block"; });
  $("#imp-go").addEventListener("click", () => {
    try {
      const o = JSON.parse($("#io").value);
      if (!o || o.v !== 1) throw 0;
      S = o; save(); toast("복원 완료!"); go("stats");
    } catch (e) { toast("복원 실패: 올바른 백업 텍스트인지 확인하세요"); }
  });
}

/* ───────────────────────────── 프로필 ───────────────────────────── */
function renderProfile() {
  refillHearts();
  const st = S.settings;
  $("#app").innerHTML = topbarHTML() + `
    <div class="prof-head"><div class="robot-anim">${robotSVG("happy", 92)}</div>
      <div><div class="nm">${esc(S.name)}</div><div class="joined">${new Date(S.firstTs).toLocaleDateString("ko-KR")} 시작 · 로봇산업 중국어 교재 기반</div></div></div>
    <div class="card"><h3>⚙️ 학습 설정</h3>
      <div class="set-row"><span>🔊 중국어 발음 (TTS)</span><button class="btn ${st.tts ? "btn-green" : "btn-gray"}" id="set-tts" style="padding:8px 16px">${st.tts ? "켜짐" : "꺼짐"}</button></div>
      <div class="set-row"><span>🎵 효과음·진동</span><button class="btn ${st.sfx ? "btn-green" : "btn-gray"}" id="set-sfx" style="padding:8px 16px">${st.sfx ? "켜짐" : "꺼짐"}</button></div>
      <div class="set-row"><span>🔉 효과음 볼륨</span><div class="seg" id="seg-sfxvol">${[[1, "약하게"], [2, "보통"], [3, "크게"]].map(([v, l]) => `<button data-v="${v}" class="${(st.sfxVol || 2) === v ? "on" : ""}">${l}</button>`).join("")}</div></div>
      <div class="set-row"><span>🗣️ 발음 속도</span><div class="seg" id="seg-rate">${[["0.7", "느리게"], ["0.85", "보통"], ["1", "빠르게"]].map(([v, l]) => `<button data-v="${v}" class="${String(st.ttsRate) === v ? "on" : ""}">${l}</button>`).join("")}</div></div>
      <div class="set-row"><span>🈯 병음 함께 보기</span><button class="btn ${st.py ? "btn-green" : "btn-gray"}" id="set-py" style="padding:8px 16px">${st.py ? "켜짐" : "꺼짐"}</button></div>
      <div class="set-row"><span>🎯 일일 목표</span><div class="seg" id="seg-goal">${[[50, "캐주얼"], [100, "보통"], [150, "열정"]].map(([v, l]) => `<button data-v="${v}" class="${st.goal === v ? "on" : ""}">${l}<br><small>${v}XP</small></button>`).join("")}</div></div>
      <div class="set-row"><span>이름 변경</span><button class="btn btn-outline" id="set-name" style="padding:8px 16px">변경</button></div>
    </div>
    <div class="card"><h3>📱 아이폰에 설치하기</h3>
      <div class="desc" style="font-size:13.5px;line-height:1.8">${location.protocol === "https:"
        ? "이 앱은 이미 온라인 상태예요! 사파리 하단 <b>공유 버튼 → 홈 화면에 추가</b>를 누르면 앱처럼 실행되고, 인터넷이 없어도(오프라인) 실행됩니다.<br>학습 기록은 이 기기에 자동 저장돼요. 기록 화면의 <b>데이터 백업</b>으로 보관하세요."
        : "1. 아이폰과 이 컴퓨터가 <b>같은 Wi-Fi</b>에 연결되어 있나요?<br>2. 컴퓨터에서 <code>serve.py</code>를 실행하고 안내된 주소(예: http://192.168.0.5:8000)를 아이폰 사파리로 열어요.<br>3. 사파리 하단 <b>공유 버튼 → 홈 화면에 추가</b>를 누르면 앱처럼 실행돼요.<br>4. 학습 기록은 이 기기에 자동 저장됩니다. 기록 화면의 <b>데이터 백업</b>으로 보관하세요."}</div></div>
    <div class="card"><h3>📳 진동 안내</h3>
      <div class="desc" style="font-size:13px;line-height:1.7">정답·오답·완료 시 햅틱 진동이 울립니다.<br>Android는 즉시 지원되며, <b>아이폰은 웹앱 정책상 진동 API가 없어</b> 소리와 화면 연출(흔들림·반짝임)로 대체 제공됩니다.</div></div>
    <div class="card"><h3>ℹ️ 정보</h3>
      <div class="desc" style="font-size:13.5px;line-height:1.8">로보중국어 v1.0 · 듀오링고 방식 학습 게임<br>
      출처: ① 선전 로봇밸리 전시 자료 54장 분석 교재 ② 2026 휴머노이드 로봇 리포트 특강 (부품·AI·산업·투자·문체)<br>
      발음은 iOS 기본 중국어 음성(Ting-Ting 등)을 사용합니다.</div>
      <div style="height:12px"></div>
      <button class="btn btn-red" id="reset-all" style="padding:10px 16px">기록 초기화</button></div>
  ` + tabbarHTML("profile");
  bindCommon();
  $("#set-tts").addEventListener("click", e => { st.tts = !st.tts; save(); renderProfile(); });
  $("#set-sfx").addEventListener("click", e => { st.sfx = !(st.sfx !== false); save(); renderProfile(); sCorrect(1); });
  $$("#seg-sfxvol button").forEach(b => b.addEventListener("click", () => { st.sfxVol = +b.dataset.v; save(); renderProfile(); sCorrect(4); }));
  $("#set-py").addEventListener("click", e => { st.py = !st.py; save(); renderProfile(); });
  $("#set-name").addEventListener("click", () => { const v = prompt("이름을 입력하세요", S.name); if (v) { S.name = v.slice(0, 20); save(); renderProfile(); } });
  $$("#seg-rate button").forEach(b => b.addEventListener("click", () => { st.ttsRate = parseFloat(b.dataset.v); save(); renderProfile(); speak("机器人"); }));
  $$("#seg-goal button").forEach(b => b.addEventListener("click", () => { st.goal = +b.dataset.v; save(); renderProfile(); }));
  $("#reset-all").addEventListener("click", () => {
    modal(`<h2>기록을 초기화할까요?</h2><div class="desc">XP, 연속 학습, 모든 진도가 삭제되며 되돌릴 수 없어요.</div><div style="height:14px"></div>
      <button class="btn big btn-red" id="rs-y">초기화</button><div style="height:10px"></div>
      <button class="btn big btn-outline" id="rs-n">취소</button>`);
    $("#rs-y").addEventListener("click", () => { S = JSON.parse(JSON.stringify(DEFAULT_STATE)); save(); closeModal(); go("home"); });
    $("#rs-n").addEventListener("click", closeModal);
  });
}

/* ───────────────────────────── 모달 ───────────────────────────── */
function modal(inner, dismissable) {
  const old = $(".modal-bg"); if (old) old.remove();
  const d = document.createElement("div");
  d.className = "modal-bg";
  d.innerHTML = `<div class="modal">${inner}</div>`;
  document.body.appendChild(d);
  if (dismissable !== false) d.addEventListener("click", e => { if (e.target === d) closeModal(); });
  bindSay(d);
}
function closeModal() { const d = $(".modal-bg"); if (d) d.remove(); }

/* ───────────────────────────── 공용 바인딩 ───────────────────────────── */
function bindCommon() {
  $$("[data-go]").forEach(b => b.addEventListener("click", () => go(b.dataset.go)));
  const tb = $("#tb-streak"); if (tb) tb.addEventListener("click", () => toast(`연속 학습 ${S.streak.n}일! 매일 조금씩이 최고의 비법이에요 🔥`));
  const hg = $("#tb-gems"); if (hg) hg.addEventListener("click", () => toast("보석은 레슨 완료로 얻고, 하트 충전(10개)에 써요 💎"));
  const hh = $("#tb-hearts"); if (hh) hh.addEventListener("click", heartsEmptyModal);
}

/* ───────────────────────────── 시작 ───────────────────────────── */
refillHearts();
renderHome();
if ("serviceWorker" in navigator && location.protocol === "https:") {
  try { navigator.serviceWorker.register("sw.js").catch(() => { }); } catch (e) { }
}
document.addEventListener("click", () => ac(), { once: true });
