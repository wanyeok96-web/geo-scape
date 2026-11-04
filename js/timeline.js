// 하단 타임라인: 슬라이더, 주요 연도 마커, 재생/속도, 이전·다음 시점
import { $, escapeHtml, refreshIcons } from './utils.js';

const BASE_STEP_MS = 900; // 1× 속도에서 1년당 시간

export function initTimeline(store, getData) {
  const slider = $('#tlSlider');
  const marks = $('#tlMarks');
  const erasEl = $('#tlEras');
  const scale = $('#tlScale');
  const yearEl = $('#tlYear');
  const playBtn = $('#tlPlay');
  const speedSel = $('#tlSpeed');
  let timer = null;

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

  function render(year) {
    slider.value = year;
    slider.style.setProperty('--p', pct(year) + '%');
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
  function tick() {
    const { year } = store.get();
    const end = getData().region.timeRange.end;
    if (year >= end) { stop(); return; }
    store.set({ year: year + 1 });
  }
  function schedule() {
    clearInterval(timer);
    timer = setInterval(tick, BASE_STEP_MS / +speedSel.value);
  }
  function play() {
    const { start, end } = getData().region.timeRange;
    if (store.get().year >= end) store.set({ year: start });
    store.set({ playing: true });
    schedule();
  }
  function stop() {
    clearInterval(timer); timer = null;
    store.set({ playing: false });
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
  slider.addEventListener('input', () => { if (store.get().playing) stop(); store.set({ year: +slider.value }); });
  playBtn.addEventListener('click', toggle);
  $('#tlPrev').addEventListener('click', () => step(-1));
  $('#tlNext').addEventListener('click', () => step(1));
  speedSel.addEventListener('change', () => { if (store.get().playing) schedule(); });
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
      if (!s.playing && timer) { clearInterval(timer); timer = null; }
      setPlayIcon(s.playing);
    }
    if (changed.includes('mode') && s.mode !== 'explore') stop();
  });

  return { build, render, stop };
}
