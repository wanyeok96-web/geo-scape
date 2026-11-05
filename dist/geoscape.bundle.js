/* GeoScape standalone bundle – 자동 생성 파일입니다. 직접 수정하지 말고 scripts/build-standalone.mjs 를 실행하세요. */
(function () {
'use strict';
var __GEOSCAPE_BUNDLED = true;

// ===== js/utils.js =====
const { $, $$, escapeHtml, refreshIcons, iconSvg, DATA_STATUS, statusBadge, storage, notify, installImageFallback, debounce } = (function () {
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

// ---------- 알림(토스트): 오류·상태를 화면을 막지 않고 알려 줌 ----------
const recentNotices = new Map();
function notify(message, { type = 'info', timeout = 6000, key } = {}) {
  const k = key || message;
  const now = Date.now();
  if (recentNotices.has(k) && now - recentNotices.get(k) < 8000) return; // 같은 알림 반복 방지
  recentNotices.set(k, now);
  let box = document.getElementById('toastBox');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toastBox';
    box.className = 'toast-box';
    box.setAttribute('role', 'status');
    box.setAttribute('aria-live', 'polite');
    document.body.appendChild(box);
  }
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `<span>${escapeHtml(message)}</span><button aria-label="닫기">×</button>`;
  const close = () => el.remove();
  el.querySelector('button').addEventListener('click', close);
  box.appendChild(el);
  while (box.children.length > 3) box.firstElementChild.remove();
  if (timeout) setTimeout(close, timeout);
}

// ---------- 이미지 로드 실패 시 깨진 아이콘 대신 안내 표시 ----------
function installImageFallback() {
  document.addEventListener('error', (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || img.dataset.failed) return;
    if (img.closest('.leaflet-tile-container')) return; // 지도 타일은 map-view에서 처리
    img.dataset.failed = '1';
    img.classList.add('img-failed');
    img.removeAttribute('src');
    img.alt = `이미지를 불러오지 못했습니다${img.alt ? ` (${img.alt})` : ''}`;
    img.parentElement?.classList.add('has-failed-img');
  }, true);
}

/** 짧은 시간에 반복 호출되는 함수를 마지막 호출만 실행 */
function debounce(fn, ms = 150) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

return { $, $$, escapeHtml, refreshIcons, iconSvg, DATA_STATUS, statusBadge, storage, notify, installImageFallback, debounce };
})();

// ===== js/store.js =====
const { createStore } = (function () {
// 간단한 전역 상태 저장소 (구독형)
// - normalize: 상태가 바뀔 때마다 값을 정리(예: 연도 범위 제한)
// - 구독자 하나에서 오류가 나도 나머지 구독자는 계속 실행되도록 격리
function createStore(initial, { normalize, onError } = {}) {
  let state = { ...initial };
  const listeners = new Set();
  let depth = 0;
  return {
    get: () => state,
    set(patch) {
      const prev = state;
      let next = { ...state, ...patch };
      if (normalize) next = normalize(next, prev);
      state = next;
      const changed = Object.keys(state).filter((k) => prev[k] !== state[k]);
      if (!changed.length) return;
      if (++depth > 20) { depth--; console.error('[GeoScape] 상태 갱신이 반복되어 중단했습니다.', patch); return; }
      try {
        for (const fn of [...listeners]) {
          try { fn(state, prev, changed); } catch (err) { onError ? onError(err) : console.error(err); }
        }
      } finally { depth--; }
    },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  };
}

return { createStore };
})();

