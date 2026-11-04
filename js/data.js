// 데이터 로더: 지역 레지스트리 → 지역별 JSON/GeoJSON 묶음
async function fetchJson(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${url} 불러오기 실패 (${res.status})`);
  return res.json();
}

export function loadRegistry() {
  return fetchJson('data/regions.json');
}

/** 지역 데이터 전체를 불러와 서로 연결된 하나의 객체로 반환 */
export async function loadRegion(meta) {
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
