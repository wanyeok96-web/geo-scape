// 오른쪽 정보 패널: 선택 연도의 시대 정보·사례·사진·통계·탐구 질문·출처
import { $, escapeHtml, refreshIcons } from './utils.js';
import { createStatsChart } from './stats-chart.js';

export function initInfoPanel(store, getData, { onPhotoOpen, onOpenGallery }) {
  const root = $('#panelContent');
  let currentEraId = null;
  let chart = null;

  const MAX_STRIP = 6;

  function photoThumb(p, year) {
    const exact = p.year === year;
    return `<button class="photo-thumb ${exact ? 'is-exact' : ''}" data-photo-id="${p.id}" title="${escapeHtml(p.title)} – 클릭하여 확대">
      <img src="${escapeHtml(p.thumb || p.src)}" alt="${escapeHtml(p.title)}" loading="lazy">
      ${exact ? '<span class="pt-badge pt-badge-year">선택 연도</span>' : ''}
      ${p.mapLinked ? `<span class="pt-pin" title="지도에 위치 표시됨"><i data-lucide="map-pin"></i></span>` : ''}
      <span class="pt-cap">${escapeHtml(p.title)}<small>${escapeHtml(p.date?.label || p.period?.label || '시기 미상')}</small></span>
    </button>`;
  }

  function renderPhotos(year) {
    const data = getData();
    const era = data.getEra(year);
    const list = data.photosNearYear(year);
    const box = $('#panelPhotos', root);
    if (!box) return;
    const countEl = $('#panelPhotoCount', root);
    if (countEl) countEl.textContent = `${list.length}건`;
    if (!list.length) {
      const need = data.neededForEra(era);
      box.innerHTML = `<div class="empty">이 시기에는 이용 조건이 확인된 실제 사진이 아직 없습니다.<br>임의의 이미지는 사용하지 않습니다.</div>
        ${need.length ? `<div class="needed-list"><b>추가 확보가 필요한 사진</b><ul>${need.map((n) => `<li>${escapeHtml(n.topic)} <small>(${escapeHtml(n.place)})</small></li>`).join('')}</ul></div>` : ''}`;
      return;
    }
    const exactCount = list.filter((p) => p.year === year).length;
    box.innerHTML = `
      <p class="photo-hint">${exactCount ? `<b>${year}년</b>에 촬영된 사진 ${exactCount}건` : `${year}년 촬영 사진은 없어 가까운 연도 순으로 표시`}</p>
      <div class="photo-strip">${list.slice(0, MAX_STRIP).map((p) => photoThumb(p, year)).join('')}</div>
      ${list.length > MAX_STRIP ? `<button class="btn btn-block" data-open-gallery="${era.id}"><i data-lucide="images"></i>이 시기 사진 ${list.length}건 모두 보기</button>` : ''}`;
    refreshIcons();
  }

  function renderEra(era, year) {
    const data = getData();
    const series = data.stats[0];
    const sources = [...new Set([...(era.sourceIds || []), ...(series?.sourceIds || [])])].map((id) => data.sources[id]).filter(Boolean);

    root.innerHTML = `
      <div class="era-head">
        <span class="era-period"><i data-lucide="calendar-range"></i>${era.start}–${era.end} · 관측 자료</span>
        <h2>${escapeHtml(era.id.replace('s', '년대'))} ${escapeHtml(era.title)}</h2>
        <p>${escapeHtml(era.summary)}</p>
        ${era.layerNotice ? `<p class="callout" style="margin-top:10px"><i data-lucide="info"></i><span>${escapeHtml(era.layerNotice)}</span></p>` : ''}
      </div>

      <section class="p-section">
        <h3><i data-lucide="camera"></i>이 시기의 사진 자료<span class="count" id="panelPhotoCount"></span></h3>
        <div id="panelPhotos"></div>
      </section>

      <section class="p-section">
        <h3><i data-lucide="map"></i>지리적 특징</h3>
        <ul class="feature-list">${era.features.map((f) => `<li>${escapeHtml(f)}</li>`).join('')}</ul>
      </section>

      <section class="p-section">
        <h3><i data-lucide="book-open-text"></i>공간 변화의 배경</h3>
        <p>${escapeHtml(era.background)}</p>
      </section>

      <section class="p-section">
        <h3><i data-lucide="building"></i>주요 개발·도시화 사례<span class="count">클릭하면 지도로 이동</span></h3>
        <div class="case-list">${era.cases.map((c) => `
          <button class="case-btn" data-feature="${c.featureId || ''}" data-year="${data.featureIndex[c.featureId]?.year ?? ''}" ${c.featureId ? '' : 'tabindex="-1"'}>
            <b>${escapeHtml(c.title)}${c.featureId ? '<i data-lucide="locate-fixed"></i>' : ''}</b><span>${escapeHtml(c.text)}</span>
          </button>`).join('')}</div>
      </section>

      ${series ? `
      <section class="p-section">
        <h3><i data-lucide="chart-line"></i>${escapeHtml(series.label)} 변화</h3>
        <div class="chart-value" id="chartValue"></div>
        <div class="chart-box"><canvas id="statsCanvas" aria-label="${escapeHtml(series.label)} 그래프"></canvas></div>
        <p class="chart-note">${escapeHtml(series.note)}</p>
      </section>` : ''}

      <section class="p-section">
        <h3><i data-lucide="message-circle-question"></i>탐구 질문</h3>
        <ol class="question-list">${era.questions.map((q) => `<li>${escapeHtml(q)}</li>`).join('')}</ol>
      </section>

      <section class="p-section">
        <h3><i data-lucide="library"></i>자료 출처</h3>
        <ul class="source-list">${sources.map((s) => `
          <li><a href="${escapeHtml(s.url)}" target="_blank" rel="noopener">${escapeHtml(s.title)}</a>
          <small>${escapeHtml(s.publisher)} · ${escapeHtml(s.license)} · ${escapeHtml(s.usedFor)}</small></li>`).join('')}</ul>
        <p class="callout" style="margin-top:10px"><i data-lucide="info"></i><span>설명 문안은 공개 자료를 바탕으로 작성된 교육용 요약입니다. 지도 레이어는 데모·개략 자료이며, 사진은 플레이스홀더입니다.</span></p>
      </section>`;

    chart?.destroy();
    try {
      chart = series ? createStatsChart($('#statsCanvas', root), series, data.region.timeRange) : null;
    } catch (err) {
      console.error('[GeoScape] 그래프 오류', err);
      chart = null;
      const box = $('.chart-box', root);
      if (box) box.innerHTML = '<div class="empty">그래프를 표시하지 못했습니다.</div>';
    }
    refreshIcons();
    root.parentElement.scrollTop = 0;
  }

  function updateYear(year) {
    renderPhotos(year);
    root.querySelectorAll('.case-btn').forEach((b) => b.classList.toggle('is-upcoming', b.dataset.year !== '' && +b.dataset.year > year));
    const series = getData().stats[0];
    if (chart && series) {
      const d = chart.setYear(year);
      $('#chartValue', root).innerHTML = d
        ? `<b>${d.value.toLocaleString()}${escapeHtml(series.unit)}</b><span>${d.year}년 조사 기준${d.year !== year ? ` (가장 가까운 이전 조사)` : ''}</span>`
        : '<span>해당 연도 이전 조사 자료 없음</span>';
    }
  }

  function render(year) {
    const era = getData().getEra(year);
    try {
      if (era.id !== currentEraId) { currentEraId = era.id; renderEra(era, year); }
    } catch (err) {
      console.error('[GeoScape] 정보 패널 오류', err);
      root.innerHTML = `<div class="empty">이 시기의 정보를 표시하지 못했습니다. (${escapeHtml(era.id)})</div>`;
      return;
    }
    try { updateYear(year); } catch (err) { console.error('[GeoScape] 정보 패널 갱신 오류', err); }
  }

  root.addEventListener('click', (e) => {
    const ph = e.target.closest('[data-photo-id]');
    if (ph) { onPhotoOpen(ph.dataset.photoId, getData().photosNearYear(store.get().year).map((p) => p.id)); return; }
    const og = e.target.closest('[data-open-gallery]');
    if (og) { onOpenGallery?.(og.dataset.openGallery); return; }
    const cs = e.target.closest('.case-btn');
    if (cs?.dataset.feature) {
      const patch = { focusRequest: { featureId: cs.dataset.feature, t: Date.now() }, playing: false };
      // 아직 발생하지 않은 사례라면 해당 연도로 이동
      if (cs.dataset.year && +cs.dataset.year > store.get().year) patch.year = +cs.dataset.year;
      store.set(patch);
    }
  });

  store.subscribe((s, prev, changed) => { if (changed.includes('year')) render(s.year); });

  return { render, reset() { currentEraId = null; } };
}