// ===== js/data.js =====
const { loadJson, loadRegistry, loadRegion } = (function () {
// 데이터 로더: 지역 레지스트리 → 지역별 JSON/GeoJSON 묶음
//
// 안정성 원칙
// - 꼭 필요한 파일(지역 설정·시대 정보)이 없을 때만 실패로 처리하고,
//   사진·통계·출처·공간 레이어는 하나가 실패해도 나머지로 계속 실행합니다.
// - 모든 항목을 검사해 형식이 잘못된 항목은 건너뛰고 경고(warnings)로 모읍니다.
const FETCH_TIMEOUT_MS = 15000;

async function fetchJson(url) {
  // 더블클릭(file://) 실행: dist/geoscape-data.js 에 담긴 데이터 사용
  const embedded = window.GEOSCAPE_EMBEDDED?.[url];
  if (embedded) return JSON.parse(JSON.stringify(embedded));
  if (location.protocol === 'file:') throw new Error(`${url}: 내장 데이터에 없음 (node scripts/build-standalone.mjs 로 번들을 다시 만드세요)`);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { cache: 'no-cache', signal: ctrl.signal });
    if (!res.ok) throw new Error(`${url} 불러오기 실패 (HTTP ${res.status})`);
    try { return await res.json(); } catch { throw new Error(`${url}: JSON 형식 오류`); }
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`${url}: 응답 시간 초과 (${FETCH_TIMEOUT_MS / 1000}초)`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** 시뮬레이터 등 다른 모듈에서 JSON 불러오기 (내장 데이터·시간 제한 동일 적용) */
const loadJson = (url) => fetchJson(url);

function loadRegistry() {
  return fetchJson('data/regions.json').then((r) => {
    if (!Array.isArray(r?.regions) || !r.regions.length) throw new Error('data/regions.json: 지역 목록이 비어 있음');
    return r;
  });
}

// ---------- 검사 도우미 ----------
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isLatLng = (c) => Array.isArray(c) && c.length === 2 && isNum(c[0]) && isNum(c[1]) && Math.abs(c[0]) <= 90 && Math.abs(c[1]) <= 180;
const arr = (v) => (Array.isArray(v) ? v : []);

function sanitizeRegion(region, warn) {
  if (!region?.map || !isLatLng(region.map.center)) throw new Error('region.json: map.center 가 올바르지 않음');
  const tr = region.timeRange || {};
  if (!isNum(tr.start) || !isNum(tr.end) || tr.start >= tr.end) throw new Error('region.json: timeRange 가 올바르지 않음');
  region.info = { summary: '', facts: [], ...region.info, facts: arr(region.info?.facts) };
  region.topics = arr(region.topics).filter((t) => t?.id && t?.title).map((t) => ({ ...t, layers: arr(t.layers) }));
  region.milestones = arr(region.milestones).filter((m) => {
    const ok = isNum(m?.year) && m.year >= tr.start && m.year <= tr.end && m.label;
    if (!ok) warn(`주요 시점 제외: ${JSON.stringify(m)?.slice(0, 60)}`);
    return ok;
  }).sort((a, b) => a.year - b.year);
  region.layers = arr(region.layers).filter((l) => l?.id && l?.kind);
  region.files = { eras: 'eras.json', photos: 'data/photos.json', stats: 'stats.json', sources: 'sources.json', ...region.files };
  return region;
}

function sanitizeEras(eras, warn) {
  const list = arr(eras?.eras).filter((e) => {
    const ok = e?.id && isNum(e.start) && isNum(e.end) && e.start <= e.end;
    if (!ok) warn(`시대 정보 제외: ${e?.id ?? '(id 없음)'}`);
    return ok;
  }).map((e) => ({
    title: '', summary: '', background: '', ...e,
    features: arr(e.features), cases: arr(e.cases).filter((c) => c?.title), questions: arr(e.questions), sourceIds: arr(e.sourceIds)
  })).sort((a, b) => a.start - b.start);
  if (!list.length) throw new Error('eras.json: 사용할 수 있는 시대 정보가 없음');
  return list;
}

function sanitizeFeatures(fc, layerId, warn) {
  const seen = new Set();
  const features = arr(fc?.features).filter((ft) => {
    const id = ft?.properties?.id;
    const ok = id && ft.geometry?.type && Array.isArray(ft.geometry.coordinates) && !seen.has(id);
    if (!ok) warn(`레이어 '${layerId}' 피처 제외: ${id ?? '(id 없음)'}`);
    else seen.add(id);
    return ok;
  });
  return { type: 'FeatureCollection', metadata: fc?.metadata || {}, features };
}

function sanitizePhotos(list, regionId, warn) {
  const seen = new Set();
  return arr(list).filter((p) => (p?.region ?? regionId) === regionId).filter((p) => {
    const ok = p?.id && p.src && p.title && !seen.has(p.id);
    if (!ok) warn(`사진 제외: ${p?.id ?? p?.title ?? '(id 없음)'}`);
    else seen.add(p.id);
    return ok;
  }).map((p) => {
    const loc = p.location || {};
    const coords = isLatLng(loc.coords) ? loc.coords : null;
    if (loc.coords && !coords) warn(`사진 ${p.id}: 좌표 형식 오류로 지도 연결 해제`);
    return {
      ...p,
      eraIds: arr(p.eraIds),
      location: { precision: coords ? loc.precision || 'subject-facility' : 'none', label: loc.label || p.place || '', note: loc.note || '', coords },
      mapLinked: Boolean(p.mapLinked && coords),
      source: p.source || {}, license: p.license || {}, verification: { notes: [], ...p.verification }
    };
  });
}

/**
 * 시뮬레이터용 지하철 자료(sim/subway.json) → 탐구 화면용 피처
 * 같은 노선·같은 개통일의 구간을 하나의 피처로 묶음 (id: 'L2-1984-05-22')
 */
function subwayToFeatures(raw) {
  if (!raw || !Array.isArray(raw.lines)) return null;
  const features = [];
  for (const line of raw.lines) {
    const byDate = new Map();
    for (const s of line.segments || []) {
      if (!byDate.has(s.open)) byDate.set(s.open, []);
      byDate.get(s.open).push(s.coords);
    }
    for (const [date, parts] of byDate) {
      const ev = (raw.events || []).find((e) => e.line === line.id && e.date === date && e.kind === 'section');
      features.push({
        type: 'Feature',
        properties: {
          id: `${line.id}-${date}`, name: `${line.name} ${ev ? ev.sections.join(', ') : ''}`.trim(),
          line: line.id, lineName: line.name, color: line.color, openDate: date, yearStart: Number(date.slice(0, 4)),
          sections: ev ? ev.sections : []
        },
        geometry: { type: 'MultiLineString', coordinates: parts }
      });
    }
  }
  return { type: 'FeatureCollection', metadata: { notice: '실제 선로 선형(OpenStreetMap)과 구간 개통일(한국어 위키백과 노선 문서)로 만든 노선망입니다.', sources: raw.sources }, features };
}

/** 지역 데이터 전체를 불러와 서로 연결된 하나의 객체로 반환 */
async function loadRegion(meta) {
  const warnings = [];
  const warn = (m) => { warnings.push(m); console.warn('[GeoScape 데이터]', m); };
  const base = meta.path;
  // 'data/'로 시작하면 프로젝트 루트 기준(여러 지역 공용 파일), 아니면 지역 폴더 기준
  const resolve = (p) => (p.startsWith('data/') ? p : base + p);
  // 선택 파일: 실패해도 기본값으로 계속
  const optional = (url, fallback, label) => fetchJson(url).catch((err) => { warn(`${label} 불러오기 실패 – ${err.message}`); return fallback; });

  const region = sanitizeRegion(await fetchJson(base + 'region.json'), warn);
  const f = region.files;
  const [erasRaw, photosFile, stats, sources] = await Promise.all([
    fetchJson(resolve(f.eras)),
    optional(resolve(f.photos), { photos: [] }, '사진 자료'),
    optional(resolve(f.stats), { series: [] }, '통계 자료'),
    optional(resolve(f.sources), { sources: [] }, '출처 목록')
  ]);
  const eraList = sanitizeEras(erasRaw, warn);
  const photoList = sanitizePhotos(photosFile?.photos, meta.id, warn);

  const geo = {};
  const grids = {};
  await Promise.all(region.layers.filter((l) => l.file).map(async (l) => {
    const raw = await optional(base + l.file, null, `공간 레이어 '${l.label || l.id}'`);
    if (l.kind === 'urban-grid') {
      // 위성 실측 도시화 격자 (GHSL) – 피처가 아니라 격자 자료 그대로 사용
      if (raw?.grid && Array.isArray(raw.cells) && Array.isArray(raw.epochs)) grids[l.id] = raw;
      else if (raw) warn(`공간 레이어 '${l.label || l.id}': 격자 자료 형식 오류`);
      return;
    }
    const fc = l.kind === 'subway' ? subwayToFeatures(raw) : raw;
    geo[l.id] = sanitizeFeatures(fc, l.id, warn);
  }));

  // 피처 ID 색인 (설명 패널·주요 시점에서 지도 피처로 연결)
  const featureIndex = {};
  for (const [layerId, fc] of Object.entries(geo)) {
    for (const ft of fc.features) {
      const p = ft.properties;
      featureIndex[p.id] = { layerId, feature: ft, year: p.yearStart ?? p.year ?? null };
    }
  }
  // 연결 검사: 시대 사례·주요 시점이 가리키는 피처가 실제로 있는지
  for (const e of eraList) for (const c of e.cases) {
    if (c.featureId && !featureIndex[c.featureId]) { warn(`${e.id} 사례 '${c.title}': 지도 피처 '${c.featureId}' 없음 → 지도 연결 해제`); delete c.featureId; }
  }
  for (const m of region.milestones) {
    if (m.focus?.featureId && !featureIndex[m.focus.featureId]) { warn(`주요 시점 ${m.year}: 피처 '${m.focus.featureId}' 없음`); delete m.focus.featureId; }
  }

  const sourceMap = Object.fromEntries(arr(sources?.sources).filter((s) => s?.id).map((s) => [s.id, s]));
  const statSeries = arr(stats?.series).filter((s) => s?.label && arr(s.data).length)
    .map((s) => ({ unit: '', note: '', ...s, data: arr(s.data).filter((d) => isNum(d?.year) && isNum(d?.value)).sort((a, b) => a.year - b.year) }));

  return {
    meta, region, geo, grids, featureIndex, warnings,
    /** 위성 관측 연도 중 해당 연도 이하의 가장 최근 값 (없으면 null) */
    gridEpoch(layerId, year) {
      const g = grids[layerId];
      if (!g) return null;
      let e = null;
      for (const ep of g.epochs) if (ep <= year) e = ep;
      return e;
    },
    /** 격자 전체의 건물 피복 면적(km²) */
    gridBuiltArea(layerId, epoch) {
      const g = grids[layerId];
      if (!g || epoch == null) return null;
      const k = g.epochs.indexOf(epoch);
      const gg = g.grid;
      const area = (gg.dlat * 111.32) * (gg.dlon * 111.32 * Math.cos((gg.lat0 - gg.rows * gg.dlat / 2) * Math.PI / 180));
      return g.cells.reduce((s, c) => s + c[2 + k], 0) / 100 * area;
    },
    eras: eraList,
    photos: photoList,
    photoInfo: {
      notice: photosFile?.description || '',
      contentTypes: photosFile?.contentTypes || {},
      locationPrecision: photosFile?.locationPrecision || {},
      unverified: arr(photosFile?.unverified),
      needed: arr(photosFile?.needed)
    },
    stats: statSeries,
    sources: sourceMap,

    clampYear(y) {
      const { start, end } = region.timeRange;
      const n = Math.round(Number(y));
      return Number.isFinite(n) ? Math.min(end, Math.max(start, n)) : start;
    },
    getEra(year) {
      return eraList.find((e) => year >= e.start && year <= e.end) ?? (year < eraList[0].start ? eraList[0] : eraList[eraList.length - 1]);
    },
    /** 해당 시기(시대 범위)와 촬영 시기가 겹치는 사진 */
    photosForEra(era) {
      return photoList.filter((p) => p.eraIds.includes(era.id) ||
        (isNum(p.period?.start) && p.period.start <= era.end && (p.period.end ?? p.period.start) >= era.start));
    },
    /** 선택 연도 기준: 같은 시대 사진을 촬영 연도가 가까운 순으로 */
    photosNearYear(year) {
      const era = this.getEra(year);
      return this.photosForEra(era)
        .map((p, i) => ({ p, i, d: isNum(p.year) ? Math.abs(p.year - year) : 99 }))
        .sort((a, b) => a.d - b.d || a.i - b.i)
        .map((x) => x.p);
    },
    neededForEra(era) {
      return arr(photosFile?.needed).filter((n) => n.eraId === era.id);
    },
    /** 주요 시점 연도 목록 (시대 시작 + 마일스톤 + 끝 연도) */
    keyYears() {
      const ys = new Set([...eraList.map((e) => e.start), ...region.milestones.map((m) => m.year), region.timeRange.end]);
      return [...ys].filter((y) => y >= region.timeRange.start && y <= region.timeRange.end).sort((a, b) => a - b);
    }
  };
}

return { loadJson, loadRegistry, loadRegion };
})();

