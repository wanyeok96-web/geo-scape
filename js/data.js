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
export const loadJson = (url) => fetchJson(url);

export function loadRegistry() {
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

/** 지역 데이터 전체를 불러와 서로 연결된 하나의 객체로 반환 */
export async function loadRegion(meta) {
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
  await Promise.all(region.layers.filter((l) => l.file).map(async (l) => {
    const fc = await optional(base + l.file, null, `공간 레이어 '${l.label || l.id}'`);
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
    meta, region, geo, featureIndex, warnings,
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
