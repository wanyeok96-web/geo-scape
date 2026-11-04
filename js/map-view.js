// 지도 뷰: Leaflet 지도 + 연도별 공간 레이어 렌더링
// 같은 함수를 메인 지도와 비교 모드 지도에서 재사용합니다.
import { escapeHtml, iconSvg } from './utils.js';

export const BASEMAPS = {
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
export function createMapView(el, data, opts = {}) {
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