// ===== js/map-view.js =====
const { TILE_PROVIDERS, BASEMAPS, markProviderFailed, createMapView } = (function () {
// 지도 뷰: Leaflet 지도 + 연도별 공간 레이어 렌더링
// 같은 함수를 메인 지도와 비교 모드 지도에서 재사용합니다.

// ---------- 배경 지도 타일 제공자 ----------
// API 키가 필요 없고 한국 지역 데이터가 있는 제공자만 사용합니다.
// OSM 공식 서버는 Referer가 없는 요청(index.html 더블클릭 = file://)을 차단(403)하므로,
// 실행 전 '시험 타일'을 요청해 차단·실패가 확인되면 다음 제공자로 자동 전환합니다.
const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const TILE_PROVIDERS = {
  osm: { name: 'OpenStreetMap', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', maxZoom: 19, attribution: OSM_ATTR, needsReferer: true },
  osmde: { name: 'OpenStreetMap Deutschland', url: 'https://tile.openstreetmap.de/{z}/{x}/{y}.png', maxZoom: 18, attribution: OSM_ATTR + ' · Tiles: openstreetmap.de' },
  hot: { name: 'Humanitarian OSM', url: 'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png', subdomains: 'abc', maxZoom: 19, attribution: OSM_ATTR + ' · Tiles: HOT / OSM France' },
  esriImagery: { name: 'Esri World Imagery', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', maxZoom: 18, attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics' }
};
const PROBE_TILE = { z: 11, x: 1746, y: 792 }; // 서울 도심이 포함된 타일

const BASEMAPS = {
  // 대체 서버 순서: OSM Deutschland(HTTP/2로 여러 타일을 한 연결에서 받아 브라우저 실측이 가장 빠름) → HOT
  light: { label: '밝은 지도', providers: ['osm', 'osmde', 'hot'], className: 'gs-muted-tiles' },
  osm: { label: '일반 지도', providers: ['osm', 'osmde', 'hot'] },
  imagery: { label: '위성(현재)', providers: ['esriImagery'] }
};

const tileUrl = (p, t) => p.url.replace('{s}', (p.subdomains || 'a')[0]).replace('{z}', t.z).replace('{x}', t.x).replace('{y}', t.y).replace('{r}', '');

// 제공자별 사용 가능 여부 캐시 (모든 지도 뷰가 공유)
const providerHealth = {};
function probeProvider(id) {
  if (providerHealth[id]) return providerHealth[id];
  const p = TILE_PROVIDERS[id];
  // file:// 에서는 Referer가 없으므로 Referer가 필요한 제공자는 바로 제외
  if (p.needsReferer && location.protocol === 'file:') return (providerHealth[id] = Promise.resolve(false));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  providerHealth[id] = fetch(tileUrl(p, PROBE_TILE), { mode: 'cors', signal: ctrl.signal, referrerPolicy: 'strict-origin-when-cross-origin' })
    .then((r) => r.ok && (r.headers.get('content-type') || '').startsWith('image'))
    // CORS를 허용하지 않는 서버는 판별할 수 없으므로 '사용 가능'으로 간주 (실제 타일 오류는 tileerror로 감시)
    .catch((e) => (e.name === 'AbortError' ? false : true))
    .finally(() => clearTimeout(timer));
  return providerHealth[id];
}
const failedProviders = new Set();
function markProviderFailed(id) { failedProviders.add(id); providerHealth[id] = Promise.resolve(false); }
// 지금 바로 써 볼 수 있는 제공자 (file:// 에서 Referer 필요 서버, 이미 실패한 서버 제외)
const usableNow = (pid) => !failedProviders.has(pid) && !(TILE_PROVIDERS[pid].needsReferer && location.protocol === 'file:');

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

  // 레이어 순서용 pane: 도시화 격자 → 토지 이용 → 도로 → 지하철 (위로 갈수록 나중)
  map.createPane('gs-grid').style.zIndex = 405;
  map.createPane('gs-landuse').style.zIndex = 415;
  map.createPane('gs-transport').style.zIndex = 420;
  map.createPane('gs-subway').style.zIndex = 425;
  const labelsPane = map.createPane('gs-labels');
  labelsPane.style.zIndex = 430;
  labelsPane.style.pointerEvents = 'none';

  // 나타남 효과(물결)용 pane: 공간 레이어 위, 마커 아래, 클릭 통과
  const fxPane = map.createPane('gs-fx');
  fxPane.style.zIndex = 450;
  fxPane.style.pointerEvents = 'none';

  // ---------- 나타남·사라짐 애니메이션 ----------
  const LEAVE_MS = 450;
  const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let initialized = false; // 첫 화면에서는 물결 효과를 생략 (한꺼번에 퍼지지 않도록)
  const leaving = new Map(); // key → { lyr, timer }

  // 레이어의 실제 DOM 요소 (SVG path 또는 마커 아이콘)
  function elementsOf(lyr) {
    const out = [];
    const push = (l) => { const el = l.getElement?.(); if (el) out.push(l instanceof L.Marker ? el.firstElementChild || el : el); };
    if (lyr.eachLayer) lyr.eachLayer(push); else push(lyr);
    return out;
  }
  // 선: 처음부터 끝까지 그려지는 효과 (점선 스타일은 페이드만)
  function drawOn(lyr) {
    if (reducedMotion()) return;
    lyr.eachLayer?.((sub) => {
      const el = sub.getElement?.();
      if (!el || sub.options.dashArray || !el.getTotalLength) return;
      const len = Math.ceil(el.getTotalLength());
      if (!len) return;
      el.style.transition = 'none';
      el.style.strokeDasharray = `${len} ${len}`;
      el.style.strokeDashoffset = len;
      el.getBoundingClientRect(); // 시작 상태 확정
      el.style.transition = 'stroke-dashoffset 1.3s cubic-bezier(.3,.6,.2,1)';
      el.style.strokeDashoffset = '0';
      setTimeout(() => { el.style.transition = ''; el.style.strokeDasharray = ''; el.style.strokeDashoffset = ''; }, 1400);
    });
  }
  // 면: 중심에서 퍼지는 물결
  function ripple(latlng, color) {
    if (!initialized || reducedMotion()) return;
    const icon = L.divIcon({ className: '', html: `<div class="gs-ripple" style="--c:${color}"></div>`, iconSize: [24, 24], iconAnchor: [12, 12] });
    const m = L.marker(latlng, { icon, pane: 'gs-fx', interactive: false, keyboard: false }).addTo(map);
    setTimeout(() => map.removeLayer(m), 1500);
  }
  // 사라질 때: 서서히 흐려진 뒤 제거 (되돌아오면 취소하고 재사용)
  function retire(key, lyr, group) {
    const els = elementsOf(lyr);
    if (reducedMotion() || !els.length) { group.removeLayer(lyr); return; }
    els.forEach((el) => el.classList.add('gs-anim-leave'));
    const timer = setTimeout(() => { group.removeLayer(lyr); leaving.delete(key); }, LEAVE_MS);
    leaving.set(key, { lyr, timer });
  }
  function revive(key) {
    const item = leaving.get(key);
    if (!item) return null;
    clearTimeout(item.timer);
    leaving.delete(key);
    elementsOf(item.lyr).forEach((el) => el.classList.remove('gs-anim-leave'));
    return item.lyr;
  }

  let baseLayer = null;
  let currentYear = null;
  let pendingPopup = null;
  let pendingTimer = null;
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
  const subwayStyle = (p) => ({ color: p.color || '#2563eb', weight: 4.5, opacity: 0.95, lineCap: 'round', lineJoin: 'round' });
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
  const subwayPopup = (p) => `
    <div class="popup-cat"><span class="popup-line-dot" style="background:${escapeHtml(p.color)}"></span>${escapeHtml(p.lineName)}</div>
    <div class="popup-title">${escapeHtml((p.sections || []).join(', ') || p.name)}</div>
    <div class="popup-year">${escapeHtml(p.openDate.replace(/-/g, '.'))} 개통</div>
    <p class="popup-desc small">선형: OpenStreetMap · 개통일: 한국어 위키백과 노선 문서</p>`;
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
      const icon = L.divIcon({ className: '', html: `<div class="gs-marker gs-anim-pop">${iconSvg('map-pin', 14)}</div>`, iconSize: [28, 28], iconAnchor: [14, 14], popupAnchor: [0, -12] });
      return L.marker([lat, lng], { icon, title: p.name, riseOnHover: true }).bindPopup(devPopup(p), { maxWidth: 280 });
    }
    const kind = layerCfg[layerId]?.kind;
    const isLine = kind === 'line' || kind === 'subway';
    const style = kind === 'subway' ? subwayStyle(p) : kind === 'line' ? lineStyle(p) : landuseStyle(p);
    let pane = `gs-${layerId}`;
    if (!map.getPane(pane)) pane = 'overlayPane'; // 정의되지 않은 레이어는 기본 pane 사용
    // 면은 중심에서 퍼지듯, 선은 그려지듯 나타남 (선 효과는 지도에 추가된 뒤 drawOn에서 시작)
    const anim = isLine ? (style.dashArray ? 'gs-anim-fade' : '') : 'gs-anim-spread';
    const layer = L.geoJSON(ft, { pane, style: () => ({ ...style, className: anim }) });
    layer.bindPopup(kind === 'subway' ? subwayPopup(p) : kind === 'line' ? linePopup(p) : areaPopup(p, layerId), { maxWidth: 280 });
    if (kind === 'subway') layer.bindTooltip(`${p.lineName} · ${p.openDate.slice(0, 4)}년 개통`, { sticky: true });
    else if (kind === 'line') layer.bindTooltip(`${p.name} (${p.yearStart})`, { sticky: true });
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
        // 사라지는 중이던 피처가 다시 필요해지면 새로 만들지 않고 되살림
        const back = revive(`${layerId}:${id}`);
        if (back) { map_.set(id, back); continue; }
        try {
          const lyr = makeLayer(layerId, ft, year);
          map_.set(id, lyr);
          group.addLayer(lyr);
          const k = layerCfg[layerId]?.kind;
          if (k === 'line' || k === 'subway') drawOn(lyr);
          else if (k === 'landuse') {
            const c = lyr.options?.style?.()?.fillColor || lyr.getLayers?.()[0]?.options?.fillColor || '#14b8a6';
            if (map.hasLayer(group)) ripple(lyr.getBounds().getCenter(), c);
          }
        } catch (err) {
          console.warn(`[GeoScape] 피처 '${id}' 표시 실패`, err);
        }
      }
    }
    for (const [id, lyr] of map_) {
      if (!want.has(id)) { retire(`${layerId}:${id}`, lyr, group); map_.delete(id); }
    }
    // 최근 개발 지점 강조
    if (layerId === 'developments') {
      for (const [id, lyr] of map_) {
        const y = data.featureIndex[id].year;
        lyr.getElement()?.firstElementChild?.classList.toggle('is-new', year - y <= 2);
      }
    }
  }

  // ---------- 위성 실측 도시화 격자 (GHSL): 관측 연도별 이미지를 만들어 교차 전환 ----------
  // 8천여 칸을 도형으로 그리면 느리므로, 관측 연도마다 한 장의 이미지로 그려 지도에 겹칩니다.
  const GRID_STOPS = [[0, [215, 243, 239]], [5, [166, 227, 215]], [15, [93, 202, 165]], [30, [29, 158, 117]], [45, [15, 110, 86]], [60, [8, 80, 65]], [80, [11, 42, 67]]];
  function gridColor(v) {
    let i = 0;
    while (i < GRID_STOPS.length - 2 && v > GRID_STOPS[i + 1][0]) i++;
    const [a, ca] = GRID_STOPS[i], [b, cb] = GRID_STOPS[i + 1];
    const k = Math.max(0, Math.min(1, (v - a) / (b - a)));
    return ca.map((x, j) => Math.round(x + (cb[j] - x) * k));
  }
  const gridAlpha = (v) => (v < 3 ? 0 : Math.min(0.82, 0.18 + v / 60));
  const gridImages = {};  // 'layerId:epoch' → dataURL
  const gridState = {};   // layerId → { epoch, overlay }
  function gridBounds(g) {
    const s = g.grid;
    return L.latLngBounds([s.lat0 - s.rows * s.dlat, s.lon0], [s.lat0, s.lon0 + s.cols * s.dlon]);
  }
  function gridImage(layerId, epoch) {
    const key = layerId + ':' + epoch;
    if (gridImages[key]) return gridImages[key];
    const g = data.grids[layerId], s = g.grid, k = g.epochs.indexOf(epoch);
    const PX = 8, GAP = 1;
    const cv = document.createElement('canvas');
    cv.width = s.cols * PX; cv.height = s.rows * PX;
    const ctx = cv.getContext('2d');
    for (const c of g.cells) {
      const v = c[2 + k];
      const al = gridAlpha(v);
      if (!al) continue;
      const [r, gg, b] = gridColor(v);
      ctx.fillStyle = 'rgba(' + r + ',' + gg + ',' + b + ',' + al + ')';
      ctx.fillRect(c[0] * PX, c[1] * PX, PX - GAP, PX - GAP);
    }
    return (gridImages[key] = cv.toDataURL('image/png'));
  }
  function renderGrid(layerId, year) {
    const g = data.grids[layerId];
    const group = groups[layerId];
    if (!g || !group) return;
    const epoch = data.gridEpoch(layerId, year);
    const st = gridState[layerId] || (gridState[layerId] = { epoch: undefined, overlay: null });
    if (st.epoch === epoch) return;
    st.epoch = epoch;
    const old = st.overlay;
    st.overlay = null;
    if (epoch != null) {
      const ov = L.imageOverlay(gridImage(layerId, epoch), gridBounds(g), { pane: 'gs-grid', className: 'gs-grid-img', opacity: reducedMotion() ? 1 : 0, interactive: false });
      group.addLayer(ov);
      st.overlay = ov;
      if (!reducedMotion()) requestAnimationFrame(() => requestAnimationFrame(() => ov.setOpacity(1)));
    }
    if (old) {
      if (reducedMotion()) group.removeLayer(old);
      else { old.setOpacity(0); setTimeout(() => group.removeLayer(old), 900); }
    }
  }
  // 격자 칸 클릭: 그 칸의 연도별 건물 피복률
  map.on('click', (e) => {
    const t = e.originalEvent && e.originalEvent.target;
    if (t && t.closest && t.closest('.leaflet-interactive, .leaflet-marker-icon, .leaflet-popup')) return;
    for (const l of data.region.layers) {
      if (l.kind !== 'urban-grid' || !visible[l.id] || !data.grids[l.id]) continue;
      const g = data.grids[l.id], s = g.grid;
      const col = Math.floor((e.latlng.lng - s.lon0) / s.dlon), row = Math.floor((s.lat0 - e.latlng.lat) / s.dlat);
      const cell = g.cells.find((c) => c[0] === col && c[1] === row);
      if (!cell) return;
      const cur = data.gridEpoch(l.id, currentYear ?? g.epochs[g.epochs.length - 1]);
      const max = Math.max(...cell.slice(2), 1);
      const bars = g.epochs.map((ep, i) => '<div class="cell-bar' + (ep === cur ? ' on' : '') + '" title="' + ep + '년 ' + cell[2 + i] + '%"><i style="height:' + Math.max(2, cell[2 + i] / max * 40) + 'px"></i><small>' + String(ep).slice(2) + '</small></div>').join('');
      const title = cur == null ? '1975년 이전 자료 없음' : cur + '년 ' + cell[2 + g.epochs.indexOf(cur)] + '%';
      L.popup({ maxWidth: 260 }).setLatLng(e.latlng).setContent(
        '<div class="popup-cat">건물 피복률 (위성 관측)</div><div class="popup-title">' + title + '</div>' +
        '<div class="cell-bars">' + bars + '</div>' +
        '<p class="popup-desc small">약 660 m × 650 m 칸에서 건물이 덮은 면적의 비율 · GHSL (EC JRC)</p>').openOn(map);
      return;
    }
  });

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
      const back = revive(`photo:${key}`);
      if (back) { photoMarkers.set(key, back); continue; }
      const badge = list.length > 1 ? `<span class="gs-marker-count">${list.length}</span>` : '';
      const icon = L.divIcon({ className: '', html: `<div class="gs-marker photo gs-anim-pop">${iconSvg('camera', 14)}${badge}</div>`, iconSize: [26, 26], iconAnchor: [13, 13], popupAnchor: [0, -12] });
      const m = L.marker(list[0].location.coords, { icon, title: list.map((p) => p.title).join(', '), zIndexOffset: 500 })
        .bindPopup(photoPopup(list), { maxWidth: 280, minWidth: 250 });
      m.photoIds = list.map((p) => p.id);
      photoMarkers.set(key, m);
      group.addLayer(m);
    }
    for (const [key, m] of photoMarkers) {
      if (!groupsByKey.has(key)) { retire(`photo:${key}`, m, group); photoMarkers.delete(key); }
    }
  }
  const markerForPhoto = (id) => [...photoMarkers.values()].find((m) => m.photoIds.includes(id));

  function setYear(year) {
    currentYear = year;
    for (const l of data.region.layers) {
      // 한 레이어의 오류가 다른 레이어 표시를 막지 않도록 레이어별로 격리
      try {
        if (l.kind === 'photos') renderPhotos(year);
        else if (l.kind === 'urban-grid') renderGrid(l.id, year);
        else renderLayer(l.id, year);
      } catch (err) {
        console.error(`[GeoScape] 레이어 '${l.id}' 표시 오류`, err);
      }
    }
    initialized = true;
  }

  // ---------- 배경 지도: 사용 가능한 첫 제공자를 고르고, 실패하면 다음 제공자로 ----------
  let basemapToken = 0;
  // 속도: 서버 점검을 기다리지 않고 바로 타일을 그리기 시작하고, 점검은 동시에 진행.
  //       점검에서 차단·장애가 확인되면 그때 다음 서버로 전환합니다.
  async function setBasemap(id) {
    const b = BASEMAPS[id] || BASEMAPS.light;
    const token = ++basemapToken;
    const pid = b.providers.find(usableNow);
    if (!pid) {
      if (baseLayer) { map.removeLayer(baseLayer); baseLayer = null; }
      opts.onBasemapStatus?.({ ok: false, basemap: id });
      return;
    }
    useProvider(id, b, pid);
    const ok = await probeProvider(pid);
    if (token !== basemapToken) return; // 그 사이 다른 배경 지도가 선택됨
    if (!ok) {
      markProviderFailed(pid);
      opts.onBasemapStatus?.({ ok: false, basemap: id, provider: TILE_PROVIDERS[pid].name, switching: true });
      setBasemap(id);
    }
  }

  function useProvider(id, b, pid) {
    const p = TILE_PROVIDERS[pid];
    if (baseLayer) map.removeLayer(baseLayer);
    const layer = L.tileLayer(p.url, {
      subdomains: p.subdomains || 'abc', maxZoom: 19, maxNativeZoom: p.maxZoom,
      attribution: p.attribution, className: b.className || '', crossOrigin: false,
      // 속도: 확대·축소 애니메이션 중간 단계 타일은 요청하지 않고, 화면 밖 여유 타일은 조금 더 보관
      updateWhenZooming: false, keepBuffer: 3
    });
    // 타일 오류가 많이 나면(차단·네트워크 장애) 다음 제공자로 전환
    let errors = 0, loaded = 0;
    layer.on('tileload', () => { loaded++; });
    layer.on('tileerror', () => {
      errors++;
      if (errors >= 6 && errors > loaded) {
        layer.off('tileerror');
        markProviderFailed(pid);
        opts.onBasemapStatus?.({ ok: false, basemap: id, provider: p.name, switching: true });
        setBasemap(id);
      }
    });
    baseLayer = layer.addTo(map);
    baseLayer.bringToBack();
    opts.onBasemapStatus?.({ ok: true, basemap: id, provider: p.name, fallback: pid !== b.providers[0] });
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
    // 이전 이동·팝업 예약을 취소하고 새로 이동 (연속 클릭 시 팝업이 엉키지 않도록)
    map.stop();
    if (pendingPopup) { map.off('moveend', pendingPopup); clearTimeout(pendingTimer); }
    let done = false;
    pendingPopup = () => {
      if (done) return;
      done = true;
      map.off('moveend', pendingPopup);
      clearTimeout(pendingTimer);
      try { if (lyr && map.hasLayer(lyr)) lyr.openPopup?.(); } catch (e) { console.warn(e); }
    };
    const fly = (fn) => { map.on('moveend', pendingPopup); pendingTimer = setTimeout(pendingPopup, 2500); fn(); };
    if (target.center) fly(() => map.flyTo(target.center, target.zoom ?? map.getZoom(), { duration: 0.8 }));
    else if (lyr?.getBounds) fly(() => map.flyToBounds(lyr.getBounds(), { padding: [60, 60], maxZoom: 14, duration: 0.8 }));
    else if (lyr?.getLatLng) fly(() => map.flyTo(lyr.getLatLng(), Math.max(map.getZoom(), 14), { duration: 0.8 }));
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

return { TILE_PROVIDERS, BASEMAPS, markProviderFailed, createMapView };
})();

