// GeoScape 진입점: 데이터 로드 → 상태 저장소 → 각 UI 모듈 연결
import { $, $$, escapeHtml, refreshIcons, iconSvg, statusBadge, storage, DATA_STATUS } from './utils.js';
import { createStore } from './store.js';
import { loadRegistry, loadRegion } from './data.js';
import { createMapView } from './map-view.js';
import { initTimeline } from './timeline.js';
import { initSidebar } from './sidebar.js';
import { initInfoPanel } from './info-panel.js';
import { initGallery } from './gallery.js';
import { initCompare } from './compare.js';
import { initModals, openModal } from './modal.js';

const app = $('#app');

function fatal(title, html) {
  const div = document.createElement('div');
  div.className = 'fatal';
  div.innerHTML = `<div class="fatal-box"><h2>${title}</h2>${html}</div>`;
  document.body.appendChild(div);
}

async function boot() {
  // 모듈판(js/main.js)과 번들판(dist/geoscape.bundle.js)이 함께 실행되지 않도록 한 번만 부팅
  if (window.__geoscapeBooted) return;
  const bundled = typeof __GEOSCAPE_BUNDLED !== 'undefined';
  // file:// 에서는 번들판이 담당 (모듈판은 데이터를 불러올 수 없음)
  if (location.protocol === 'file:' && !bundled) return;
  window.__geoscapeBooted = true;

  if (location.protocol === 'file:' && !window.GEOSCAPE_EMBEDDED) {
    fatal('데이터 파일이 없습니다', `
      <p class="muted">파일을 직접 열어 실행하려면 <b>dist/geoscape-data.js</b>가 필요합니다.</p>
      <p>프로젝트 폴더의 <b>start-server.bat</b>을 실행하거나, 아래 명령으로 번들을 다시 만드세요.</p>
      <code>node scripts/build-standalone.mjs</code>`);
    return;
  }
  if (!window.L) {
    fatal('지도 라이브러리를 불러오지 못했습니다', '<p class="muted">vendor/leaflet 폴더가 있는지 확인한 뒤 새로고침해 주세요.</p>');
    return;
  }

  initModals();
  refreshIcons();

  let data;
  let registry;
  try {
    registry = await loadRegistry();
    const meta = registry.regions.find((r) => r.id === registry.defaultRegion);
    data = await loadRegion(meta);
  } catch (err) {
    console.error(err);
    fatal('데이터를 불러오지 못했습니다', `<p class="muted">${escapeHtml(err.message)}</p>`);
    return;
  }
  const getData = () => data;

  // ---------- 상태 ----------
  const defaultLayers = (d) => Object.fromEntries(d.region.layers.map((l) => [l.id, l.defaultOn]));
  const store = createStore({
    year: data.region.timeRange.start,
    mode: 'explore',
    layers: defaultLayers(data),
    basemap: 'light',
    topicId: null,
    playing: false,
    focusRequest: null,
    mainView: null
  });

  // ---------- 지역 선택 ----------
  const regionSel = $('#regionSelect');
  regionSel.innerHTML = registry.regions.map((r) =>
    `<option value="${r.id}" ${r.enabled ? '' : 'disabled'}>${escapeHtml(r.name)}${r.enabled ? '' : ' (준비 중)'}</option>`).join('');
  regionSel.value = data.meta.id;

  // ---------- 지도 ----------
  let mainView = null;
  const photoOpen = (id, list) => gallery.openPhoto(id, list);
  function createMain() {
    mainView?.destroy();
    mainView = createMapView($('#map'), data, {
      onPhotoOpen: (id) => photoOpen(id, data.photosNearYear(store.get().year).filter((p) => p.mapLinked).map((p) => p.id)),
      onLayerAutoOn: (layerId) => store.set({ layers: { ...store.get().layers, [layerId]: true } })
    });
    mainView.setBasemap(store.get().basemap);
    Object.entries(store.get().layers).forEach(([id, on]) => mainView.setLayerVisible(id, on));
    mainView.setYear(store.get().year);
    store.set({ mainView: mainView.map });
  }

  // ---------- 모듈 ----------
  const timeline = initTimeline(store, getData);
  const sidebar = initSidebar(store, getData);
  const panel = initInfoPanel(store, getData, { onPhotoOpen: photoOpen, onOpenGallery: (eraId) => gallery.openGallery(eraId) });
  const gallery = initGallery(store, getData, {
    onLocate(p) {
      store.set({ mode: 'explore' });
      const era = data.getEra(store.get().year);
      const visibleNow = data.photosForEra(era).some((x) => x.id === p.id);
      const patch = { playing: false, focusRequest: { photoId: p.id, t: Date.now() } };
      if (!visibleNow && p.period?.start != null) patch.year = p.period.start;
      store.set(patch);
    }
  });
  const compare = initCompare(store, getData, { onPhotoOpen: photoOpen });

  // ---------- 범례 ----------
  function renderLegend() {
    const s = store.get();
    const y = s.year;
    const groups = [];
    for (const l of data.region.layers) {
      if (!s.layers[l.id]) continue;
      const fc = data.geo[l.id];
      if (l.kind === 'urban-stage') {
        const present = new Set(fc.features.filter((f) => f.properties.yearStart <= y).map((f) => f.properties.stage));
        groups.push(`<div class="legend-group"><h4>${escapeHtml(l.label)} ${statusBadge(l.dataStatus)}</h4>${Object.entries(l.stageColors).map(([k, c]) =>
          `<div class="legend-row ${present.has(k) ? '' : 'is-dim'}"><span class="swatch" style="background:${c}"></span>${escapeHtml(l.stageLabels[k])}</div>`).join('')}</div>`);
      } else if (l.kind === 'line') {
        const present = new Set(fc.features.filter((f) => f.properties.yearStart <= y).map((f) => f.properties.mode));
        groups.push(`<div class="legend-group"><h4>${escapeHtml(l.label)} ${statusBadge(l.dataStatus)}</h4>${Object.entries(l.modeStyles).map(([k, st]) =>
          `<div class="legend-row ${present.has(k) ? '' : 'is-dim'}"><span class="swatch-line" style="border-color:${st.color};${st.dashArray ? 'border-top-style:dashed' : ''}"></span>${escapeHtml(st.label)}</div>`).join('')}</div>`);
      } else if (l.kind === 'landuse') {
        const present = new Set(fc.features.filter((f) => f.properties.yearStart <= y && (f.properties.yearEnd ?? 9999) >= y).map((f) => f.properties.type));
        const rows = Object.entries(l.typeStyles).filter(([k]) => present.has(k));
        groups.push(`<div class="legend-group"><h4>${escapeHtml(l.label)} ${statusBadge(l.dataStatus)}</h4>${rows.length ? rows.map(([, st]) =>
          `<div class="legend-row"><span class="swatch" style="background:${st.color}"></span>${escapeHtml(st.label)}</div>`).join('') : '<div class="legend-row">표시할 자료 없음</div>'}</div>`);
      } else if (l.kind === 'point') {
        groups.push(`<div class="legend-group"><div class="legend-row"><span class="gs-marker" style="width:18px;height:18px;border-width:1px">${iconSvg('map-pin', 10)}</span>${escapeHtml(l.label)}</div>
          <div class="legend-row"><span class="gs-marker is-new" style="width:18px;height:18px;border-width:1px">${iconSvg('map-pin', 10)}</span>최근 2년 내 개발</div></div>`);
      } else if (l.kind === 'photos') {
        groups.push(`<div class="legend-group"><div class="legend-row"><span class="gs-marker photo" style="width:18px;height:18px;border-width:1px">${iconSvg('camera', 10)}</span>${escapeHtml(l.label)} ${statusBadge(l.dataStatus)}</div></div>`);
      }
    }
    const legend = $('#legend');
    const wasOpen = legend.querySelector('details')?.open ?? !window.matchMedia('(max-width: 640px)').matches;
    legend.innerHTML = groups.length
      ? `<details ${wasOpen ? 'open' : ''}><summary>범례 · ${y}년</summary>${groups.join('')}</details>`
      : '';
  }

  function renderYearBadge(y) {
    const era = data.getEra(y);
    $('#yearBadgeYear').textContent = y;
    $('#yearBadgeEra').textContent = `${era.id.replace('s', '년대')} · ${era.title}`;
  }

  // ---------- 상태 → 지도 동기화 ----------
  store.subscribe((s, prev, changed) => {
    if (changed.includes('year')) { mainView.setYear(s.year); renderYearBadge(s.year); }
    if (changed.includes('layers')) Object.entries(s.layers).forEach(([id, on]) => { if (on !== prev.layers[id]) mainView.setLayerVisible(id, on); });
    if (changed.includes('basemap')) mainView.setBasemap(s.basemap);
    if (changed.includes('year') || changed.includes('layers')) renderLegend();
    if (changed.includes('focusRequest') && s.focusRequest) {
      if (s.mode !== 'explore') store.set({ mode: 'explore' });
      // 좁은 화면: 지도로 이동할 때 서랍(사이드바·패널)을 닫아 지도를 보여줌
      if (window.matchMedia('(max-width: 1024px)').matches) app.classList.add('sidebar-collapsed', 'panel-collapsed');
      mainView.focus(s.focusRequest);
    }
    if (changed.includes('mode')) {
      app.classList.toggle('mode-compare', s.mode === 'compare');
      $$('.seg-btn').forEach((b) => { const on = b.dataset.mode === s.mode; b.classList.toggle('is-active', on); b.setAttribute('aria-selected', on); });
      if (s.mode === 'explore') setTimeout(() => mainView.invalidate(), 50);
    }
  });

  // ---------- 헤더·패널 조작 ----------
  $$('.seg-btn').forEach((b) => b.addEventListener('click', () => { if (!b.disabled) store.set({ mode: b.dataset.mode }); }));
  $('#helpBtn').addEventListener('click', () => openModal('helpModal'));
  $('#openGalleryBtn').addEventListener('click', () => gallery.openGallery());
  $('#dataNoticeBtn').addEventListener('click', () => { renderDataModal(); openModal('dataModal'); });

  const afterResize = () => setTimeout(() => { mainView.invalidate(); compare.invalidate(); }, 320);
  $('#sidebarToggle').addEventListener('click', () => { app.classList.toggle('sidebar-collapsed'); afterResize(); });
  $('#panelToggle').addEventListener('click', () => { app.classList.toggle('panel-collapsed'); afterResize(); });
  window.addEventListener('resize', () => mainView.invalidate());

  regionSel.addEventListener('change', async () => {
    const meta = registry.regions.find((r) => r.id === regionSel.value);
    if (!meta?.enabled) return;
    try {
      data = await loadRegion(meta);
      store.set({ year: data.region.timeRange.start, layers: defaultLayers(data), topicId: null, playing: false, mode: 'explore' });
      startRegion();
    } catch (err) { alert('지역 데이터를 불러오지 못했습니다: ' + err.message); }
  });

  function renderDataModal() {
    const rows = data.region.layers.map((l) => {
      const notice = data.geo[l.id]?.metadata?.notice || (l.kind === 'photos' ? data.photoInfo.notice : '');
      return `<tr><td><b>${escapeHtml(l.label)}</b></td><td>${statusBadge(l.dataStatus)}</td><td class="muted">${escapeHtml(notice)}</td></tr>`;
    }).join('');
    const stats = data.stats.map((s) => `<tr><td><b>${escapeHtml(s.label)}</b></td><td>${statusBadge(s.verified ? 'verified' : 'approx')}</td><td class="muted">${escapeHtml(s.note)}</td></tr>`).join('');
    $('#dataBody').innerHTML = `
      <p class="muted">GeoScape는 실제 관측 자료와 교육용 데모 자료를 구분해 표시합니다. 자료가 없는 연도에는 값을 보간하거나 공간 분포를 만들어 내지 않습니다.</p>
      <table class="data-table"><thead><tr><th>자료</th><th>상태</th><th>설명</th></tr></thead><tbody>${rows}${stats}</tbody></table>
      <h3 style="margin:18px 0 6px;font-size:14px">상태 표시 기준</h3>
      <ul class="source-list">${Object.values(DATA_STATUS).map((d) => `<li><span class="status-badge ${d.className}">${d.label}</span> ${escapeHtml(d.desc)}</li>`).join('')}</ul>
      <h3 style="margin:18px 0 6px;font-size:14px">전체 출처</h3>
      <ul class="source-list">${Object.values(data.sources).map((s) => `<li><a href="${escapeHtml(s.url)}" target="_blank" rel="noopener">${escapeHtml(s.title)}</a><small>${escapeHtml(s.publisher)} · ${escapeHtml(s.license)} · ${escapeHtml(s.usedFor)}</small></li>`).join('')}</ul>`;
  }

  function startRegion() {
    createMain();
    timeline.build();
    sidebar.build();
    panel.reset();
    compare.reset();
    const y = store.get().year;
    timeline.render(y);
    panel.render(y);
    renderYearBadge(y);
    renderLegend();
  }

  startRegion();

  if (!storage.get('geoscape.helpSeen')) {
    openModal('helpModal');
    storage.set('geoscape.helpSeen', '1');
  }

  // 디버그·검증용 (콘솔에서 상태 확인)
  window.GeoScape = { store, getData };
}

boot();
