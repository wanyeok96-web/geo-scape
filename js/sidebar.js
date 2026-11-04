// 왼쪽 사이드바: 지역 정보, 탐구 주제, 주요 시점, 레이어, 사진 자료
import { $, escapeHtml, refreshIcons, statusBadge } from './utils.js';
import { BASEMAPS } from './map-view.js';

export function initSidebar(store, getData) {
  const regionInfo = $('#regionInfo');
  const topicList = $('#topicList');
  const topicQ = $('#topicQuestion');
  const msList = $('#milestoneList');
  const layerList = $('#layerList');
  const basemapSwitch = $('#basemapSwitch');

  function build() {
    const data = getData();
    const r = data.region;

    regionInfo.innerHTML = `
      <h3 class="card-title"><i data-lucide="map-pinned"></i>지역 정보</h3>
      <p class="region-name">${escapeHtml(r.name)}<span class="region-en">${escapeHtml(r.nameEn)}</span></p>
      <p class="region-summary">${escapeHtml(r.info.summary)}</p>
      <dl class="facts">${r.info.facts.map((f) => `<div class="fact"><dt>${escapeHtml(f.label)}</dt><dd>${escapeHtml(f.value)}</dd></div>`).join('')}</dl>`;

    topicList.innerHTML = r.topics.map((t) =>
      `<button class="topic-btn" data-topic="${t.id}"><i data-lucide="${t.icon}"></i>${escapeHtml(t.title)}</button>`).join('');

    msList.innerHTML = r.milestones.map((m, i) =>
      `<li><button class="milestone-btn" data-idx="${i}"><span class="ms-year">${m.year}</span><span>${escapeHtml(m.label)}</span></button></li>`).join('');

    basemapSwitch.innerHTML = Object.entries(BASEMAPS).map(([id, b]) =>
      `<button class="basemap-btn" data-basemap="${id}">${b.label}</button>`).join('') +
      `<button class="basemap-btn" disabled title="연도별 옛 지도·항공사진은 향후 지원 예정">옛 지도 <small>(예정)</small></button>`;

    layerList.innerHTML = r.layers.map((l) => `
      <label class="layer-item">
        <input type="checkbox" data-layer="${l.id}">
        <i data-lucide="${l.icon}"></i>
        <span class="layer-name">${escapeHtml(l.label)}</span>
        ${statusBadge(l.dataStatus)}
      </label>`).join('');

    const mapped = data.photos.filter((p) => p.mapLinked).length;
    $('#photoSummary').textContent = `실제 역사 사진 ${data.photos.length}건 (지도 연결 ${mapped}건 · 위치 미확인 ${data.photos.length - mapped}건) · 추가 확보 필요 ${data.photoInfo.needed.length}건`;

    refreshIcons();
    syncLayers(store.get());
    syncMilestones(store.get().year);
    syncTopic(store.get().topicId);
  }

  function syncLayers(s) {
    layerList.querySelectorAll('input[data-layer]').forEach((cb) => { cb.checked = !!s.layers[cb.dataset.layer]; });
    basemapSwitch.querySelectorAll('[data-basemap]').forEach((b) => b.classList.toggle('is-active', b.dataset.basemap === s.basemap));
  }

  function syncMilestones(year) {
    const ms = getData().region.milestones;
    // 현재 연도 이하의 가장 최근 시점을 '현재'로 강조
    let cur = -1;
    ms.forEach((m, i) => { if (m.year <= year) cur = i; });
    msList.querySelectorAll('.milestone-btn').forEach((b, i) => {
      b.classList.toggle('is-current', i === cur);
      b.classList.toggle('is-past', i < cur);
      b.classList.toggle('is-future', ms[i].year > year);
    });
  }

  function syncTopic(topicId) {
    const t = getData().region.topics.find((x) => x.id === topicId);
    topicList.querySelectorAll('.topic-btn').forEach((b) => b.classList.toggle('is-active', b.dataset.topic === topicId));
    topicQ.hidden = !t;
    if (t) topicQ.innerHTML = `<b>탐구 질문</b>${escapeHtml(t.question)}`;
  }

  // ---------- 이벤트 ----------
  topicList.addEventListener('click', (e) => {
    const b = e.target.closest('[data-topic]');
    if (!b) return;
    const s = store.get();
    if (s.topicId === b.dataset.topic) { store.set({ topicId: null }); return; }
    const t = getData().region.topics.find((x) => x.id === b.dataset.topic);
    const layers = Object.fromEntries(getData().region.layers.map((l) => [l.id, t.layers.includes(l.id)]));
    store.set({ topicId: t.id, layers });
  });

  msList.addEventListener('click', (e) => {
    const b = e.target.closest('[data-idx]');
    if (!b) return;
    const m = getData().region.milestones[+b.dataset.idx];
    store.set({ year: m.year, playing: false, focusRequest: { ...m.focus, t: Date.now() } });
  });

  layerList.addEventListener('change', (e) => {
    const cb = e.target.closest('input[data-layer]');
    if (cb) store.set({ layers: { ...store.get().layers, [cb.dataset.layer]: cb.checked } });
  });

  basemapSwitch.addEventListener('click', (e) => {
    const b = e.target.closest('[data-basemap]');
    if (b) store.set({ basemap: b.dataset.basemap });
  });

  store.subscribe((s, prev, changed) => {
    if (changed.includes('layers') || changed.includes('basemap')) syncLayers(s);
    if (changed.includes('year')) syncMilestones(s.year);
    if (changed.includes('topicId')) syncTopic(s.topicId);
  });

  return { build };
}