// ===== js/timeline.js =====
const { initTimeline } = (function () {
// 하단 타임라인: 슬라이더, 주요 연도 마커, 재생/속도, 이전·다음 시점

const BASE_STEP_MS = 900; // 1× 속도에서 1년당 시간
const GLIDE_MS = 420;      // 클릭으로 연도를 옮길 때 막대가 미끄러지는 시간
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

function initTimeline(store, getData) {
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
    window.dispatchEvent(new CustomEvent('gs:timepos', { detail: v })); // 시뮬레이터가 연속 시간으로 사용
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

return { initTimeline };
})();

// ===== js/sidebar.js =====
const { initSidebar } = (function () {
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

return { initSidebar };
})();

// ===== js/stats-chart.js =====
const { createStatsChart } = (function () {
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

return { createStatsChart };
})();

// ===== js/info-panel.js =====
const { initInfoPanel } = (function () {
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
      if (box.dataset.key === `empty:${era.id}`) return;
      box.dataset.key = `empty:${era.id}`;
      const need = data.neededForEra(era);
      box.innerHTML = `<div class="empty">이 시기에는 이용 조건이 확인된 실제 사진이 아직 없습니다.<br>임의의 이미지는 사용하지 않습니다.</div>
        ${need.length ? `<div class="needed-list"><b>추가 확보가 필요한 사진</b><ul>${need.map((n) => `<li>${escapeHtml(n.topic)} <small>(${escapeHtml(n.place)})</small></li>`).join('')}</ul></div>` : ''}`;
      return;
    }
    const exactCount = list.filter((p) => p.year === year).length;
    // 속도: 보여 줄 사진·표시가 같으면 다시 그리지 않음 (재생 중 이미지 깜빡임 방지)
    const key = `${year}:${list.slice(0, MAX_STRIP).map((p) => p.id + (p.year === year ? '*' : '')).join(',')}:${list.length}`;
    const shownKey = key.slice(key.indexOf(':') + 1);
    if (box.dataset.key === shownKey) {
      const hint = $('.photo-hint', box);
      if (hint) hint.innerHTML = exactCount ? `<b>${year}년</b>에 촬영된 사진 ${exactCount}건` : `${year}년 촬영 사진은 없어 가까운 연도 순으로 표시`;
      return;
    }
    box.dataset.key = shownKey;
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
        <p class="callout" style="margin-top:10px"><i data-lucide="info"></i><span>설명 문안은 공개 자료를 바탕으로 작성된 교육용 요약입니다. 도시화(위성 실측)·지하철(실제 선형) 레이어와 역사 사진은 출처가 확인된 자료이고, 도로·개발 지점은 개략, 토지 이용은 데모 자료입니다.</span></p>
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

return { initInfoPanel };
})();

