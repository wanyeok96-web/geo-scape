// 지도 뷰: Leaflet 지도 + 연도별 공간 레이어 렌더링
// 같은 함수를 메인 지도와 비교 모드 지도에서 재사용합니다.
import { escapeHtml, iconSvg } from './utils.js';

// ---------- 배경 지도 타일 제공자 ----------
// API 키가 필요 없고 한국 지역 데이터가 있는 제공자만 사용합니다.
// OSM 공식 서버는 Referer가 없는 요청(index.html 더블클릭 = file://)을 차단(403)하므로,
// 실행 전 '시험 타일'을 요청해 차단·실패가 확인되면 다음 제공자로 자동 전환합니다.
const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
export const TILE_PROVIDERS = {
  osm: { name: 'OpenStreetMap', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', maxZoom: 19, attribution: OSM_ATTR, needsReferer: true },
  osmde: { name: 'OpenStreetMap Deutschland', url: 'https://tile.openstreetmap.de/{z}/{x}/{y}.png', maxZoom: 18, attribution: OSM_ATTR + ' · Tiles: openstreetmap.de' },
  hot: { name: 'Humanitarian OSM', url: 'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png', subdomains: 'abc', maxZoom: 19, attribution: OSM_ATTR + ' · Tiles: HOT / OSM France' },
  esriImagery: { name: 'Esri World Imagery', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', maxZoom: 18, attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics' }
};
const PROBE_TILE = { z: 11, x: 1746, y: 792 }; // 서울 도심이 포함된 타일

export const BASEMAPS = {
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
export function markProviderFailed(id) { failedProviders.add(id); providerHealth[id] = Promise.resolve(false); }
// 지금 바로 써 볼 수 있는 제공자 (file:// 에서 Referer 필요 서버, 이미 실패한 서버 제외)
const usableNow = (pid) => !failedProviders.has(pid) && !(TILE_PROVIDERS[pid].needsReferer && location.protocol === 'file:');

/**
 * @param {HTMLElement} el
 * @param {object} data   loadRegion() 결과
 * @param {object} opts   { onPhotoOpen(id), compact }
 */
export function createMapView(el, data, opts = {}) {
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
