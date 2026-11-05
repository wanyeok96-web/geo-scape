// 하단 타임라인: 슬라이더, 주요 연도 마커, 재생/속도, 이전·다음 시점
import { $, escapeHtml, refreshIcons } from './utils.js';

const BASE_STEP_MS = 900; // 1× 속도에서 1년당 시간
const GLIDE_MS = 420;      // 클릭으로 연도를 옮길 때 막대가 미끄러지는 시간
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export function initTimeline(store, getData) {
  const slider = $('#tlSlider');
  const marks = $('#tlMarks');
  const erasEl = $('#tlEras');
  const scale = $('#tlScale');
  const yearEl = $('#tlYear');
  const playBtn = $('#tlPlay');
  const speedSel = $('#tlSpeed');
  // 막대 위치(pos)는 실수로 연속 이동하고, 지도·자료는 정수 연도가 바뀔 때만 갱신합니다.
  // (자료가 없는 연도 사이 값을 만들어 내지 않는 원칙 유지 – 움직임만 부드럽게)
  let pos = null;          // 현재 막대 위치 (실수 연도)
  let rafId = null;        // 재생 루프
  let glideId = null;      // 클릭 이동 애니메이션
  let lastTs = null;
  let fromLoop = false;    // 재생 루프가 바꾼 연도인지
  let dragging = false;

  const pct = (y) => {
    const { start, end } = getData().region.timeRange;
    return ((y - start) / (end - start)) * 100;
  };

  function build() {
    const data = getData();
    const { start, end } = data.region.timeRange;
    slider.min = start; slider.max = end;

    erasEl.innerHTML = data.eras.map((e) => {
      const l = pct(e.start), r = pct(Math.min(e.end + 1, end));
      return `<button class="tl-era" data-year="${e.start}" data-era="${e.id}" data-short="${e.id.replace('s', '')}"
        style="left:${l}%;width:${Math.max(r - l, 4)}%" title="${escapeHtml(e.title)}">${e.id.replace('s', '년대')} ${escapeHtml(e.title)}</button>`;
    }).join('');

    marks.innerHTML = data.region.milestones.map((m) =>
      `<button class="tl-mark" data-year="${m.year}" style="left:${pct(m.year)}%" aria-label="${m.year}년 ${escapeHtml(m.label)}"><span class="tl-tip">${m.year} · ${escapeHtml(m.label)}</span></button>`
    ).join('');

    const ticks = [];
    for (let y = Math.ceil(start / 10) * 10; y <= end; y += 10) ticks.push(y);
    if (!ticks.includes(end)) ticks.push(end);
    scale.innerHTML = ticks.map((y) => `<span style="left:${pct(y)}%">${y}</span>`).join('');
  }

  // 막대(슬라이더 손잡이·진행 막대)만 그리기
  function setVisual(v) {
    pos = v;
    slider.value = v;
    slider.style.setProperty('--p', pct(v) + '%');
  }
  // 현재 위치에서 목표 연도까지 부드럽게 이동
  function glideTo(target) {
    cancelAnimationFrame(glideId);
    const from = pos ?? target;
    if (reducedMotion() || Math.abs(target - from) < 0.01) { setVisual(target); return; }
    const t0 = performance.now();
    const dur = Math.min(GLIDE_MS + Math.abs(target - from) * 8, 900); // 먼 거리는 조금 더 길게
    const frame = (now) => {
      const k = Math.min(1, (now - t0) / dur);
      setVisual(from + (target - from) * easeInOut(k));
      if (k < 1) glideId = requestAnimationFrame(frame);
    };
    glideId = requestAnimationFrame(frame);
  }

  function render(year) {
    if (fromLoop || dragging) { /* 막대는 루프·손가락이 이미 그리는 중 */ }
    else if (pos == null) setVisual(year);
    else glideTo(year);
    yearEl.textContent = year;
    const era = getData().getEra(year);
    erasEl.querySelectorAll('.tl-era').forEach((b) => b.classList.toggle('is-active', b.dataset.era === era.id));
    marks.querySelectorAll('.tl-mark').forEach((m) => m.classList.toggle('is-passed', +m.dataset.year <= year));
  }

  // ---------- 재생 ----------
  function setPlayIcon(playing) {
    playBtn.innerHTML = `<i data-lucide="${playing ? 'pause' : 'play'}"></i>`;
    playBtn.title = playing ? '일시정지' : '재생';
    playBtn.setAttribute('aria-label', playBtn.title);
    refreshIcons();
  }
  // 매 프레임 막대를 조금씩 이동, 정수 연도를 넘을 때만 상태(지도·패널) 갱신
  function loop(ts) {
    if (!store.get().playing) return;
    const dt = lastTs == null ? 0 : Math.min(ts - lastTs, 100); // 탭 전환 후 급점프 방지
    lastTs = ts;
    const end = getData().region.timeRange.end;
    const next = Math.min(end, pos + (dt / BASE_STEP_MS) * +speedSel.value);
    setVisual(next);
    const y = Math.floor(next + 1e-6);
    if (y !== store.get().year) {
      fromLoop = true;
      try { store.set({ year: y }); } finally { fromLoop = false; }
    }
    if (next >= end) { stop(); return; }
    rafId = requestAnimationFrame(loop);
  }
  function play() {
    const { start, end } = getData().region.timeRange;
    cancelAnimationFrame(glideId);
    if (store.get().year >= end) store.set({ year: start });
    setVisual(store.get().year);
    lastTs = null;
    store.set({ playing: true });
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(loop);
  }
  function stop() {
    cancelAnimationFrame(rafId); rafId = null;
    store.set({ playing: false });
    // 멈춘 자리에서 현재 연도 눈금으로 살짝 맞춤
    glideTo(store.get().year);
  }
  const toggle = () => (store.get().playing ? stop() : play());

  function step(dir) {
    const keys = getData().keyYears();
    const y = store.get().year;
    const target = dir > 0 ? keys.find((k) => k > y) : [...keys].reverse().find((k) => k < y);
    if (target != null) { stop(); store.set({ year: target }); }
  }
  function nudge(d) {
    const { start, end } = getData().region.timeRange;
    stop();
    store.set({ year: Math.min(end, Math.max(start, store.get().year + d)) });
  }

  // ---------- 이벤트 ----------
  // 끌기: 막대는 손가락을 그대로 따라가고, 연도는 반올림한 값으로 갱신 → 놓으면 눈금에 맞춤
  slider.addEventListener('input', () => {
    if (store.get().playing) { cancelAnimationFrame(rafId); store.set({ playing: false }); }
    cancelAnimationFrame(glideId);
    dragging = true;
    setVisual(+slider.value);
    store.set({ year: Math.round(+slider.value) });
  });
  const endDrag = () => { if (!dragging) return; dragging = false; glideTo(store.get().year); };
  slider.addEventListener('change', endDrag);
  slider.addEventListener('pointerup', endDrag);
  slider.addEventListener('blur', endDrag);
  // step="any" 이므로 키보드 조작은 직접 1년 단위로 처리
  slider.addEventListener('keydown', (e) => {
    const map = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 };
    if (e.key in map) { e.preventDefault(); e.shiftKey ? step(map[e.key]) : nudge(map[e.key]); }
    else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      const { start, end } = getData().region.timeRange;
      if (store.get().playing) stop();
      store.set({ year: e.key === 'Home' ? start : end });
    }
  });
  playBtn.addEventListener('click', toggle);
  $('#tlPrev').addEventListener('click', () => step(-1));
  $('#tlNext').addEventListener('click', () => step(1));
  // 속도 변경은 재생 루프가 매 프레임 읽으므로 따로 처리할 필요 없음
  erasEl.addEventListener('click', (e) => { const b = e.target.closest('[data-year]'); if (b) { stop(); store.set({ year: +b.dataset.year }); } });
  marks.addEventListener('click', (e) => {
    const b = e.target.closest('[data-year]');
    if (!b) return;
    stop();
    const ms = getData().region.milestones.find((m) => m.year === +b.dataset.year);
    store.set({ year: ms.year, focusRequest: { ...ms.focus, t: Date.now() } });
  });

  document.addEventListener('keydown', (e) => {
    if (store.get().mode !== 'explore') return;
    if (document.querySelector('.modal:not([hidden])')) return;
    const tag = e.target.tagName;
    if (e.target === slider || ['INPUT', 'SELECT', 'TEXTAREA'].includes(tag)) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const d = e.key === 'ArrowRight' ? 1 : -1;
      e.shiftKey ? step(d) : nudge(d);
    } else if (e.key === ' ' && tag !== 'BUTTON') {
      e.preventDefault();
      toggle();
    }
  });

  store.subscribe((s, prev, changed) => {
    if (changed.includes('year')) render(s.year);
    if (changed.includes('playing')) {
      if (!s.playing && rafId) { cancelAnimationFrame(rafId); rafId = null; }
      setPlayIcon(s.playing);
    }
    if (changed.includes('mode') && s.mode !== 'explore') stop();
  });

  return { build, render, stop };
}