// ===== js/modal.js =====
const { openModal, closeModal, initModals } = (function () {
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

return { openModal, closeModal, initModals };
})();

// ===== js/gallery.js =====
const { initGallery } = (function () {
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
    // 이전 사진의 로드 실패 표시 초기화
    delete img.dataset.failed;
    img.classList.remove('img-failed');
    img.parentElement.classList.remove('has-failed-img');
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

return { initGallery };
})();

// ===== js/compare.js =====
const { initCompare } = (function () {
// 과거·현재 비교 모드: 두 지도의 범위·확대 수준 동기화 + 변화 해설


function initCompare(store, getData, { onPhotoOpen, onBasemapStatus }) {
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
    // 배경 지도 알림은 왼쪽 지도에서만 (중복 알림 방지)
    left = createMapView($('#mapLeft'), data, { onPhotoOpen, compact: true, onBasemapStatus });
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
    const builtText = (y) => {
      const ep = data.gridEpoch('urban', y);
      return ep == null ? '자료 없음' : `약 ${Math.round(data.gridBuiltArea('urban', ep)).toLocaleString()} km²(${ep})`;
    };
    const linesOpen = (y) => new Set((data.geo.subway?.features || []).filter((f) => f.properties.yearStart <= y).map((f) => f.properties.line)).size;
    const newDev = data.geo.developments?.features.filter((f) => f.properties.year > ly && f.properties.year <= ry) ?? [];

    let diff = '';
    if (lp && rp) {
      const delta = rp.value - lp.value;
      diff += `<b>${escapeHtml(lp.label)}</b> ${lp.value.toLocaleString()}${lp.unit}(${lp.year}) → ${rp.value.toLocaleString()}${rp.unit}(${rp.year}), <b>${delta >= 0 ? '+' : ''}${delta.toLocaleString()}${rp.unit}</b>. `;
    }
    diff += `건물 피복 면적(위성 관측) ${builtText(ly)} → ${builtText(ry)}. 지하철 노선 ${linesOpen(ly)}개 → ${linesOpen(ry)}개. `;
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

return { initCompare };
})();

// ===== js/simulator.js =====
const { initSimulator } = (function () {
// 서울 공간 구조 시뮬레이터 (MapLibre GL)
// - 기존 탐구 화면(Leaflet)과 별도 화면으로, 헤더의 '시뮬레이터' 버튼으로 오갑니다.
// - 하단 타임라인(연도·재생)을 탐구 화면과 함께 씁니다.
// - 자료 원칙: 도시화 격자는 5년 간격 관측값(GHSL)만, 지하철은 실제 구간 개통일에만 나타남. 연도 사이 값은 만들지 않음.
//   (관측값이 바뀔 때의 전환 효과, 개통 구간이 그려지는 효과는 '움직임'일 뿐 자료가 아님)


const LIB = { js: 'vendor/maplibre/maplibre-gl.js', css: 'vendor/maplibre/maplibre-gl.css' };
const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';
const KR_FONT = "'Pretendard Variable', Pretendard, 'Malgun Gothic', 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif";
const TWEEN_MS = 900;      // 도시화 관측값이 바뀔 때 전환 시간
const GROW_MS = 1100;      // 개통 구간이 그려지는 시간
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// 'YYYY-MM-DD' → 소수 연도 (예: 1984-05-22 → 1984.39)
function decYear(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const start = Date.UTC(y, 0, 1), end = Date.UTC(y + 1, 0, 1);
  return y + (Date.UTC(y, (m || 1) - 1, d || 1) - start) / (end - start);
}
const fmtDate = (iso) => iso.replace(/-/g, '.');
const km = (a, b) => {
  const x = (b[0] - a[0]) * Math.PI / 180 * Math.cos((a[1] + b[1]) / 2 * Math.PI / 180);
  const y = (b[1] - a[1]) * Math.PI / 180;
  return 6371 * Math.hypot(x, y);
};

function loadAsset(tag, attrs) {
  return new Promise((resolve, reject) => {
    const el = document.createElement(tag);
    Object.assign(el, attrs);
    el.onload = resolve;
    el.onerror = () => reject(new Error(`${attrs.src || attrs.href} 불러오기 실패`));
    document.head.appendChild(el);
  });
}
let libPromise = null;
function loadMapLibre() {
  if (window.maplibregl) return Promise.resolve();
  libPromise ??= Promise.all([
    loadAsset('link', { rel: 'stylesheet', href: LIB.css }),
    loadAsset('script', { src: LIB.js })
  ]);
  return libPromise;
}

function initSimulator(store, getData) {
  const root = $('#simulator');
  let map = null, ready = false, loading = null;
  let sim = null;          // 시뮬레이터 자료
  let t = store.get().year; // 현재 시각 (소수 연도)
  const layerOn = { urban: true, subway: true, labels: true, threeD: false };

  // ---------- 화면 골격 ----------
  root.innerHTML = `
    <div class="sim-map" id="simMap" aria-label="시뮬레이터 지도"></div>
    <div class="sim-hud sim-title">
      <div class="sim-kicker"><i data-lucide="orbit"></i>공간 구조 시뮬레이터</div>
      <div class="sim-year" id="simYear">${t}</div>
      <div class="sim-sub" id="simEpoch">자료 불러오는 중…</div>
    </div>
    <div class="sim-hud sim-controls">
      <label class="sim-toggle"><input type="checkbox" data-sim-layer="urban" checked><span class="sim-swatch sim-sw-urban"></span>도시화 격자</label>
      <label class="sim-toggle"><input type="checkbox" data-sim-layer="subway" checked><span class="sim-swatch sim-sw-subway"></span>지하철 노선</label>
      <label class="sim-toggle"><input type="checkbox" data-sim-layer="labels" checked><span class="sim-swatch sim-sw-label"></span>역 이름</label>
      <label class="sim-toggle"><input type="checkbox" data-sim-layer="threeD"><span class="sim-swatch sim-sw-3d"></span>3D 보기</label>
      <div class="sim-legend">
        <div class="sim-legend-title">건물이 덮은 면적 비율</div>
        <div class="sim-legend-bar"></div>
        <div class="sim-legend-scale"><span>5%</span><span>30%</span><span>60%+</span></div>
      </div>
      <details class="sim-sources"><summary>자료 출처</summary><div id="simSources"></div></details>
    </div>
    <div class="sim-hud sim-stats">
      <div class="sim-stat"><span>건물 피복 면적</span><b id="simBuilt">–</b></div>
      <svg class="sim-spark" id="simSpark" viewBox="0 0 200 44" aria-label="연도별 건물 피복 면적"></svg>
      <div class="sim-stat-row">
        <div class="sim-stat"><span>운행 노선</span><b id="simLines">0</b></div>
        <div class="sim-stat"><span>노선 길이</span><b id="simKm">0</b></div>
        <div class="sim-stat"><span>역</span><b id="simStations">0</b></div>
      </div>
      <div class="sim-feed-title">개통 소식</div>
      <ol class="sim-feed" id="simFeed"><li class="sim-feed-empty">아직 지하철이 없습니다.</li></ol>
    </div>
    <div class="sim-headline" id="simHeadline" aria-live="polite"></div>
    <div class="sim-loading" id="simLoading"><div class="spinner"></div><span>시뮬레이터 준비 중…</span></div>`;
  refreshIcons();

  // ---------- 자료 준비 ----------
  async function prepare() {
    const cfg = getData().region.simulator;
    if (!cfg) throw new Error('이 지역에는 시뮬레이터 자료가 없습니다.');
    const base = getData().meta.path;
    const [grid, subway] = await Promise.all([loadJson(base + cfg.urbanGrid), loadJson(base + cfg.subway)]);

    // 도시화 격자 → 사각형 칸 (칸 사이 틈을 조금 두어 타일처럼 보이게)
    const g = grid.grid, gap = 0.08;
    const cellArea = (g.dlat * 111.32) * (g.dlon * 111.32 * Math.cos((g.lat0 - g.rows * g.dlat / 2) * Math.PI / 180)); // km²
    const features = grid.cells.map((c, i) => {
      const x0 = g.lon0 + c[0] * g.dlon + g.dlon * gap / 2, x1 = x0 + g.dlon * (1 - gap);
      const y0 = g.lat0 - c[1] * g.dlat - g.dlat * gap / 2, y1 = y0 - g.dlat * (1 - gap);
      const props = {};
      grid.epochs.forEach((y, k) => { props['p' + y] = c[2 + k]; });
      return { type: 'Feature', id: i, properties: props, geometry: { type: 'Polygon', coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] } };
    });
    const builtByEpoch = grid.epochs.map((y, k) => grid.cells.reduce((s, c) => s + c[2 + k], 0) / 100 * cellArea);

    // 지하철: 구간별 개통 시각(소수 연도)과 길이
    const segments = [], stations = [];
    for (const line of subway.lines) {
      for (const s of line.segments) {
        const len = s.coords.slice(1).reduce((acc, p, i) => acc + km(s.coords[i], p), 0);
        segments.push({ id: segments.length, line: line.id, name: line.name, color: line.color, open: decYear(s.open), coords: s.coords, len });
      }
      for (const st of line.stations) stations.push({ name: st.name, line: line.id, color: line.color, open: decYear(st.open), coord: st.coord });
    }
    const events = subway.events.map((e) => ({ ...e, at: decYear(e.date) }));
    $('#simSources', root).innerHTML = `
      <p><b>도시화 격자</b> · ${escapeHtml(grid.source)} · ${escapeHtml(grid.license)}<br><small>${escapeHtml(grid.processing)}</small></p>
      ${subway.sources.map((s) => `<p><b>지하철</b> · <a href="${escapeHtml(s.url)}" target="_blank" rel="noopener">${escapeHtml(s.title)}</a> · ${escapeHtml(s.license)}</p>`).join('')}
      <p><b>배경 지도</b> · OpenFreeMap · © OpenMapTiles · © OpenStreetMap contributors</p>
      <p><small>${subway.notes.map(escapeHtml).join('<br>')}</small></p>`;
    sim = { grid, epochs: grid.epochs, cells: { type: 'FeatureCollection', features }, builtByEpoch, segments, stations, events };
    drawSpark();
  }

  // ---------- 지도 ----------
  async function createMap() {
    await loadMapLibre();
    const ml = window.maplibregl;
    let style = STYLE_URL;
    try {
      const r = await fetch(STYLE_URL, { cache: 'force-cache' });
      if (!r.ok) throw new Error(r.status);
      style = await r.json();
      // 배경 지도 이름을 한국어로 (없으면 기본 이름) – 지도를 만들기 전에 스타일에서 바꿔 첫 화면부터 적용
      for (const l of style.layers) {
        if (l.type === 'symbol' && l.layout?.['text-field']) l.layout['text-field'] = ['coalesce', ['get', 'name:ko'], ['get', 'name']];
      }
    } catch {
      notify('배경 지도를 불러오지 못해 배경 없이 표시합니다. 인터넷 연결을 확인하세요.', { type: 'warn' });
      style = { version: 8, glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf', sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#eef2f4' } }] };
    }
    map = new ml.Map({
      container: $('#simMap', root), style,
      center: [126.99, 37.55], zoom: window.innerWidth < 700 ? 9.3 : 10.1, minZoom: 8.5, maxZoom: 15.5,
      maxBounds: [[126.2, 36.9], [127.8, 38.15]], pitch: 0, bearing: 0,
      attributionControl: { compact: true, customAttribution: 'GHSL © European Commission JRC (CC BY 4.0)' },
      localIdeographFontFamily: KR_FONT
    });
    map.addControl(new ml.NavigationControl({ visualizePitch: true }), 'bottom-right');
    await new Promise((res) => map.once('load', res));

    const firstSymbol = map.getStyle().layers.find((l) => l.type === 'symbol')?.id;

    // 도시화 격자 (2D 면 / 3D 기둥)
    map.addSource('urban', { type: 'geojson', data: sim.cells });
    map.addLayer({ id: 'urban-fill', type: 'fill', source: 'urban', paint: { 'fill-opacity': 0 } }, firstSymbol);
    map.addLayer({ id: 'urban-3d', type: 'fill-extrusion', source: 'urban', layout: { visibility: 'none' }, paint: { 'fill-extrusion-opacity': 0.62 } }); // 반투명: 아래 지하철 노선이 비쳐 보이도록

    // 지하철: 개통 구간 / 그려지는 중인 구간 / 역
    const empty = { type: 'FeatureCollection', features: [] };
    map.addSource('sub-open', { type: 'geojson', data: empty });
    map.addSource('sub-grow', { type: 'geojson', data: empty });
    map.addSource('stations', { type: 'geojson', data: { type: 'FeatureCollection', features: sim.stations.map((s, i) => ({ type: 'Feature', id: i, properties: { name: s.name, color: s.color, oy: s.open }, geometry: { type: 'Point', coordinates: s.coord } })) } });
    // MapLibre는 zoom 식을 곱셈 안에 쓸 수 없어 선·빛번짐 두께를 각각 정의
    const lineWidth = ['interpolate', ['linear'], ['zoom'], 9, 2.2, 12, 4.5, 15, 7];
    const glowWidth = ['interpolate', ['linear'], ['zoom'], 9, 7, 12, 14, 15, 22];
    for (const src of ['sub-open', 'sub-grow']) {
      map.addLayer({ id: `${src}-glow`, type: 'line', source: src, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': glowWidth, 'line-opacity': src === 'sub-grow' ? 0.45 : 0.16, 'line-blur': 4 } });
      map.addLayer({ id: `${src}-line`, type: 'line', source: src, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': lineWidth } });
    }
    map.addLayer({ id: 'stations-dot', type: 'circle', source: 'stations', filter: ['<=', ['get', 'oy'], -1], paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 1.6, 12, 3.5, 15, 6], 'circle-color': '#ffffff',
      'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 9, 1, 13, 2] } });
    map.addLayer({ id: 'stations-label', type: 'symbol', source: 'stations', minzoom: 11.3, filter: ['<=', ['get', 'oy'], -1], layout: {
      'text-field': ['get', 'name'], 'text-size': ['interpolate', ['linear'], ['zoom'], 11.3, 10.5, 15, 14], 'text-offset': [0, 0.9], 'text-anchor': 'top',
      'text-font': ['Noto Sans Regular'], 'text-optional': true, 'text-allow-overlap': false },
      paint: { 'text-color': '#13324b', 'text-halo-color': 'rgba(255,255,255,.95)', 'text-halo-width': 1.6 } });

    ready = true;
    applyToggles();
    if (layerOn.threeD) map.jumpTo({ pitch: 55, bearing: -18 }); // 준비 중에 3D를 켠 경우
    update(true);
  }

  // ---------- 도시화: 관측 연도 전환 ----------
  let shownEpoch = undefined;   // 현재 표시 중인 관측 연도 (null = 자료 없음)
  let tween = null;
  const epochFor = (y) => { let e = null; for (const ep of sim.epochs) if (ep <= y) e = ep; return e; };
  function valueExpr(from, to, f) {
    const a = from == null ? 0 : ['get', 'p' + from];
    const b = to == null ? 0 : ['get', 'p' + to];
    return ['+', ['*', a, 1 - f], ['*', b, f]];
  }
  function paintUrban(v) {
    const color = ['interpolate', ['linear'], v, 0, '#d7f3ef', 5, '#a6e3d7', 15, '#5DCAA5', 30, '#1D9E75', 45, '#0F6E56', 60, '#085041', 80, '#0b2a43'];
    map.setPaintProperty('urban-fill', 'fill-color', color);
    map.setPaintProperty('urban-fill', 'fill-opacity', ['interpolate', ['linear'], v, 0, 0, 3, 0.12, 12, 0.5, 40, 0.78]);
    map.setPaintProperty('urban-3d', 'fill-extrusion-color', color);
    map.setPaintProperty('urban-3d', 'fill-extrusion-height', ['*', v, 6]);
  }
  function setEpoch(next) {
    if (next === shownEpoch) return;
    const from = shownEpoch === undefined ? next : shownEpoch;
    shownEpoch = next;
    cancelAnimationFrame(tween?.raf);
    if (reducedMotion() || from === next) { paintUrban(valueExpr(null, next, 1)); return; }
    const t0 = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - t0) / TWEEN_MS);
      const f = 1 - Math.pow(1 - k, 3);
      paintUrban(valueExpr(from, next, f));
      if (k < 1) tween = { raf: requestAnimationFrame(step) };
    };
    tween = { raf: requestAnimationFrame(step) };
  }

  // ---------- 지하철: 개통 구간 그리기 ----------
  let openIds = new Set();
  const growing = new Map(); // id → 시작 시각
  let growRaf = null;
  const feat = (s, coords) => ({ type: 'Feature', properties: { color: s.color, line: s.line }, geometry: { type: 'LineString', coordinates: coords } });
  function partial(coords, frac) {
    const d = coords.slice(1).map((p, i) => km(coords[i], p));
    const total = d.reduce((a, b) => a + b, 0);
    let target = total * frac, out = [coords[0]];
    for (let i = 0; i < d.length; i++) {
      if (target >= d[i]) { out.push(coords[i + 1]); target -= d[i]; continue; }
      const r = d[i] ? target / d[i] : 0, a = coords[i], b = coords[i + 1];
      out.push([a[0] + (b[0] - a[0]) * r, a[1] + (b[1] - a[1]) * r]);
      break;
    }
    return out.length > 1 ? out : [coords[0], coords[0]];
  }
  function renderSubwaySources() {
    const now = performance.now();
    const done = [], grow = [];
    for (const id of openIds) {
      const s = sim.segments[id];
      const st = growing.get(id);
      if (st == null) { done.push(feat(s, s.coords)); continue; }
      const k = Math.min(1, (now - st) / GROW_MS);
      if (k >= 1) { growing.delete(id); done.push(feat(s, s.coords)); }
      else grow.push(feat(s, partial(s.coords, 1 - Math.pow(1 - k, 2))));
    }
    map.getSource('sub-open').setData({ type: 'FeatureCollection', features: done });
    map.getSource('sub-grow').setData({ type: 'FeatureCollection', features: grow });
    if (growing.size) growRaf = requestAnimationFrame(renderSubwaySources);
    else growRaf = null;
  }
  function updateSubway(forward) {
    const next = new Set(sim.segments.filter((s) => s.open <= t).map((s) => s.id));
    let changed = next.size !== openIds.size;
    const now = performance.now();
    for (const id of next) {
      if (!openIds.has(id)) {
        changed = true;
        if (forward && !reducedMotion()) growing.set(id, now);
      }
    }
    for (const id of growing.keys()) if (!next.has(id)) growing.delete(id);
    openIds = next;
    if (changed && !growRaf) renderSubwaySources();
    // 역: 개통 시각 필터 + 새 역 물결
    const filt = ['<=', ['get', 'oy'], t];
    map.setFilter('stations-dot', filt);
    map.setFilter('stations-label', filt);
  }

  // ---------- 새로 개통한 역 물결 + 머리기사 ----------
  let lastT = null;
  function announce(fromT, toT) {
    if (!(toT > fromT)) return;
    const fired = sim.events.filter((e) => e.at > fromT && e.at <= toT);
    if (!fired.length) return;
    const head = $('#simHeadline', root);
    const e = fired[fired.length - 1];
    head.innerHTML = fired.length > 3
      ? `<b>${Math.floor(toT)}년까지</b> 지하철 개통 ${fired.length}건`
      : `<span class="sim-dot" style="background:${e.color}"></span><b>${fmtDate(e.date)}</b> ${escapeHtml(e.name)} ${escapeHtml(e.sections.join(', '))} ${e.kind === 'station' ? '개통' : '구간 개통'}`;
    head.classList.remove('is-on'); void head.offsetWidth; head.classList.add('is-on');
    if (reducedMotion() || fired.length > 6) return;
    const ml = window.maplibregl;
    const newStations = sim.stations.filter((s) => s.open > fromT && s.open <= toT).slice(0, 24);
    for (const s of newStations) {
      const el = document.createElement('div');
      el.className = 'sim-ripple';
      el.style.setProperty('--c', s.color);
      const mk = new ml.Marker({ element: el }).setLngLat(s.coord).addTo(map);
      setTimeout(() => mk.remove(), 1600);
    }
  }

  // ---------- 통계·알림 패널 ----------
  function drawSpark(active) {
    const svg = $('#simSpark', root);
    if (!sim) return;
    const max = Math.max(...sim.builtByEpoch);
    const w = 200 / sim.epochs.length;
    svg.innerHTML = sim.epochs.map((ep, i) => {
      const h = Math.max(2, (sim.builtByEpoch[i] / max) * 34);
      return `<rect x="${i * w + 2}" y="${40 - h}" width="${w - 4}" height="${h}" rx="2" class="${ep === active ? 'on' : ''}"><title>${ep}년 · 약 ${Math.round(sim.builtByEpoch[i])} km²</title></rect>`;
    }).join('') + `<text x="2" y="44" class="sim-spark-l">1975</text><text x="198" y="44" text-anchor="end" class="sim-spark-l">2020</text>`;
  }
  function updateHud() {
    $('#simYear', root).textContent = Math.floor(t);
    const ep = shownEpoch;
    const nextEp = ep == null ? null : sim.epochs.find((e) => e > ep);
    const epText = ep == null ? '1975년 이전: 위성 관측 자료 없음 (지하철만 표시)'
      : Math.floor(t) === ep ? `${ep}년 위성 관측`
      : nextEp ? `${ep}년 위성 관측값 표시 (다음 관측 ${nextEp}년)`
      : `${ep}년 위성 관측값 표시 (가장 최근 관측)`;
    $('#simEpoch', root).textContent = epText;
    $('#simBuilt', root).textContent = ep == null ? '자료 없음' : `약 ${Math.round(sim.builtByEpoch[sim.epochs.indexOf(ep)]).toLocaleString()} km²`;
    drawSpark(ep);
    let len = 0; const lines = new Set();
    for (const id of openIds) { const s = sim.segments[id]; len += s.len; lines.add(s.line); }
    $('#simLines', root).textContent = `${lines.size}개`;
    $('#simKm', root).textContent = `${Math.round(len)} km`;
    $('#simStations', root).textContent = `${new Set(sim.stations.filter((s) => s.open <= t).map((s) => s.name)).size}개`;
    const past = sim.events.filter((e) => e.at <= t).slice(-4).reverse();
    $('#simFeed', root).innerHTML = past.length ? past.map((e) => `
      <li class="${t - e.at < 1 ? 'is-recent' : ''}"><span class="sim-dot" style="background:${e.color}"></span>
        <span><b>${fmtDate(e.date)}</b> ${escapeHtml(e.name)}<br><small>${escapeHtml(e.sections.join(', '))}${e.kind === 'station' ? ' 신설' : ''}</small></span></li>`).join('')
      : '<li class="sim-feed-empty">아직 지하철이 없습니다. (1974년 1호선 개통)</li>';
  }

  // ---------- 갱신 ----------
  function update(force) {
    if (!ready || !sim) return;
    const forward = lastT != null && t > lastT && t - lastT < 3;
    if (lastT != null && !force) announce(lastT, t);
    setEpoch(epochFor(t));
    updateSubway(forward);
    updateHud();
    lastT = t;
  }

  function applyToggles() {
    if (!ready) return;
    const vis = (on) => (on ? 'visible' : 'none');
    map.setLayoutProperty('urban-fill', 'visibility', vis(layerOn.urban && !layerOn.threeD));
    map.setLayoutProperty('urban-3d', 'visibility', vis(layerOn.urban && layerOn.threeD));
    for (const id of ['sub-open-glow', 'sub-open-line', 'sub-grow-glow', 'sub-grow-line', 'stations-dot']) map.setLayoutProperty(id, 'visibility', vis(layerOn.subway));
    map.setLayoutProperty('stations-label', 'visibility', vis(layerOn.subway && layerOn.labels));
  }
  root.addEventListener('change', (e) => {
    const cb = e.target.closest('[data-sim-layer]');
    if (!cb) return;
    layerOn[cb.dataset.simLayer] = cb.checked;
    if (cb.dataset.simLayer === 'threeD' && map) {
      map.easeTo(cb.checked ? { pitch: 55, bearing: -18, duration: 1200 } : { pitch: 0, bearing: 0, duration: 900 });
    }
    applyToggles();
  });

  // 타임라인: 정수 연도(store) + 재생 중 연속 위치(gs:timepos)
  window.addEventListener('gs:timepos', (e) => {
    if (root.hidden) return;
    t = e.detail;
    update();
  });
  store.subscribe((s, prev, changed) => {
    if (!changed.includes('year') || root.hidden) return;
    if (!s.playing && Math.abs(t - s.year) >= 1) { t = s.year; update(); }
  });

  async function ensure() {
    if (ready) return;
    loading ??= (async () => {
      try {
        await prepare();
        await createMap();
      } catch (err) {
        console.error('[GeoScape 시뮬레이터]', err);
        loading = null;
        $('#simLoading', root).innerHTML = `<div class="sim-error"><b>시뮬레이터를 시작하지 못했습니다.</b><br>${escapeHtml(err.message)}<br><small>인터넷 연결을 확인한 뒤 다시 열어 주세요.</small></div>`;
        throw err;
      }
      $('#simLoading', root).remove();
    })();
    return loading;
  }

  return {
    async show() {
      root.hidden = false;
      t = store.get().year;
      try { await ensure(); } catch { return; }
      map.resize();
      lastT = null;
      update(true);
    },
    hide() { root.hidden = true; },
    resize() { if (map && !root.hidden) map.resize(); },
    get map() { return map; } // 점검용
  };
}

return { initSimulator };
})();

