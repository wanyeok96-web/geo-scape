// 서울 공간 구조 시뮬레이터 (MapLibre GL)
// - 기존 탐구 화면(Leaflet)과 별도 화면으로, 헤더의 '시뮬레이터' 버튼으로 오갑니다.
// - 하단 타임라인(연도·재생)을 탐구 화면과 함께 씁니다.
// - 자료 원칙: 도시화 격자는 5년 간격 관측값(GHSL)만, 지하철은 실제 구간 개통일에만 나타남. 연도 사이 값은 만들지 않음.
//   (관측값이 바뀔 때의 전환 효과, 개통 구간이 그려지는 효과는 '움직임'일 뿐 자료가 아님)
import { $, escapeHtml, notify, refreshIcons } from './utils.js';
import { loadJson } from './data.js';

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

export function initSimulator(store, getData) {
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
