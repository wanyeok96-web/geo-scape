/* GeoScape standalone bundle – 자동 생성 파일입니다. 직접 수정하지 말고 scripts/build-standalone.mjs 를 실행하세요. */
(function () {
'use strict';
var __GEOSCAPE_BUNDLED = true;

// ===== js/utils.js =====
// 공통 유틸리티
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function escapeHtml(str = '') {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** <i data-lucide> 요소를 SVG 아이콘으로 변환 */
function refreshIcons() {
  if (window.lucide?.createIcons) window.lucide.createIcons();
}

/** 아이콘 SVG 문자열 (Leaflet divIcon 등 동적 HTML용) */
function iconSvg(name, size = 16) {
  const pascal = name.replace(/(^|-)([a-z0-9])/g, (_, __, c) => c.toUpperCase());
  const node = window.lucide?.icons?.[pascal];
  if (!node || !window.lucide.createElement) return '';
  const svg = window.lucide.createElement(node);
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  return svg.outerHTML;
}

const DATA_STATUS = {
  demo: { label: '데모', className: 'status-demo', desc: '교육용 데모 데이터 (실제 경계 아님)' },
  approx: { label: '개략', className: 'status-approx', desc: '실제 좌표 기반 개략 위치·선형' },
  placeholder: { label: '준비 중', className: 'status-placeholder', desc: '자료 준비 중' },
  verified: { label: '검증', className: 'status-verified', desc: '출처가 확인된 검증 자료' }
};

function statusBadge(status) {
  const s = DATA_STATUS[status];
  return s ? `<span class="status-badge ${s.className}" title="${escapeHtml(s.desc)}">${s.label}</span>` : '';
}

const storage = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, val) { try { localStorage.setItem(key, val); } catch { /* 저장소 사용 불가 시 무시 */ } }
};


// ===== js/store.js =====
// 간단한 전역 상태 저장소 (구독형)
function createStore(initial) {
  let state = { ...initial };
  const listeners = new Set();
  return {
    get: () => state,
    set(patch) {
      const prev = state;
      state = { ...state, ...patch };
      const changed = Object.keys(patch).filter((k) => prev[k] !== state[k]);
      if (changed.length) listeners.forEach((fn) => fn(state, prev, changed));
    },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  };
}


// ===== js/data.js =====
// 데이터 로더: 지역 레지스트리 → 지역별 JSON/GeoJSON 묶음
async function fetchJson(url) {
  // 더블클릭(file://) 실행: dist/geoscape-data.js 에 담긴 데이터 사용
  const embedded = window.GEOSCAPE_EMBEDDED?.[url];
  if (embedded) return JSON.parse(JSON.stringify(embedded));
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${url} 불러오기 실패 (${res.status})`);
  return res.json();
}

function loadRegistry() {
  return fetchJson('data/regions.json');
}

/** 지역 데이터 전체를 불러와 서로 연결된 하나의 객체로 반환 */
async function loadRegion(meta) {
  const base = meta.path;
  // 'data/'로 시작하면 프로젝트 루트 기준(여러 지역 공용 파일), 아니면 지역 폴더 기준
  const resolve = (p) => (p.startsWith('data/') ? p : base + p);
  const region = await fetchJson(base + 'region.json');
  const f = region.files;
  const [eras, photosFile, stats, sources] = await Promise.all([
    fetchJson(resolve(f.eras)), fetchJson(resolve(f.photos)), fetchJson(resolve(f.stats)), fetchJson(resolve(f.sources))
  ]);
  // 이 지역의 정식 등록 사진만 사용
  const photos = { photos: photosFile.photos.filter((p) => (p.region ?? meta.id) === meta.id) };

  const geo = {};
  await Promise.all(region.layers.filter((l) => l.file).map(async (l) => {
    geo[l.id] = await fetchJson(base + l.file);
  }));

  // 피처 ID 색인 (설명 패널·주요 시점에서 지도 피처로 연결)
  const featureIndex = {};
  for (const [layerId, fc] of Object.entries(geo)) {
    for (const ft of fc.features) {
      const p = ft.properties;
      featureIndex[p.id] = { layerId, feature: ft, year: p.yearStart ?? p.year ?? null };
    }
  }

  const sourceMap = Object.fromEntries(sources.sources.map((s) => [s.id, s]));
  const eraList = eras.eras.slice().sort((a, b) => a.start - b.start);

  return {
    meta, region, geo, featureIndex,
    eras: eraList,
    photos: photos.photos,
    photoInfo: {
      notice: photosFile.description,
      contentTypes: photosFile.contentTypes || {},
      locationPrecision: photosFile.locationPrecision || {},
      unverified: (photosFile.unverified || []),
      needed: (photosFile.needed || [])
    },
    stats: stats.series,
    sources: sourceMap,

    getEra(year) {
      return eraList.find((e) => year >= e.start && year <= e.end) ?? (year < eraList[0].start ? eraList[0] : eraList[eraList.length - 1]);
    },
    /** 해당 시기(시대 범위)와 촬영 시기가 겹치는 사진 */
    photosForEra(era) {
      return photos.photos.filter((p) => p.eraIds?.includes(era.id) ||
        (p.period?.start != null && p.period.start <= era.end && (p.period.end ?? p.period.start) >= era.start));
    },
    /** 선택 연도 기준: 같은 시대 사진을 촬영 연도가 가까운 순으로 */
    photosNearYear(year) {
      const era = this.getEra(year);
      return this.photosForEra(era)
        .map((p, i) => ({ p, i, d: p.year != null ? Math.abs(p.year - year) : 99 }))
        .sort((a, b) => a.d - b.d || a.i - b.i)
        .map((x) => x.p);
    },
    neededForEra(era) {
      return (photosFile.needed || []).filter((n) => n.eraId === era.id);
    },
    /** 주요 시점 연도 목록 (시대 시작 + 마일스톤 + 끝 연도) */
    keyYears() {
      const ys = new Set([...eraList.map((e) => e.start), ...region.milestones.map((m) => m.year), region.timeRange.end]);
      return [...ys].sort((a, b) => a - b);
    }
  };
}


// ===== js/map-view.js =====
// 지도 뷰: Leaflet 지도 + 연도별 공간 레이어 렌더링
// 같은 함수를 메인 지도와 비교 모드 지도에서 재사용합니다.

const BASEMAPS = {
  light: {
    // OSM 타일을 CSS 필터로 차분하게 표현 (공간 레이어가 잘 보이도록)
    label: '밝은 지도',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    options: { maxZoom: 19, className: 'gs-muted-tiles', attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }
  },
  osm: {
    label: '일반 지도',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    options: { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }
  },
  imagery: {
    label: '위성(현재)',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    options: { maxZoom: 18, attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics' }
  }
};

/**
 * @param {HTMLElement} el
 * @param {object} data   loadRegion() 결과
 * @param {object} opts   { onPhotoOpen(id), compact }
 */
function createMapView(el, data, opts = {}) {
  const L = window.L;
  const cfg = data.region.map;
  const map = L.map(el, {
    center: cfg.center, zoom: cfg.zoom, minZoom: cfg.minZoom, maxZoom: cfg.maxZoom,
    maxBounds: cfg.maxBounds, maxBoundsViscosity: 0.8, zoomControl: !opts.compact, attributionControl: true
  });
  if (opts.compact) L.control.zoom({ position: 'bottomright' }).addTo(map);

  // 레이어 순서용 pane: 오래된 시가지 단계일수록 위, 그 위에 토지 이용·교통망
  const stages = Object.keys(data.region.layers.find((l) => l.id === 'urban')?.stageColors || {});
  stages.forEach((s, i) => { map.createPane(`gs-urban-${s}`).style.zIndex = 410 - i; });
  map.createPane('gs-landuse').style.zIndex = 415;
  map.createPane('gs-transport').style.zIndex = 420;
  const labelsPane = map.createPane('gs-labels');
  labelsPane.style.zIndex = 430;
  labelsPane.style.pointerEvents = 'none';

  let baseLayer = null;
  let currentYear = null;
  const layerCfg = Object.fromEntries(data.region.layers.map((l) => [l.id, l]));
  const groups = {};
  const visible = {};
  const rendered = {}; // layerId → Map(featureId → leaflet layer)
  for (const l of data.region.layers) {
    groups[l.id] = L.featureGroup();
    rendered[l.id] = new Map();
    visible[l.id] = l.defaultOn;
    if (l.defaultOn) groups[l.id].addTo(map);
  }

  // ---------- 스타일 ----------
  const urbanStyle = (p) => {
    const c = layerCfg.urban.stageColors[p.stage] || '#1a9c9c';
    return { color: c, weight: 1, fillColor: c, fillOpacity: 0.42, opacity: 0.8 };
  };
  const lineStyle = (p) => {
    const s = layerCfg.transport.modeStyles[p.mode] || { color: '#333', weight: 3 };
    return { color: s.color, weight: s.weight, dashArray: s.dashArray, opacity: 0.95, lineCap: 'round' };
  };
  const landuseStyle = (p) => {
    const s = layerCfg.landuse.typeStyles[p.type] || { color: '#999' };
    return { color: s.color, weight: 1.5, fillColor: s.color, fillOpacity: 0.55, dashArray: '4 3' };
  };

  // ---------- 팝업 ----------
  const devPopup = (p) => `
    <div class="popup-cat">${escapeHtml(p.category || '')}</div>
    <div class="popup-title">${escapeHtml(p.name)}</div>
    <div class="popup-year">${p.year}년</div>
    <p class="popup-desc">${escapeHtml(p.desc || '')}</p>`;
  const linePopup = (p) => `
    <div class="popup-cat">${escapeHtml(layerCfg.transport.modeStyles[p.mode]?.label || '교통')}</div>
    <div class="popup-title">${escapeHtml(p.name)}</div>
    <div class="popup-year">${p.yearStart}년 개통</div>
    <p class="popup-desc">${escapeHtml(p.note || '')}</p>
    <p class="popup-desc small">※ 주요 지점을 연결한 개략 노선</p>`;
  const areaPopup = (p, kind) => `
    <div class="popup-cat">${kind === 'urban' ? '시가지 확장 (데모)' : escapeHtml(layerCfg.landuse.typeStyles[p.type]?.label || '') + ' (데모)'}</div>
    <div class="popup-title">${escapeHtml(p.name)}</div>
    <div class="popup-year">${p.yearStart}년${p.yearEnd ? ` ~ ${p.yearEnd}년` : ' ~'}</div>
    ${p.note ? `<p class="popup-desc">${escapeHtml(p.note)}</p>` : ''}
    <p class="popup-desc small">※ 교육용 개략 형상으로 실제 경계가 아닙니다.</p>`;
  const photoPopup = (list) => {
    const first = list[0];
    const items = list.map((ph) => `
      <button class="popup-photo-item" data-photo-id="${ph.id}" title="클릭하여 확대">
        <img src="${escapeHtml(ph.thumb || ph.src)}" alt="${escapeHtml(ph.title)}" loading="lazy">
        <span><b>${escapeHtml(ph.title)}</b><small>${escapeHtml(ph.date?.label || ph.period?.label || '시기 미상')}</small></span>
      </button>`).join('');
    return `
      <div class="popup-cat">역사 사진 ${list.length > 1 ? `${list.length}건` : ''}</div>
      <div class="popup-title">${escapeHtml(first.location?.label || first.place)}</div>
      <div class="popup-photo-list">${items}</div>
      <p class="popup-desc small">※ ${escapeHtml(first.location?.note || '')}</p>`;
  };

  el.addEventListener('click', (e) => {
    const t = e.target.closest('[data-photo-id]');
    if (t && opts.onPhotoOpen) opts.onPhotoOpen(t.dataset.photoId);
  });

  // ---------- 렌더링 (연도 기준 필터: 자료가 있는 피처만 표시, 보간 없음) ----------
  function isActive(layerId, p, year) {
    if (layerId === 'developments') return p.year <= year;
    const start = p.yearStart ?? -Infinity;
    const end = p.yearEnd ?? Infinity;
    return start <= year && year <= end;
  }

  function makeLayer(layerId, ft, year) {
    const p = ft.properties;
    if (layerId === 'developments') {
      const [lng, lat] = ft.geometry.coordinates;
      const icon = L.divIcon({ className: '', html: `<div class="gs-marker gs-fade-in">${iconSvg('map-pin', 14)}</div>`, iconSize: [28, 28], iconAnchor: [14, 14], popupAnchor: [0, -12] });
      return L.marker([lat, lng], { icon, title: p.name, riseOnHover: true }).bindPopup(devPopup(p), { maxWidth: 280 });
    }
    const style = layerId === 'urban' ? urbanStyle(p) : layerId === 'transport' ? lineStyle(p) : landuseStyle(p);
    const pane = layerId === 'urban' ? `gs-urban-${p.stage}` : `gs-${layerId}`;
    const layer = L.geoJSON(ft, { pane, style: () => ({ ...style, className: 'gs-fade-in' }) });
    layer.bindPopup(layerId === 'transport' ? linePopup(p) : areaPopup(p, layerId), { maxWidth: 280 });
    if (layerId === 'transport') layer.bindTooltip(`${p.name} (${p.yearStart})`, { sticky: true });
    else layer.bindTooltip(p.name, { sticky: true, opacity: 0.9 });
    return layer;
  }

  function renderLayer(layerId, year) {
    const fc = data.geo[layerId];
    if (!fc) return;
    const map_ = rendered[layerId];
    const group = groups[layerId];
    const want = new Set();
    for (const ft of fc.features) {
      const id = ft.properties.id;
      if (!isActive(layerId, ft.properties, year)) continue;
      want.add(id);
      if (!map_.has(id)) {
        const lyr = makeLayer(layerId, ft, year);
        map_.set(id, lyr);
        group.addLayer(lyr);
      }
    }
    for (const [id, lyr] of map_) {
      if (!want.has(id)) { group.removeLayer(lyr); map_.delete(id); }
    }
    // 최근 개발 지점 강조
    if (layerId === 'developments') {
      for (const [id, lyr] of map_) {
        const y = data.featureIndex[id].year;
        lyr.getElement()?.firstElementChild?.classList.toggle('is-new', year - y <= 2);
      }
    }
  }

  const photoMarkers = new Map();
  function renderPhotos(year) {
    const group = groups.photos;
    if (!group) return;
    const era = data.getEra(year);
    // 위치가 확인된 사진만, 같은 좌표의 사진은 하나의 마커로 묶음
    const groupsByKey = new Map();
    for (const p of data.photosForEra(era)) {
      const c = p.location?.coords;
      if (!p.mapLinked || !Array.isArray(c)) continue;
      const key = `${era.id}@${c[0]},${c[1]}`;
      if (!groupsByKey.has(key)) groupsByKey.set(key, []);
      groupsByKey.get(key).push(p);
    }
    for (const [key, list] of groupsByKey) {
      if (photoMarkers.has(key)) continue;
      const badge = list.length > 1 ? `<span class="gs-marker-count">${list.length}</span>` : '';
      const icon = L.divIcon({ className: '', html: `<div class="gs-marker photo gs-fade-in">${iconSvg('camera', 14)}${badge}</div>`, iconSize: [26, 26], iconAnchor: [13, 13], popupAnchor: [0, -12] });
      const m = L.marker(list[0].location.coords, { icon, title: list.map((p) => p.title).join(', '), zIndexOffset: 500 })
        .bindPopup(photoPopup(list), { maxWidth: 280, minWidth: 250 });
      m.photoIds = list.map((p) => p.id);
      photoMarkers.set(key, m);
      group.addLayer(m);
    }
    for (const [key, m] of photoMarkers) {
      if (!groupsByKey.has(key)) { group.removeLayer(m); photoMarkers.delete(key); }
    }
  }
  const markerForPhoto = (id) => [...photoMarkers.values()].find((m) => m.photoIds.includes(id));

  function setYear(year) {
    currentYear = year;
    for (const l of data.region.layers) {
      if (l.kind === 'photos') renderPhotos(year);
      else renderLayer(l.id, year);
    }
  }

  function setBasemap(id) {
    const b = BASEMAPS[id] || BASEMAPS.light;
    if (baseLayer) map.removeLayer(baseLayer);
    const base = L.tileLayer(b.url, b.options);
    // 라벨 레이어는 공간 레이어 위(pane: gs-labels)에 올려 가독성 확보
    baseLayer = b.labels
      ? L.layerGroup([base, L.tileLayer(b.labels, { ...b.options, attribution: '', pane: 'gs-labels' })])
      : base;
    baseLayer.addTo(map);
  }

  function setLayerVisible(id, on) {
    visible[id] = on;
    const g = groups[id];
    if (!g) return;
    if (on) { g.addTo(map); if (currentYear != null && id === 'developments') renderLayer(id, currentYear); }
    else map.removeLayer(g);
  }

  /** 피처 또는 사진으로 지도 이동 + 팝업 */
  function focus(target) {
    let lyr = null;
    if (target.photoId) {
      lyr = markerForPhoto(target.photoId);
      if (!visible.photos) setLayerVisible('photos', true);
    } else if (target.featureId) {
      const info = data.featureIndex[target.featureId];
      if (info) {
        if (!visible[info.layerId]) { setLayerVisible(info.layerId, true); opts.onLayerAutoOn?.(info.layerId); }
        lyr = rendered[info.layerId]?.get(target.featureId);
      }
    }
    const zoomTo = () => { if (lyr) lyr.openPopup?.(); };
    if (target.center) {
      map.flyTo(target.center, target.zoom ?? map.getZoom(), { duration: 0.8 });
      map.once('moveend', zoomTo);
    } else if (lyr?.getBounds) {
      map.flyToBounds(lyr.getBounds(), { padding: [60, 60], maxZoom: 14, duration: 0.8 });
      map.once('moveend', zoomTo);
    } else if (lyr?.getLatLng) {
      map.flyTo(lyr.getLatLng(), Math.max(map.getZoom(), 14), { duration: 0.8 });
      map.once('moveend', zoomTo);
    }
    if (lyr?.getElement) {
      const elx = lyr.getElement()?.firstElementChild;
      if (elx) { elx.classList.add('is-focus'); setTimeout(() => elx.classList.remove('is-focus'), 2500); }
    } else if (lyr?.eachLayer) {
      lyr.eachLayer((sub) => {
        const path = sub.getElement?.();
        if (path) { path.classList.remove('gs-pulse'); void path.getBBox?.(); path.classList.add('gs-pulse'); }
      });
    }
  }

  return {
    map, setYear, setBasemap, setLayerVisible, focus,
    get year() { return currentYear; },
    invalidate() { map.invalidateSize(); },
    destroy() { map.remove(); }
  };
}


// ===== js/timeline.js =====
// 하단 타임라인: 슬라이더, 주요 연도 마커, 재생/속도, 이전·다음 시점

const BASE_STEP_MS = 900; // 1× 속도에서 1년당 시간

function initTimeline(store, getData) {
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


// ===== js/sidebar.js =====
// 왼쪽 사이드바: 지역 정보, 탐구 주제, 주요 시점, 레이어, 사진 자료


function initSidebar(store, getData) {
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


// ===== js/stats-chart.js =====
// 통계 그래프 (Chart.js). 조사 연도 값만 점으로 표시하며, 현재 연도는 세로선으로 표시합니다.
const yearLine = {
  id: 'gsYearLine',
  afterDatasetsDraw(chart, _args, opts) {
    if (opts.year == null) return;
    const { ctx, chartArea, scales } = chart;
    const x = scales.x.getPixelForValue(opts.year);
    if (x < chartArea.left || x > chartArea.right) return;
    ctx.save();
    ctx.strokeStyle = '#0f9488';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(x, chartArea.top); ctx.lineTo(x, chartArea.bottom); ctx.stroke();
    ctx.restore();
  }
};

function createStatsChart(canvas, series, range) {
  if (!window.Chart) return null;
  const pts = series.data.map((d) => ({ x: d.year, y: d.value }));
  const chart = new window.Chart(canvas, {
    type: 'line',
    data: {
      datasets: [{
        label: series.label, data: pts, borderColor: '#12385a', backgroundColor: 'rgba(20,184,166,.12)', fill: true,
        tension: 0.25, pointRadius: 3, pointBackgroundColor: '#12385a', pointHoverRadius: 6, borderWidth: 2
      }]
    },
    plugins: [yearLine],
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 250 },
      scales: {
        x: { type: 'linear', min: range.start, max: range.end, ticks: { stepSize: 10, callback: (v) => v, font: { size: 10 } }, grid: { display: false } },
        y: { ticks: { font: { size: 10 } }, grid: { color: '#eef2f5' } }
      },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { title: (it) => `${it[0].raw.x}년 조사`, label: (it) => `${it.raw.y.toLocaleString()} ${series.unit}` } },
        gsYearLine: { year: null }
      }
    }
  });

  return {
    setYear(year) {
      // 현재 연도 이하의 가장 최근 조사값 강조 (보간하지 않음)
      let idx = -1;
      pts.forEach((p, i) => { if (p.x <= year) idx = i; });
      const ds = chart.data.datasets[0];
      ds.pointRadius = pts.map((_, i) => (i === idx ? 6 : 3));
      ds.pointBackgroundColor = pts.map((_, i) => (i === idx ? '#14b8a6' : '#12385a'));
      chart.options.plugins.gsYearLine.year = year;
      chart.update('none');
      return idx >= 0 ? series.data[idx] : null;
    },
    destroy() { chart.destroy(); }
  };
}


// ===== js/info-panel.js =====
// 오른쪽 정보 패널: 선택 연도의 시대 정보·사례·사진·통계·탐구 질문·출처


function initInfoPanel(store, getData, { onPhotoOpen, onOpenGallery }) {
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
    chart = series ? createStatsChart($('#statsCanvas', root), series, data.region.timeRange) : null;
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
    if (era.id !== currentEraId) { currentEraId = era.id; renderEra(era, year); }
    updateYear(year);
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


// ===== js/modal.js =====
// 모달 공통 동작: 열기/닫기, 배경 클릭·Esc 닫기, 포커스 복귀
const stack = [];

function openModal(id) {
  const m = document.getElementById(id);
  if (!m || !m.hidden) return;
  stack.push({ id, returnFocus: document.activeElement });
  m.hidden = false;
  (m.querySelector('[data-close]') || m).focus?.();
}

function closeModal(id) {
  const m = document.getElementById(id);
  if (!m || m.hidden) return;
  m.hidden = true;
  const i = stack.findIndex((s) => s.id === id);
  if (i >= 0) { stack[i].returnFocus?.focus?.(); stack.splice(i, 1); }
}

function initModals() {
  document.querySelectorAll('.modal').forEach((m) => {
    m.addEventListener('click', (e) => {
      if (e.target === m || e.target.closest('[data-close]')) closeModal(m.id);
    });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && stack.length) closeModal(stack[stack.length - 1].id);
  });
}


// ===== js/gallery.js =====
// 사진 갤러리 + 확대 보기(라이트박스)
// - 지도 연결 사진: 위치가 확인된 사진 (지도 마커와 연결)
// - 지역 갤러리   : 촬영 위치를 확인할 수 없는 사진 (임의 좌표를 부여하지 않음)
// - 이용 조건 미확인: 정식 콘텐츠로 등록하지 않은 후보 (이미지 없이 목록만)
// - 추가 확보 필요 : 아직 사진이 없는 주제


const CERTAINTY = { day: '촬영일 확인', month: '촬영 월 확인', year: '촬영 연도만 확인', approx: '촬영 시기 추정', unknown: '촬영 시기 미확인' };

function initGallery(store, getData, { onLocate }) {
  const filtersEl = $('#galleryFilters');
  const body = $('#galleryBody');
  let filter = 'all';
  let lbList = [];
  let lbIndex = 0;

  const thumb = (p) => `
    <button class="photo-thumb" data-photo-id="${p.id}" title="${escapeHtml(p.title)}">
      <img src="${escapeHtml(p.thumb || p.src)}" alt="${escapeHtml(p.title)}" loading="lazy">
      ${p.mapLinked ? '<span class="pt-pin" title="지도 연결"><i data-lucide="map-pin"></i></span>' : ''}
      <span class="pt-cap">${escapeHtml(p.title)}<small>${escapeHtml(p.date?.label || p.period?.label || '시기 미상')} · ${escapeHtml(p.place)}</small></span>
    </button>`;

  function filtered() {
    const data = getData();
    const byYear = (a, b) => (a.date?.iso || '').localeCompare(b.date?.iso || '');
    let list = data.photos;
    if (filter === 'unlocated') list = list.filter((p) => !p.mapLinked);
    else if (filter !== 'all') {
      const era = data.eras.find((e) => e.id === filter);
      if (era) list = data.photosForEra(era);
    }
    return list.slice().sort(byYear);
  }

  function renderGallery() {
    const data = getData();
    const counts = Object.fromEntries(data.eras.map((e) => [e.id, data.photosForEra(e).length]));
    filtersEl.innerHTML = [['all', `전체 ${data.photos.length}`], ...data.eras.map((e) => [e.id, `${e.id.replace('s', '년대')} ${counts[e.id]}`]), ['unlocated', '위치 미확인']]
      .map(([id, label]) => `<button class="filter-btn ${filter === id ? 'is-active' : ''}" data-filter="${id}">${label}</button>`).join('');

    const list = filtered();
    const located = list.filter((p) => p.mapLinked);
    const unlocated = list.filter((p) => !p.mapLinked);
    lbList = [...located, ...unlocated].map((p) => p.id);

    const era = data.eras.find((e) => e.id === filter);
    const needed = (era ? data.neededForEra(era) : data.photoInfo.needed);
    const unverified = data.photoInfo.unverified;

    body.innerHTML = `
      <p class="callout callout-info" style="margin-bottom:14px"><i data-lucide="shield-check"></i><span>모든 사진은 Wikimedia Commons에서 <b>이용 조건(CC BY · 공공누리 제1유형 · 퍼블릭 도메인)을 확인한 실제 역사 사진</b>입니다. 사진을 사용할 때는 확대 보기의 출처·라이선스 표기를 함께 밝혀 주세요.</span></p>
      <section class="gallery-section">
        <h3><i data-lucide="map-pin"></i>지도 연결 사진 <span class="muted small">(${located.length})</span></h3>
        <p>사진 속 시설의 위치가 확인되어 지도에 마커로 표시되는 사진입니다. 마커 위치는 피사체(시설) 위치이며 촬영 지점은 아닙니다.</p>
        ${located.length ? `<div class="gallery-grid">${located.map(thumb).join('')}</div>` : '<div class="empty">해당 사진이 없습니다.</div>'}
      </section>
      <section class="gallery-section">
        <h3><i data-lucide="folder-open"></i>지역 갤러리 (위치 미확인) <span class="muted small">(${unlocated.length})</span></h3>
        <p>거리 풍경·항공사진 등 정확한 촬영 위치를 확인할 수 없어 임의로 좌표를 지정하지 않은 사진입니다.</p>
        ${unlocated.length ? `<div class="gallery-grid">${unlocated.map(thumb).join('')}</div>` : '<div class="empty">해당 사진이 없습니다.</div>'}
      </section>
      <section class="gallery-section">
        <h3><i data-lucide="shield-question"></i>이용 조건 미확인 (별도 분류) <span class="muted small">(${unverified.length})</span></h3>
        <p>저작권·이용 조건을 확인하지 못한 후보는 정식 콘텐츠로 등록하지 않고 여기에 목록만 둡니다.</p>
        ${unverified.length ? `<ul class="plain-list">${unverified.map((u) => `<li><b>${escapeHtml(u.label)}</b> (${u.year}) – ${escapeHtml(u.reason || u.status)}</li>`).join('')}</ul>` : '<div class="empty">현재 수집 목록 55건은 모두 이용 조건이 확인되었습니다.</div>'}
      </section>
      <section class="gallery-section">
        <h3><i data-lucide="search"></i>추가 확보가 필요한 사진 <span class="muted small">(${needed.length})</span></h3>
        <p>아직 사진이 없는 주제입니다. 실제 사진을 확보하기 전까지 임의의 이미지를 사용하지 않습니다.</p>
        ${needed.length ? `<ul class="plain-list">${needed.map((n) => `<li><b>${escapeHtml(n.eraId.replace('s', '년대'))} · ${escapeHtml(n.topic)}</b> <span class="muted">(${escapeHtml(n.place)})</span><br><small>${escapeHtml(n.why)} · 후보 출처: ${escapeHtml(n.suggestedSources.join(', '))}</small></li>`).join('')}</ul>` : '<div class="empty">없음</div>'}
      </section>`;
    refreshIcons();
  }

  function openGallery(initialFilter) {
    if (initialFilter) filter = initialFilter;
    renderGallery();
    openModal('galleryModal');
  }

  // ---------- 라이트박스 ----------
  function renderLightbox() {
    const data = getData();
    const p = data.photos.find((x) => x.id === lbList[lbIndex]);
    if (!p) return;
    const img = $('#lbImg');
    img.src = p.src; img.alt = p.title;
    $('#lbType').textContent = data.photoInfo.contentTypes[p.contentType] || p.contentType;
    const loc = p.location || {};
    const precision = data.photoInfo.locationPrecision[loc.precision] || '';
    const notes = p.verification?.notes || [];
    $('#lbMeta').innerHTML = `
      <h3>${escapeHtml(p.title)}</h3>
      <p class="lb-sub">${escapeHtml(p.date?.label || '')} · ${escapeHtml(p.place)}</p>

      <div class="lb-geo"><b><i data-lucide="map"></i>지리적 변화 읽기</b><p>${escapeHtml(p.geography || '')}</p></div>

      <dl>
        <dt>촬영 시기</dt><dd>${escapeHtml(p.date?.label || '시기 미상')} <span class="muted small">(${CERTAINTY[p.date?.certainty] || '미확인'} · ${escapeHtml(p.date?.basis || '')} 기준)</span></dd>
        <dt>촬영 장소</dt><dd>${escapeHtml(p.place)}</dd>
        <dt>지도 위치</dt><dd>${loc.coords ? `${escapeHtml(loc.label)}<br><span class="muted small">${escapeHtml(precision)}</span>` : `<span class="muted">${escapeHtml(loc.note || '위치 미확인')}</span>`}</dd>
        <dt>자료 설명</dt><dd>${escapeHtml(p.description)}</dd>
        <dt>주제</dt><dd>${escapeHtml(p.theme || '')}</dd>
        <dt>저작자</dt><dd>${escapeHtml(p.source?.author || '')}</dd>
        <dt>원 출처</dt><dd>${escapeHtml(p.source?.credit || '—')}</dd>
        <dt>파일 출처</dt><dd>${p.source?.commonsPage ? `<a href="${escapeHtml(p.source.commonsPage)}" target="_blank" rel="noopener">Wikimedia Commons 파일 페이지</a>` : '—'}</dd>
        <dt>이용 조건</dt><dd>${p.license?.url ? `<a href="${escapeHtml(p.license.url)}" target="_blank" rel="noopener">${escapeHtml(p.license.nameKo || p.license.name)}</a>` : escapeHtml(p.license?.nameKo || '')}</dd>
        <dt>출처 표기</dt><dd class="small">${escapeHtml(p.attribution || '')}</dd>
      </dl>
      ${notes.length ? `<div class="lb-notes"><b>검증 메모</b><ul>${notes.map((n) => `<li>${escapeHtml(n)}</li>`).join('')}</ul></div>` : ''}
      <div class="lb-actions">
        ${p.mapLinked ? `<button class="btn btn-primary" id="lbLocate"><i data-lucide="locate-fixed"></i>지도에서 위치 보기</button>` : ''}
        <button class="btn" disabled title="같은 장소의 현재 사진을 확보하면 활성화됩니다"><i data-lucide="columns-2"></i>과거·현재 사진 비교 (예정)</button>
      </div>
      <p class="small muted" style="margin-top:10px">${lbIndex + 1} / ${lbList.length}</p>`;
    $('#lbPrev').disabled = lbIndex <= 0;
    $('#lbNext').disabled = lbIndex >= lbList.length - 1;
    $('#lbLocate')?.addEventListener('click', () => {
      closeModal('lightbox'); closeModal('galleryModal');
      onLocate(p);
    });
    refreshIcons();
  }

  function openPhoto(id, list) {
    lbList = list?.length ? list : getData().photos.map((p) => p.id);
    if (!lbList.includes(id)) lbList = [id, ...lbList];
    lbIndex = lbList.indexOf(id);
    renderLightbox();
    openModal('lightbox');
  }
  const move = (d) => {
    const n = lbIndex + d;
    if (n >= 0 && n < lbList.length) { lbIndex = n; renderLightbox(); }
  };

  filtersEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-filter]');
    if (b) { filter = b.dataset.filter; renderGallery(); }
  });
  body.addEventListener('click', (e) => {
    const t = e.target.closest('[data-photo-id]');
    if (t) openPhoto(t.dataset.photoId, lbList);
  });
  $('#lbPrev').addEventListener('click', () => move(-1));
  $('#lbNext').addEventListener('click', () => move(1));
  document.addEventListener('keydown', (e) => {
    if ($('#lightbox').hidden) return;
    if (e.key === 'ArrowLeft') move(-1);
    if (e.key === 'ArrowRight') move(1);
  });

  return { openGallery, openPhoto };
}


// ===== js/compare.js =====
// 과거·현재 비교 모드: 두 지도의 범위·확대 수준 동기화 + 변화 해설


function initCompare(store, getData, { onPhotoOpen }) {
  const wrap = $('#compare');
  const leftSel = $('#compareLeftYear');
  const rightSel = $('#compareRightYear');
  const commentary = $('#compareCommentary');
  let left = null, right = null;
  let syncing = false;

  function fillSelects() {
    const data = getData();
    const years = data.keyYears();
    const opts = years.map((y) => `<option value="${y}">${y}년</option>`).join('');
    leftSel.innerHTML = opts; rightSel.innerHTML = opts;
    leftSel.value = years[0];
    rightSel.value = years[years.length - 1];
  }

  function sync(from, to) {
    from.map.on('move', () => {
      if (syncing) return;
      syncing = true;
      to.map.setView(from.map.getCenter(), from.map.getZoom(), { animate: false });
      syncing = false;
    });
  }

  function ensureMaps() {
    if (left) return;
    const data = getData();
    const s = store.get();
    left = createMapView($('#mapLeft'), data, { onPhotoOpen, compact: true });
    right = createMapView($('#mapRight'), data, { onPhotoOpen, compact: true });
    for (const v of [left, right]) {
      v.setBasemap(s.basemap);
      Object.entries(s.layers).forEach(([id, on]) => v.setLayerVisible(id, on));
    }
    sync(left, right); sync(right, left);
  }

  function popAt(data, year) {
    const series = data.stats[0];
    if (!series) return null;
    let d = null;
    series.data.forEach((x) => { if (x.year <= year) d = x; });
    return d ? { ...d, unit: series.unit, label: series.label } : null;
  }

  function renderCommentary() {
    const data = getData();
    const ly = +leftSel.value, ry = +rightSel.value;
    const le = data.getEra(ly), re = data.getEra(ry);
    const lp = popAt(data, ly), rp = popAt(data, ry);
    const count = (y) => data.geo.urban?.features.filter((f) => f.properties.yearStart <= y).length ?? 0;
    const newDev = data.geo.developments?.features.filter((f) => f.properties.year > ly && f.properties.year <= ry) ?? [];

    let diff = '';
    if (lp && rp) {
      const delta = rp.value - lp.value;
      diff += `<b>${escapeHtml(lp.label)}</b> ${lp.value.toLocaleString()}${lp.unit}(${lp.year}) → ${rp.value.toLocaleString()}${rp.unit}(${rp.year}), <b>${delta >= 0 ? '+' : ''}${delta.toLocaleString()}${rp.unit}</b>. `;
    }
    diff += `시가지 확장 구역(데모) ${count(ly)}개 → ${count(ry)}개. `;
    if (newDev.length) diff += `그 사이 주요 개발: ${newDev.map((f) => escapeHtml(f.properties.name)).join(', ')}.`;

    commentary.innerHTML = `
      <div><h4>${ly}년 · ${escapeHtml(le.title)}</h4><ul>${le.features.map((f) => `<li>${escapeHtml(f)}</li>`).join('')}</ul></div>
      <div class="compare-arrow"><i data-lucide="arrow-right"></i></div>
      <div><h4>${ry}년 · ${escapeHtml(re.title)}</h4><ul>${re.features.map((f) => `<li>${escapeHtml(f)}</li>`).join('')}</ul></div>
      <div class="compare-diff"><b>변화 해설</b> · ${diff}${ly >= ry ? ' <span class="muted">(왼쪽에 더 이른 연도를 선택하면 변화를 읽기 쉽습니다.)</span>' : ''}</div>`;
    refreshIcons();
  }

  function update() {
    left.setYear(+leftSel.value);
    right.setYear(+rightSel.value);
    renderCommentary();
  }

  function show() {
    wrap.hidden = false;
    ensureMaps();
    requestAnimationFrame(() => {
      left.invalidate(); right.invalidate();
      const main = store.get().mainView;
      if (main) left.map.setView(main.getCenter(), main.getZoom(), { animate: false });
      update();
    });
  }
  function hide() { wrap.hidden = true; }

  leftSel.addEventListener('change', update);
  rightSel.addEventListener('change', update);

  store.subscribe((s, prev, changed) => {
    if (changed.includes('mode')) s.mode === 'compare' ? show() : hide();
    if (left && (changed.includes('layers') || changed.includes('basemap'))) {
      for (const v of [left, right]) {
        if (changed.includes('basemap')) v.setBasemap(s.basemap);
        if (changed.includes('layers')) Object.entries(s.layers).forEach(([id, on]) => v.setLayerVisible(id, on));
      }
    }
  });

  return {
    reset() { left?.destroy(); right?.destroy(); left = right = null; fillSelects(); },
    fillSelects,
    invalidate() { left?.invalidate(); right?.invalidate(); }
  };
}


// ===== js/main.js =====
// GeoScape 진입점: 데이터 로드 → 상태 저장소 → 각 UI 모듈 연결










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


})();
