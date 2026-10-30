/* ============================================================
   tts.js — อ่านออกเสียงด้วย Web Speech API + เสียงไทยออนไลน์ (Google)
   - ปุ่ม 🔊 หน้า h2 / h3 / กล่องความรู้ / เฉลย / MCQ + แถบควบคุมลอย
   - เครื่องที่ไม่มีเสียงไทย (เช่น Chrome บน Linux) → ใช้ "Google ไทย
     (ออนไลน์)" อัตโนมัติ เล่นผ่าน <audio> (ต้องต่ออินเทอร์เน็ต)
   - หน้าเว็บใส่ <meta name="referrer" content="no-referrer"> ไว้แล้ว
     เพราะ Google TTS ปฏิเสธ request ที่แนบ Referer (คืน 404)
   - Fallback: googleapis → translate.google.com → เสียงในเครื่อง
   - SVG ในภาพ: อ่านคำอธิบายใต้ภาพแทน · โค้ดใน <pre>: ข้าม
   - details.sol ที่ยังปิด: อ่านแค่หัว ไม่หลุดเฉลย · MCQ ไม่อ่านคำอธิบาย
     จนกว่าจะตอบแล้ว
   ============================================================ */
'use strict';
(function () {
  if (!('speechSynthesis' in window)) return;
  if (!document.querySelector('main')) return;

  const LS_KEY = 'dsa-tts';
  const THAI_RE = /[\u0E00-\u0E7F]/;
  const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{1F1E6}-\u{1F1FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{FE00}-\u{FE0F}\u{200D}\u{2764}]/gu;
  const MAX_CHUNK = 180;               /* โจทย์ออนไลน์จำกัดความยาวต่อครั้ง */

  /* เสียงออนไลน์ — Google TTS (ใช้ได้ทุกอุปกรณ์ที่ต่อเน็ต) */
  const ONLINE_TH = [{ value: 'on:google:th', label: '🌐 Google ไทย (ออนไลน์)' }];
  const ONLINE_EN = [{ value: 'on:google:en', label: '🌐 Google English (ออนไลน์)' }];

  const state = {
    thaiSel: null, enSel: null, rate: 1,
    chunks: [], idx: 0, playing: false, paused: false, stopped: true,
    target: null, label: '', epoch: 0, btn: null, audio: null,
    _savedTh: '', _savedEn: '',
  };

  /* ---------- ตั้งค่าที่บันทึกไว้ ---------- */
  function loadPrefs() {
    try {
      const p = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
      if (p.rate) state.rate = p.rate;
      state._savedTh = p.th || '';
      state._savedEn = p.en || '';
    } catch (e) { /* ไม่มีค่าเดิมก็ข้าม */ }
  }
  function savePrefs() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        th: el.selTh ? el.selTh.value : state._savedTh,
        en: el.selEn ? el.selEn.value : state._savedEn,
        rate: state.rate,
      }));
    } catch (e) { /* localStorage ใช้ไม่ได้ก็ไม่เป็นไร */ }
  }

  /* ---------- รายชื่อเสียงในเครื่อง ---------- */
  function allVoices() {
    const vs = speechSynthesis.getVoices();
    const uniq = new Map();
    vs.forEach((v) => { if (!uniq.has(v.name)) uniq.set(v.name, v); });
    return [...uniq.values()];
  }
  function normalizeSaved(v) {
    if (!v) return '';
    if (v.indexOf('ws:') === 0 || v.indexOf('on:') === 0) return v;
    /* ค่าที่บันทึกจากรุ่นแรกเป็นชื่อเสียงเปล่า ๆ → แปลงให้ */
    return allVoices().some((x) => x.name === v) ? 'ws:' + v : '';
  }
  function fillSelect(sel, localVoices, onlineList, savedValue, lang) {
    sel.innerHTML = '';
    const g1 = document.createElement('optgroup');
    g1.label = 'เสียงในเครื่อง';
    const re = lang === 'th' ? /^th/i : /^en/i;
    const first = localVoices.filter((v) => re.test(v.lang));
    const others = localVoices.filter((v) => !re.test(v.lang));
    const ordered = first.concat(others);
    if (!ordered.length) {
      const o = document.createElement('option');
      o.disabled = true; o.textContent = '— ไม่มีเสียงในเครื่อง —';
      g1.appendChild(o);
    }
    ordered.forEach((v) => {
      const o = document.createElement('option');
      o.value = 'ws:' + v.name;
      const tag = /^th/i.test(v.lang) ? '🇹🇭 ' : (/^en/i.test(v.lang) ? '🇬🇧 ' : '');
      o.textContent = tag + v.name + ' (' + v.lang + ')';
      g1.appendChild(o);
    });
    const g2 = document.createElement('optgroup');
    g2.label = 'เสียงออนไลน์ (ต้องต่ออินเทอร์เน็ต)';
    onlineList.forEach((sp) => {
      const o = document.createElement('option');
      o.value = sp.value; o.textContent = sp.label;
      g2.appendChild(o);
    });
    sel.appendChild(g1); sel.appendChild(g2);
    const saved = normalizeSaved(savedValue);
    if (saved && Array.from(sel.options).some((o) => o.value === saved)) sel.value = saved;
    else sel.selectedIndex = -1;   /* ให้ refreshVoices เลือกค่า default ต่อ (ไม่งั้น browser มักติดตัวแรกเอง) */
  }
  function defaultSel(localVoices, lang) {
    const re = lang === 'th' ? /^th/i : /^en/i;
    const local = localVoices.filter((v) => re.test(v.lang));
    if (local.length) return 'ws:' + local[0].name;
    return lang === 'th' ? 'on:google:th' : 'on:google:en';
  }
  function resolveSel(v) {
    if (v && v.indexOf('on:') === 0) {
      const parts = v.split(':');                          /* on:google:th */
      return { type: 'online', provider: parts[1], lang: parts.slice(2).join(':') };
    }
    const name = (v || '').replace(/^ws:/, '');
    return { type: 'ws', voice: allVoices().find((x) => x.name === name) || null };
  }
  function refreshVoices() {
    const list = allVoices();
    fillSelect(el.selTh, list, ONLINE_TH, state._savedTh, 'th');
    fillSelect(el.selEn, list, ONLINE_EN, state._savedEn, 'en');
    if (!el.selTh.value) el.selTh.value = defaultSel(list, 'th');
    if (!el.selEn.value) el.selEn.value = defaultSel(list, 'en');
    state.thaiSel = resolveSel(el.selTh.value);
    state.enSel = resolveSel(el.selEn.value);
    updateHint(list.some((v) => /^th/i.test(v.lang)));
  }
  function byValue(sel) { return resolveSel(sel.value); }
  function updateHint(hasThai) {
    el.hint.textContent = hasThai
      ? ''
      : 'เครื่องนี้ไม่มีเสียงไทยในตัว — ระบบเลือก "Google ไทย (ออนไลน์)" ให้แล้ว (ต้องต่ออินเทอร์เน็ต) ถ้าจะใช้แบบออฟไลน์ ให้ติดตั้งเสียงภาษาไทยในระบบก่อน';
  }

  /* ---------- สัญลักษณ์คณิต/ลูกศร → คำอ่าน ---------- */
  const SYM_MAP = [
    [/≤|⇐/g, ' ไม่เกิน '], [/≥|⇒/g, ' อย่างน้อย '],
    [/→/g, ' ไปทาง '], [/←/g, ' ย้อนกลับทาง '], [/↔/g, ' สองทางระหว่าง '],
    [/∞/g, ' ไม่มีทางถึง '], [/−/g, ' ลบ '], [/×/g, ' คูณ '], [/÷/g, ' หาร '],
    [/·/g, ', '], [/²/g, ' ยกกำลังสอง '], [/³/g, ' ยกกำลังสาม '],
    [/[₀₁₃₄₅₆₇₈₉₂]/g, (m) => ' ' + '₀₁₂₃₄₅₆₇₈₉'.indexOf(m) + ' '],
    [/①/g, 'ข้อหนึ่ง '], [/②/g, 'ข้อสอง '], [/③/g, 'ข้อสาม '], [/④/g, 'ข้อสี่ '],
    [/⑤/g, 'ข้อห้า '], [/⑥/g, 'ข้อหก '], [/⑦/g, 'ข้อเจ็ด '], [/⑧/g, 'ข้อแปด '],
    [/✓/g, ' ถูกต้อง '], [/✗/g, ' ผิด '],
  ];

  /* ---------- ดึงข้อความจาก DOM ---------- */
  function cleanText(root) {
    const clone = root.cloneNode(true);

    /* ตัดสิ่งที่ไม่ควรอ่าน (ห้ามลบ button ตรงนี้ — ตัวเลือก MCQ ต้องเก็บไว้เรียบเรียงก่อน) */
    clone.querySelectorAll('script, style, select, input, .tts-btn, .tts-bar, .pager, aside, header, footer')
      .forEach((n) => n.remove());

    /* details ที่ยังปิด → อ่านแค่หัวเรื่อง (ไม่หลุดเฉลยที่ซ่อนอยู่) */
    clone.querySelectorAll('details:not([open])').forEach((d) => {
      const s = d.querySelector('summary');
      d.innerHTML = '';
      if (s) d.appendChild(s.cloneNode(true));
    });

    /* MCQ: เรียบเรียงเป็นคำถาม + ตัวเลือก + (ถ้าตอบแล้ว) เฉลย */
    clone.querySelectorAll('.mcq').forEach((m) => {
      const q = m.querySelector('.q');
      const out = document.createElement('div');
      if (q) out.appendChild(q.cloneNode(true));
      const answered = m.getAttribute('data-state') === 'answered';
      let correct = null;
      m.querySelectorAll('.opts button').forEach((b, i) => {
        const t = b.textContent.replace(/\s+/g, ' ').trim();
        if (answered && b.classList.contains('correct')) correct = { n: i + 1, t: t };
        const p = document.createElement('p');
        p.textContent = 'ตัวเลือกที่ ' + (i + 1) + ': ' + t;
        out.appendChild(p);
      });
      if (answered) {
        const p = document.createElement('p');
        p.textContent = 'คำตอบที่ถูกต้องคือตัวเลือกที่ ' + (correct ? correct.n : '?') + (correct ? ': ' + correct.t : '');
        out.appendChild(p);
        const ex = m.querySelector('.explain');
        if (ex) out.appendChild(ex.cloneNode(true));
      } else {
        const p = document.createElement('p');
        p.textContent = 'ลองตอบเองก่อน แล้วกดดูเฉลยบนหน้าเว็บ';
        out.appendChild(p);
      }
      m.innerHTML = '';
      m.appendChild(out);
    });

    /* SVG: ตัดออก — ใช้คำอธิบายใต้ภาพแทน */
    clone.querySelectorAll('svg').forEach((s) => s.replaceWith(document.createTextNode(' (ภาพประกอบ) ')));
    clone.querySelectorAll('figure.diagram').forEach((f) => {
      if (!f.querySelector('figcaption')) {
        const p = document.createElement('p');
        p.textContent = 'ภาพประกอบ — ดูรายละเอียดบนหน้าเว็บ';
        f.appendChild(p);
      }
    });

    /* โค้ดใน pre: ข้าม — อ่านโค้ดออกเสียงแล้วเพี้ยน */
    clone.querySelectorAll('pre').forEach((p) => {
      p.textContent = 'โค้ดโปรแกรม อยู่บนหน้าเว็บ ลองอ่านตามตัวอักษรด้วยตา';
    });

    /* ขั้นตอน .steps: ใส่เลขขั้นให้เสียงอ่านรู้ลำดับ (เลขจริงเป็น CSS counter จึงไม่อยู่ในข้อความ) */
    clone.querySelectorAll('.steps').forEach((st) => {
      st.querySelectorAll('.step').forEach((s, i) => {
        const n = document.createElement('span');
        n.textContent = 'ขั้นที่ ' + (i + 1) + ': ';
        s.prepend(n);
      });
    });

    /* แถวตาราง: คั่นด้วยจุดให้เสียงอ่านแยกช่อง */
    clone.querySelectorAll('tr').forEach((tr) => tr.appendChild(document.createTextNode(' | ')));

    /* เศษปุ่มที่เหลือ (หลังเรียบเรียง MCQ เสร็จ) */
    clone.querySelectorAll('button, label').forEach((n) => n.remove());

    let text = clone.textContent || '';
    SYM_MAP.forEach(([re, rep]) => { text = text.replace(re, rep); });
    text = text.replace(EMOJI_RE, ' ');
    text = text.replace(/[\t\r]+/g, ' ').replace(/[ \u00A0]+/g, ' ');
    text = text.replace(/\n{2,}/g, '\n').replace(/\n /g, '\n').trim();
    return text;
  }

  /* ---------- หั่นข้อความเป็นท่อน ๆ สำหรับอ่าน ---------- */
  function chunkText(text) {
    const parts = text.split(/\n+/).flatMap((para) => {
      const sents = para.split(/(?<=[\.!?;:ๆ])\s+/);
      const out = [];
      for (let s of sents) {
        s = s.trim();
        if (!s) continue;
        if (s.length <= MAX_CHUNK) { out.push(s); continue; }
        /* ท่อนยาวเกิน: หั่นตรงช่องว่างใกล้ ๆ MAX_CHUNK-20 */
        let rest = s;
        while (rest.length > MAX_CHUNK) {
          let cut = rest.lastIndexOf(' ', MAX_CHUNK - 20);
          if (cut < 60) cut = MAX_CHUNK - 20;
          out.push(rest.slice(0, cut).trim());
          rest = rest.slice(cut).trim();
        }
        if (rest) out.push(rest);
      }
      return out;
    });
    /* รวมท่อนสั้น ๆ ที่ติดกันให้อ่านต่อเนื่อง */
    const merged = [];
    for (const p of parts) {
      if (merged.length && (merged[merged.length - 1] + ' ' + p).length <= MAX_CHUNK) {
        merged[merged.length - 1] += ' ' + p;
      } else merged.push(p);
    }
    return merged.filter(Boolean).map((t) => ({ text: t, thai: THAI_RE.test(t) }));
  }

  /* ---------- เครื่องยนต์อ่าน ---------- */
  function alive(epoch) { return epoch === state.epoch && !state.stopped && !state.paused; }
  function clampRate(r) { return Math.min(2, Math.max(0.5, r)); }
  function startRead(target, label, btn) {
    const text = cleanText(target);
    if (!text) { setStatus('ไม่พบข้อความให้อ่าน'); return; }
    speechSynthesis.cancel();
    stopAudio();
    state.epoch += 1;
    state.stopped = false; state.playing = true; state.paused = false;
    state.target = target; state.label = label; state.btn = btn || null;
    state.chunks = chunkText(text); state.idx = 0;
    const anchor = target.__anchor || target;
    markReading(anchor);
    if (typeof anchor.scrollIntoView === 'function') {
      try { anchor.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) { /* เลื่อนไม่ได้ก็อ่านต่อ */ }
    }
    setBtnOn(btn);
    el.pauseBtn.textContent = '⏸ พัก';
    setStatus('กำลังอ่าน: ' + label);
    speakChunk(0, state.epoch);
  }
  function speakChunk(i, epoch) {
    if (state.stopped || epoch !== state.epoch) return;
    if (i >= state.chunks.length) { finish(); return; }
    state.idx = i;
    const c = state.chunks[i];
    setStatus('กำลังอ่าน (' + (i + 1) + '/' + state.chunks.length + '): ' + state.label);
    const sel = c.thai ? state.thaiSel : state.enSel;
    if (sel && sel.type === 'online') playOnline(c, i, epoch, sel, true);
    else playWS(c, i, epoch, sel ? sel.voice : null);
  }
  function playWS(c, i, epoch, voice) {
    if (!alive(epoch)) return;
    const u = new SpeechSynthesisUtterance(c.text);
    if (voice) u.voice = voice;
    u.lang = c.thai ? 'th-TH' : 'en-US';
    u.rate = state.rate;
    u.onend = () => {
      if (alive(epoch)) setTimeout(() => speakChunk(i + 1, epoch), 60);
    };
    u.onerror = (e) => {
      if (e.error !== 'interrupted' && e.error !== 'canceled' && alive(epoch)) finish();
    };
    speechSynthesis.speak(u);
  }
  /* เสียงออนไลน์ผ่าน <audio> — Google TTS (หน้าเว็บตั้ง no-referrer ไว้แล้ว) */
  function onlineUrl(c, sel) {
    const q = encodeURIComponent(c.text);
    if (sel.provider === 'googlealt') {
      return 'https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=' + encodeURIComponent(sel.lang) + '&q=' + q;
    }
    return 'https://translate.googleapis.com/translate_tts?ie=UTF-8&client=gtx&tl=' + encodeURIComponent(sel.lang) + '&q=' + q;
  }
  function playOnline(c, i, epoch, sel, allowFallback) {
    if (!alive(epoch)) return;
    const a = new Audio(onlineUrl(c, sel));
    a.preload = 'auto';
    a.playbackRate = clampRate(state.rate);
    state.audio = a;
    let failed = false;
    const fail = () => {
      if (failed || !alive(epoch)) return;
      failed = true;
      stopAudio();
      if (!allowFallback) {
        setStatus('เล่นเสียงออนไลน์ไม่สำเร็จ — ตรวจอินเทอร์เน็ต หรือเลือกเสียงอื่นในแถบควบคุม');
        finish();
        return;
      }
      /* สำรองซ้อน: googleapis → translate.google.com → เสียงในเครื่อง */
      if (sel.provider === 'google') playOnline(c, i, epoch, { type: 'online', provider: 'googlealt', lang: sel.lang }, false);
      else playWS(c, i, epoch, (c.thai ? state.thaiSel : state.enSel).voice);
    };
    a.addEventListener('error', fail);
    a.addEventListener('ended', () => {
      if (failed || !alive(epoch)) return;
      stopAudio();
      setTimeout(() => speakChunk(i + 1, epoch), 120);
    });
    const pr = a.play();
    if (pr && pr.catch) pr.catch(fail);
  }
  function stopAudio() {
    if (state.audio) {
      try { state.audio.pause(); } catch (e) { /* เงียบ ๆ */ }
      state.audio.removeAttribute('src');
      state.audio = null;
    }
  }
  function stopAll() {
    state.epoch += 1;
    state.stopped = true; state.playing = false; state.paused = false;
    speechSynthesis.cancel();
    stopAudio();
    clearReading();
    setBtnOn(null);
    setStatus('หยุดแล้ว');
    el.pauseBtn.textContent = '⏸ พัก';
  }
  function togglePause() {
    if (!state.playing) return;
    if (state.paused) {
      if (state.audio) state.audio.play().catch(() => {});
      speechSynthesis.resume();
      state.paused = false;
      el.pauseBtn.textContent = '⏸ พัก';
      setStatus('กำลังอ่าน: ' + state.label);
    } else {
      if (state.audio) state.audio.pause();
      speechSynthesis.pause();
      state.paused = true;
      el.pauseBtn.textContent = '▶ เล่นต่อ';
      setStatus('พักการอ่านอยู่');
    }
  }
  function finish() {
    state.playing = false; state.paused = false; state.stopped = true;
    clearReading();
    setBtnOn(null);
    setStatus('อ่านจบแล้ว ✓');
    el.pauseBtn.textContent = '⏸ พัก';
  }
  function setStatus(t) { el.status.textContent = t; }
  function markReading(t) { clearReading(); t.classList.add('tts-reading'); }
  function clearReading() { document.querySelectorAll('.tts-reading').forEach((n) => n.classList.remove('tts-reading')); }
  function setBtnOn(btn) {
    document.querySelectorAll('.tts-btn.on').forEach((b) => b.classList.remove('on'));
    if (btn) btn.classList.add('on');
  }

  /* ---------- ปุ่ม 🔊 ---------- */
  function makeBtn(target, label, cls) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tts-btn' + (cls ? ' ' + cls : '');
    b.textContent = '🔊 อ่าน';
    b.setAttribute('aria-label', 'อ่านออกเสียง: ' + label);
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      if (state.playing && state.target === target) stopAll();
      else startRead(target, label, b);
    });
    return b;
  }
  /* เนื้อหาของหัวข้อย่อย h3 = ทุก node ถัดจาก h3 จนถึง h2/h3 ถัดไป */
  function subsectionContent(h3) {
    const box = document.createElement('div');
    let node = h3.nextElementSibling;
    while (node && !/^H[123]$/.test(node.tagName)) {
      box.appendChild(node.cloneNode(true));
      node = node.nextElementSibling;
    }
    const head = document.createElement('h3');
    head.textContent = h3.textContent;
    box.prepend(head);
    return box;
  }
  /* เนื้อหาของ section h2 = ทุก node ถัดจาก h2 จนถึง h2 ถัดไป (หรือจบหน้า) */
  function sectionContent(h2) {
    const box = document.createElement('div');
    let node = h2.nextElementSibling;
    while (node && !/^H[12]$/.test(node.tagName)) {
      box.appendChild(node.cloneNode(true));
      node = node.nextElementSibling;
    }
    const head = document.createElement('h2');
    head.textContent = h2.textContent;
    box.prepend(head);
    return box;
  }
  function stripEmoji(t) { return t.replace(EMOJI_RE, '').replace(/\s+/g, ' ').trim(); }

  function injectButtons() {
    /* ระดับ section (h2) */
    document.querySelectorAll('main h2').forEach((h2) => {
      const name = stripEmoji(h2.textContent).slice(0, 60);
      const box = sectionContent(h2);
      box.__anchor = h2;
      h2.appendChild(makeBtn(box, name, 'tts-sec'));
    });
    /* ระดับหัวข้อย่อย (h3) — อ่านเฉพาะท่อนของหัวข้อนั้น */
    document.querySelectorAll('main h3').forEach((h3) => {
      const box = subsectionContent(h3);
      box.__anchor = h3;
      h3.appendChild(makeBtn(box, stripEmoji(h3.textContent).slice(0, 60), 'tts-sub'));
    });
    /* กล่องพื้นฐาน/เปรียบเทียบ/แนวข้อสอบ — อ่านเฉพาะกล่องนั้น */
    document.querySelectorAll('main .box > .box-title').forEach((t) => {
      const box = t.parentElement;
      t.appendChild(makeBtn(box, stripEmoji(t.textContent).slice(0, 50)));
    });
    /* เฉลย — กดอ่านเฉลยได้ทันที (ไม่พับ/กางกล่อง) */
    document.querySelectorAll('main details.sol > summary').forEach((s) => {
      s.appendChild(makeBtn(s.parentElement, 'เฉลย'));
    });
    /* แบบทดสอบ MCQ — อ่านคำถาม + ตัวเลือก */
    document.querySelectorAll('main .mcq > .q').forEach((q) => {
      q.appendChild(makeBtn(q.parentElement, 'คำถามทดสอบ'));
    });
    /* hero — อ่านชื่อบท + สิ่งที่ต้องรู้ */
    const hero = document.querySelector('main .hero');
    if (hero) {
      const head = hero.querySelector('h1');
      if (head) head.appendChild(makeBtn(hero, stripEmoji(document.title).slice(0, 50)));
    }
  }

  /* ---------- แถบควบคุมลอย ---------- */
  const el = {};
  function buildBar() {
    const bar = document.createElement('div');
    bar.className = 'tts-bar';
    bar.innerHTML = `
      <div class="tts-bar-head">
        <span class="tts-bar-title">🔊 อ่านออกเสียง</span>
        <button type="button" class="tts-fold" aria-label="ย่อ/กางแถบควบคุม">▾</button>
      </div>
      <div class="tts-bar-body">
        <div class="tts-status" role="status">พร้อม — กดปุ่ม 🔊 อ่าน ที่หัวข้อ กล่องความรู้ หรือเฉลยที่ต้องการฟัง</div>
        <div class="tts-row">
          <label>เสียงไทย <select name="tts-voice-th" class="tts-vth"></select></label>
          <label>เสียงอังกฤษ <select name="tts-voice-en" class="tts-ven"></select></label>
        </div>
        <div class="tts-row">
          <label>ความเร็ว
            <select name="tts-rate" class="tts-rate">
              <option value="0.75">ช้า 0.75×</option>
              <option value="0.9">ช้านิด 0.9×</option>
              <option value="1" selected>ปกติ 1×</option>
              <option value="1.15">เร็วนิด 1.15×</option>
              <option value="1.3">เร็ว 1.3×</option>
              <option value="1.5">เร็วมาก 1.5×</option>
            </select>
          </label>
          <button type="button" class="tts-pause">⏸ พัก</button>
          <button type="button" class="tts-stop">⏹ หยุด</button>
          <button type="button" class="tts-all">📖 อ่านทั้งหน้า</button>
        </div>
        <div class="tts-hint"></div>
      </div>`;
    document.body.appendChild(bar);
    el.bar = bar;
    el.status = bar.querySelector('.tts-status');
    el.hint = bar.querySelector('.tts-hint');
    el.selTh = bar.querySelector('.tts-vth');
    el.selEn = bar.querySelector('.tts-ven');
    el.selRate = bar.querySelector('.tts-rate');
    el.pauseBtn = bar.querySelector('.tts-pause');
    bar.querySelector('.tts-fold').addEventListener('click', () => bar.classList.toggle('min'));
    el.pauseBtn.addEventListener('click', togglePause);
    bar.querySelector('.tts-stop').addEventListener('click', stopAll);
    bar.querySelector('.tts-all').addEventListener('click', () => {
      const inner = document.querySelector('main');
      if (state.playing && state.target === inner) stopAll();
      else startRead(inner, 'ทั้งหน้า');
    });
    el.selRate.value = String(state.rate);
    el.selRate.addEventListener('change', () => {
      state.rate = parseFloat(el.selRate.value) || 1;
      savePrefs();
      if (state.playing && !state.paused) {
        if (state.audio) state.audio.playbackRate = clampRate(state.rate);   /* ออนไลน์: ปรับทันที */
        else { const t = state.target, l = state.label, b = state.btn; startRead(t, l, b); } /* เสียงเครื่อง: เริ่มใหม่ */
      }
    });
    el.selTh.addEventListener('change', () => { state._savedTh = el.selTh.value; state.thaiSel = byValue(el.selTh); savePrefs(); });
    el.selEn.addEventListener('change', () => { state._savedEn = el.selEn.value; state.enSel = byValue(el.selEn); savePrefs(); });
    /* กด Esc = หยุดอ่าน */
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && state.playing) stopAll(); });
  }

  /* ---------- เริ่มทำงาน ---------- */
  loadPrefs();
  buildBar();
  injectButtons();
  refreshVoices();
  if (typeof speechSynthesis.addEventListener === 'function') {
    speechSynthesis.addEventListener('voiceschanged', refreshVoices);
  } else {
    speechSynthesis.onvoiceschanged = refreshVoices;
  }
  /* เสียงบางเครื่องมาช้า — ลองโหลดซ้ำช่วงแรก */
  let tries = 0;
  const t = setInterval(() => {
    tries += 1;
    if (allVoices().length || tries > 10) clearInterval(t);
    else refreshVoices();
  }, 400);
  window.addEventListener('beforeunload', () => { speechSynthesis.cancel(); stopAudio(); });
})();