// ===== js/main.js =====
(function () {
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

  // ---------- 전역 오류 처리: 예상치 못한 오류도 화면을 멈추지 않고 알림으로 표시 ----------
  window.addEventListener('error', (e) => {
    if (e.target && e.target !== window) return; // 리소스(이미지 등) 오류는 각 모듈에서 처리
    console.error('[GeoScape]', e.error || e.message);
    notify('일시적인 오류가 발생했습니다. 계속 사용할 수 있으며, 문제가 반복되면 새로고침(F5)해 주세요.', { type: 'error', key: 'runtime-error' });
  });
  window.addEventListener('unhandledrejection', (e) => {
    console.error('[GeoScape]', e.reason);
    notify('일부 작업을 완료하지 못했습니다. 문제가 반복되면 새로고침(F5)해 주세요.', { type: 'error', key: 'runtime-error' });
  });
  installImageFallback();

  try { initModals(); } catch (err) { console.error(err); }
  refreshIcons();

  const loading = document.createElement('div');
  loading.className = 'loading';
  loading.innerHTML = '<div class="loading-inner"><div class="spinner"></div><div>자료를 불러오는 중…</div></div>';
  document.body.appendChild(loading);

  let data;
  let registry;
  try {
    registry = await loadRegistry();
    const meta = registry.regions.find((r) => r.id === registry.defaultRegion);
    data = await loadRegion(meta);
  } catch (err) {
    console.error(err);
    loading.remove();
    fatal('데이터를 불러오지 못했습니다', `<p class="muted">${escapeHtml(err.message)}</p>
      <p>인터넷 연결과 파일 위치를 확인한 뒤 새로고침해 주세요. 문제가 계속되면 <b>start-server.bat</b>으로 실행해 보세요.</p>`);
    return;
  }
  loading.remove();
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
  }, {
    // 연도는 항상 자료 범위 안의 정수로 유지
    normalize: (s) => (s.year === getData().clampYear(s.year) ? s : { ...s, year: getData().clampYear(s.year) }),
    onError: (err) => {
      console.error('[GeoScape]', err);
      notify('화면 일부를 갱신하지 못했습니다. 다른 기능은 계속 사용할 수 있습니다.', { type: 'error', key: 'listener-error' });
    }
  });

  // ---------- 지역 선택 ----------
  const regionSel = $('#regionSelect');
  regionSel.innerHTML = registry.regions.map((r) =>
    `<option value="${r.id}" ${r.enabled ? '' : 'disabled'}>${escapeHtml(r.name)}${r.enabled ? '' : ' (준비 중)'}</option>`).join('');
  regionSel.value = data.meta.id;

  // ---------- 지도 ----------
  let mainView = null;
  // 배경 지도 상태 알림 (타일 서버 차단·장애 시 자동 전환)
  function basemapNotice(st) {
    // 더블클릭(file://) 실행: 공식 지도 서버를 쓸 수 없어 느린 대체 서버를 사용 → 빠른 실행 방법 안내 (한 번만)
    if (st.ok && location.protocol === 'file:' && !storage.get('geoscape.fileTip')) {
      storage.set('geoscape.fileTip', '1');
      notify('파일을 직접 열면 배경 지도가 느린 해외 서버로 표시됩니다. 더 빠르게 쓰려면 폴더의 start-server.bat 으로 실행하세요.', { timeout: 12000, key: 'file-tip' });
    }
    if (st.ok && st.fallback && location.protocol !== 'file:') notify(`배경 지도를 ${st.provider} 서버로 표시합니다. (기본 지도 서버에 연결할 수 없어 자동 전환)`, { key: 'basemap-fallback' });
    else if (!st.ok && st.switching) notify(`${st.provider} 배경 지도를 불러오지 못해 다른 서버로 전환합니다.`, { type: 'warn', key: 'basemap-switch-' + st.provider });
    else if (!st.ok) notify('배경 지도를 불러올 수 없습니다. 인터넷 연결을 확인하세요. 시간 변화 레이어와 사진은 계속 사용할 수 있습니다.', { type: 'warn', timeout: 10000, key: 'basemap-fail' });
  }
  const photoOpen = (id, list) => gallery.openPhoto(id, list);
  function createMain() {
    mainView?.destroy();
    mainView = createMapView($('#map'), data, {
      onPhotoOpen: (id) => photoOpen(id, data.photosNearYear(store.get().year).filter((p) => p.mapLinked).map((p) => p.id)),
      onLayerAutoOn: (layerId) => store.set({ layers: { ...store.get().layers, [layerId]: true } }),
      onBasemapStatus: basemapNotice
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
  // 비교 모드는 부가 기능: 초기화에 실패해도 나머지 기능은 동작
  let compare;
  try {
    compare = initCompare(store, getData, { onPhotoOpen: photoOpen, onBasemapStatus: basemapNotice });
  } catch (err) {
    console.error(err);
    compare = { reset() {}, fillSelects() {}, invalidate() {} };
    const btn = $('.seg-btn[data-mode=compare]');
    if (btn) { btn.disabled = true; btn.title = '비교 모드를 시작하지 못했습니다'; }
  }

  // ---------- 범례 ----------
  function renderLegend() {
    const s = store.get();
    const y = s.year;
    const groups = [];
    for (const l of data.region.layers) {
      if (!s.layers[l.id]) continue;
      const fc = data.geo[l.id];
      if (l.kind === 'urban-grid') {
        const ep = data.gridEpoch(l.id, y);
        const area = data.gridBuiltArea(l.id, ep);
        groups.push(`<div class="legend-group"><h4>${escapeHtml(l.label)} ${statusBadge(l.dataStatus)}</h4>
          <div class="legend-grad"></div><div class="legend-scale"><span>5%</span><span>건물이 덮은 면적 비율</span><span>60%+</span></div>
          <div class="legend-row">${ep == null ? '1975년 이전: 위성 관측 자료 없음' : `${ep}년 관측 · 건물 피복 약 ${Math.round(area).toLocaleString()} km²`}</div>
          <div class="legend-row small">칸을 누르면 연도별 값을 볼 수 있습니다</div></div>`);
      } else if (l.kind === 'subway') {
        const open = new Map();
        for (const f of fc?.features || []) if (f.properties.yearStart <= y) open.set(f.properties.line, f.properties);
        groups.push(`<div class="legend-group"><h4>${escapeHtml(l.label)} ${statusBadge(l.dataStatus)}</h4>${open.size
          ? `<div class="legend-lines">${[...open.values()].map((p) => `<span class="legend-line"><i style="background:${p.color}"></i>${escapeHtml(p.lineName)}</span>`).join('')}</div>`
          : '<div class="legend-row">아직 지하철이 없습니다 (1974년 개통)</div>'}</div>`);
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
    // 속도: 내용이 바뀐 경우에만 범례를 다시 그림 (재생 중 매년 전체를 다시 만들지 않음)
    const body = groups.join('');
    if (legend.dataset.body !== body) {
      const wasOpen = legend.querySelector('details')?.open ?? !window.matchMedia('(max-width: 640px)').matches;
      legend.innerHTML = groups.length ? `<details ${wasOpen ? 'open' : ''}><summary></summary>${body}</details>` : '';
      legend.dataset.body = body;
    }
    const summary = legend.querySelector('summary');
    if (summary) summary.textContent = `범례 · ${y}년`;
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
  // ---------- 시뮬레이터 ↔ 탐구 화면 전환 (하단 타임라인은 함께 사용) ----------
  let simulator = null;
  const simBtn = $('#simToggle');
  async function setView(view) {
    const sim = view === 'sim';
    app.classList.toggle('view-sim', sim);
    simBtn.setAttribute('aria-pressed', String(sim));
    simBtn.classList.toggle('is-active', sim);
    simBtn.querySelector('.sim-switch-label').textContent = sim ? '탐구 화면으로' : '시뮬레이터';
    if (sim) {
      if (store.get().mode !== 'explore') store.set({ mode: 'explore' });
      try {
        simulator ??= initSimulator(store, getData);
        window.GeoScape.simulator = simulator;
        await simulator.show();
      } catch (err) {
        console.error(err);
        notify('시뮬레이터를 열지 못했습니다: ' + err.message, { type: 'error' });
      }
    } else {
      simulator?.hide();
      setTimeout(() => mainView?.invalidate(), 60);
    }
  }
  simBtn.addEventListener('click', () => setView(app.classList.contains('view-sim') ? 'explore' : 'sim'));
  window.addEventListener('resize', debounce(() => simulator?.resize(), 200));

  $('#helpBtn').addEventListener('click', () => openModal('helpModal'));
  $('#openGalleryBtn').addEventListener('click', () => gallery.openGallery());
  $('#dataNoticeBtn').addEventListener('click', () => { renderDataModal(); openModal('dataModal'); });

  const afterResize = () => setTimeout(() => { mainView.invalidate(); compare.invalidate(); }, 320);
  $('#sidebarToggle').addEventListener('click', () => { app.classList.toggle('sidebar-collapsed'); afterResize(); });
  $('#panelToggle').addEventListener('click', () => { app.classList.toggle('panel-collapsed'); afterResize(); });
  window.addEventListener('resize', debounce(() => { mainView?.invalidate(); compare.invalidate(); }, 200));

  regionSel.addEventListener('change', async () => {
    const meta = registry.regions.find((r) => r.id === regionSel.value);
    if (!meta?.enabled) return;
    try {
      data = await loadRegion(meta);
      store.set({ year: data.region.timeRange.start, layers: defaultLayers(data), topicId: null, playing: false, mode: 'explore' });
      startRegion();
    } catch (err) {
      console.error(err);
      notify('지역 데이터를 불러오지 못했습니다: ' + err.message, { type: 'error' });
      regionSel.value = data.meta.id;
    }
  });

  function renderDataModal() {
    const rows = data.region.layers.map((l) => {
      const grid = data.grids[l.id];
      const notice = data.geo[l.id]?.metadata?.notice || (grid ? grid.description + ' · ' + grid.source + ' · ' + grid.license : '') || (l.kind === 'photos' ? data.photoInfo.notice : '');
      return `<tr><td><b>${escapeHtml(l.label)}</b></td><td>${statusBadge(l.dataStatus)}</td><td class="muted">${escapeHtml(notice)}</td></tr>`;
    }).join('');
    const stats = data.stats.map((s) => `<tr><td><b>${escapeHtml(s.label)}</b></td><td>${statusBadge(s.verified ? 'verified' : 'approx')}</td><td class="muted">${escapeHtml(s.note)}</td></tr>`).join('');
    $('#dataBody').innerHTML = `
      <p class="muted">GeoScape는 실제 관측 자료와 교육용 데모 자료를 구분해 표시합니다. 자료가 없는 연도에는 값을 보간하거나 공간 분포를 만들어 내지 않습니다.</p>
      <table class="data-table"><thead><tr><th>자료</th><th>상태</th><th>설명</th></tr></thead><tbody>${rows}${stats}</tbody></table>
      ${data.warnings.length ? `<h3 style="margin:18px 0 6px;font-size:14px">자료 점검 결과 (${data.warnings.length}건)</h3>
      <p class="muted small">형식이 맞지 않거나 불러오지 못해 제외한 항목입니다.</p>
      <ul class="plain-list small">${data.warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}</ul>` : ''}
      <h3 style="margin:18px 0 6px;font-size:14px">상태 표시 기준</h3>
      <ul class="source-list">${Object.values(DATA_STATUS).map((d) => `<li><span class="status-badge ${d.className}">${d.label}</span> ${escapeHtml(d.desc)}</li>`).join('')}</ul>
      <h3 style="margin:18px 0 6px;font-size:14px">전체 출처</h3>
      <ul class="source-list">${Object.values(data.sources).map((s) => `<li><a href="${escapeHtml(s.url)}" target="_blank" rel="noopener">${escapeHtml(s.title)}</a><small>${escapeHtml(s.publisher)} · ${escapeHtml(s.license)} · ${escapeHtml(s.usedFor)}</small></li>`).join('')}</ul>`;
  }

  function startRegion() {
    createMain();
    const y = store.get().year;
    // 각 화면 구성 요소를 따로 실행: 하나가 실패해도 나머지는 표시
    const steps = [
      ['타임라인', () => { timeline.build(); timeline.render(y); }],
      ['사이드바', () => sidebar.build()],
      ['정보 패널', () => { panel.reset(); panel.render(y); }],
      ['비교 모드', () => compare.reset()],
      ['연도 표시', () => renderYearBadge(y)],
      ['범례', () => renderLegend()]
    ];
    for (const [name, fn] of steps) {
      try { fn(); } catch (err) {
        console.error(`[GeoScape] ${name} 초기화 오류`, err);
        notify(`${name}을(를) 표시하지 못했습니다.`, { type: 'error' });
      }
    }
    if (data.warnings.length) {
      notify(`일부 자료(${data.warnings.length}건)를 확인하지 못해 제외했습니다. 상단의 '데이터 안내'에서 볼 수 있습니다.`, { type: 'warn', key: 'data-warnings' });
    }
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

return {  };
})();

})();
