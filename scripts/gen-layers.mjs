// GeoScape 데모 레이어 생성 스크립트 (교육용 개략 형상 생성)
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2];
mkdirSync(out, { recursive: true });

// 결정적 의사난수
function rng(seed) { let s = seed; return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; }; }
// 중심(lat,lng), 반경(km) 기반 불규칙 다각형
function blob(lat, lng, rxKm, ryKm, seed = 1, n = 18) {
  const r = rng(seed);
  const kmLat = 1 / 110.9, kmLng = 1 / 88.2;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 0.82 + r() * 0.3;
    pts.push([+(lng + Math.cos(a) * rxKm * kmLng * k).toFixed(5), +(lat + Math.sin(a) * ryKm * kmLat * k).toFixed(5)]);
  }
  pts.push(pts[0]);
  return [pts];
}
const close = (arr) => [[...arr, arr[0]]];
const poly = (props, coords) => ({ type: 'Feature', properties: props, geometry: { type: 'Polygon', coordinates: coords } });

// ---------- 시가지 확장 범위 (데모) ----------
const urban = [
  poly({ id: 'u1970-core', name: '도심·강북 기성 시가지', stage: '1970', yearStart: 1970 }, close([
    [126.895, 37.565], [126.905, 37.592], [126.935, 37.612], [126.97, 37.622], [127.01, 37.617], [127.045, 37.603],
    [127.075, 37.585], [127.08, 37.562], [127.06, 37.546], [127.02, 37.536], [126.985, 37.533], [126.955, 37.538], [126.925, 37.545]
  ])),
  poly({ id: 'u1970-ydp', name: '영등포 공업 지역', stage: '1970', yearStart: 1970 }, close([
    [126.875, 37.532], [126.905, 37.536], [126.925, 37.527], [126.918, 37.505], [126.9, 37.49], [126.875, 37.488], [126.86, 37.508]
  ])),
  poly({ id: 'u1980-south', name: '강남·잠실·여의도 개발지', stage: '1980', yearStart: 1980 }, close([
    [126.915, 37.532], [126.94, 37.527], [126.975, 37.52], [127.01, 37.525], [127.05, 37.528], [127.09, 37.527], [127.125, 37.518],
    [127.125, 37.495], [127.09, 37.485], [127.05, 37.478], [127.015, 37.475], [126.985, 37.478], [126.955, 37.485], [126.93, 37.5]
  ])),
  poly({ id: 'u1980-north', name: '강북 외곽 확장', stage: '1980', yearStart: 1980 }, close([
    [126.89, 37.6], [126.92, 37.632], [126.97, 37.645], [127.03, 37.64], [127.08, 37.62], [127.105, 37.59], [127.1, 37.56],
    [127.08, 37.585], [127.045, 37.603], [127.01, 37.617], [126.97, 37.622], [126.935, 37.612], [126.905, 37.592]
  ])),
  poly({ id: 'u1990-west', name: '목동·강서 신시가지', stage: '1990', yearStart: 1990 }, close([
    [126.82, 37.555], [126.86, 37.56], [126.89, 37.548], [126.89, 37.52], [126.875, 37.5], [126.84, 37.495], [126.815, 37.52]
  ])),
  poly({ id: 'u1990-ne', name: '상계·중계 택지', stage: '1990', yearStart: 1990 }, close([
    [127.04, 37.64], [127.05, 37.672], [127.075, 37.68], [127.095, 37.66], [127.09, 37.625], [127.06, 37.625]
  ])),
  poly({ id: 'u1990-se', name: '개포·고덕·송파 확장', stage: '1990', yearStart: 1990 }, close([
    [127.04, 37.478], [127.08, 37.484], [127.125, 37.495], [127.16, 37.53], [127.175, 37.555], [127.15, 37.565], [127.13, 37.535],
    [127.13, 37.49], [127.11, 37.47], [127.07, 37.465]
  ])),
  poly({ id: 'u1991-bundang', name: '분당 신도시', stage: '1990', yearStart: 1991 }, blob(37.375, 127.12, 2.2, 4.2, 3)),
  poly({ id: 'u1992-ilsan', name: '일산 신도시', stage: '1990', yearStart: 1992 }, blob(37.665, 126.77, 3.2, 2.4, 5)),
  poly({ id: 'u1992-pyeongchon', name: '평촌 신도시', stage: '1990', yearStart: 1992 }, blob(37.392, 126.962, 1.6, 1.3, 7)),
  poly({ id: 'u1992-sanbon', name: '산본 신도시', stage: '1990', yearStart: 1992 }, blob(37.36, 126.932, 1.3, 1.4, 9)),
  poly({ id: 'u1993-jungdong', name: '중동 신도시', stage: '1990', yearStart: 1993 }, blob(37.503, 126.765, 1.6, 1.2, 11)),
  poly({ id: 'u2002-sangam', name: '상암 DMC·월드컵 지구', stage: '2000', yearStart: 2002 }, blob(37.578, 126.889, 1.4, 1.1, 13)),
  poly({ id: 'u2007-dongtan', name: '동탄 신도시', stage: '2000', yearStart: 2007 }, blob(37.205, 127.075, 2.6, 3.0, 15)),
  poly({ id: 'u2008-eunpyeong', name: '은평 뉴타운', stage: '2000', yearStart: 2008 }, blob(37.638, 126.918, 1.2, 1.4, 17)),
  poly({ id: 'u2009-pangyo', name: '판교 신도시', stage: '2000', yearStart: 2009 }, blob(37.395, 127.105, 1.8, 1.3, 19)),
  poly({ id: 'u2009-unjeong', name: '파주 운정 신도시', stage: '2000', yearStart: 2009 }, blob(37.715, 126.75, 2.2, 1.8, 21)),
  poly({ id: 'u2011-gwanggyo', name: '광교 신도시', stage: '2010', yearStart: 2011 }, blob(37.288, 127.05, 1.8, 2.0, 23)),
  poly({ id: 'u2011-gimpo', name: '김포 한강 신도시', stage: '2010', yearStart: 2011 }, blob(37.643, 126.67, 2.2, 1.8, 25)),
  poly({ id: 'u2013-wirye', name: '위례 신도시', stage: '2010', yearStart: 2013 }, blob(37.478, 127.145, 1.3, 1.2, 27)),
  poly({ id: 'u2014-magok', name: '마곡 지구', stage: '2010', yearStart: 2014 }, blob(37.562, 126.83, 1.5, 1.2, 29))
];

// ---------- 토지 이용 변화 (데모) ----------
const lu = (id, name, type, yearStart, yearEnd, lat, lng, rx, ry, seed, note) =>
  poly({ id, name, type, yearStart, yearEnd, note }, blob(lat, lng, rx, ry, seed, 14));
const landuse = [
  lu('lu-yd-farm', '영동(강남) 일대 농경지', 'farmland', 1970, 1975, 37.505, 127.035, 3.2, 2.2, 31, '영동지구 토지구획정리 이전 농경지·구릉지'),
  lu('lu-yd-res', '강남 주거·업무 지역', 'residential', 1976, null, 37.505, 127.035, 3.2, 2.2, 31, '구획정리 이후 아파트 단지와 업무지구로 전환'),
  lu('lu-guro-ind', '구로 수출산업공업단지', 'industrial', 1970, 1999, 37.4835, 126.893, 1.0, 0.9, 33, '노동집약적 경공업 중심 공업단지'),
  lu('lu-guro-it', '서울디지털산업단지', 'commercial', 2000, null, 37.4835, 126.893, 1.0, 0.9, 33, '2000년 명칭 변경, IT·지식산업센터 중심으로 전환'),
  lu('lu-nanji-landfill', '난지도 쓰레기 매립지', 'landfill', 1978, 1993, 37.568, 126.885, 1.4, 0.7, 35, '1978~1993년 서울의 쓰레기 매립지'),
  lu('lu-nanji-park', '월드컵공원(하늘·노을공원)', 'green', 2002, null, 37.568, 126.885, 1.4, 0.7, 35, '매립지 안정화 후 생태공원으로 조성'),
  lu('lu-yeouido-air', '여의도 비행장·모래섬', 'airport', 1970, 1971, 37.525, 126.925, 1.5, 0.8, 37, '윤중제 축조(1968) 이후 비행장 이전'),
  lu('lu-yeouido-cbd', '여의도 업무지구', 'commercial', 1975, null, 37.525, 126.925, 1.5, 0.8, 37, '국회·방송사·금융기관이 입지한 업무지구'),
  lu('lu-jamsil-sand', '잠실 하천 퇴적지', 'farmland', 1970, 1971, 37.512, 127.085, 1.8, 0.9, 39, '공유수면 매립 이전 하천 퇴적지'),
  lu('lu-jamsil-res', '잠실 아파트·체육 시설', 'residential', 1975, null, 37.512, 127.085, 1.8, 0.9, 39, '대단지 아파트와 종합운동장 조성'),
  lu('lu-seongsu-ind', '성수 준공업 지역', 'industrial', 1970, 2013, 37.544, 127.056, 1.1, 0.8, 41, '인쇄·피혁·제화 등 소규모 공장 밀집'),
  lu('lu-seongsu-mix', '성수 복합 문화·업무 지역', 'commercial', 2014, null, 37.544, 127.056, 1.1, 0.8, 41, '공장 건물의 카페·사무실 전환, 지식산업센터 증가'),
  lu('lu-yongsan-mil', '용산 미군기지', 'military', 1970, 2021, 37.531, 126.978, 1.5, 1.0, 43, '도심 한가운데 위치한 대규모 군사 시설'),
  lu('lu-yongsan-park', '용산공원(부분 개방)', 'green', 2022, null, 37.531, 126.978, 1.5, 1.0, 43, '반환 부지 일부 시범 개방, 국가공원 조성 추진')
];

const fc = (features, meta) => ({ type: 'FeatureCollection', metadata: meta, features });
const demoMeta = (title) => ({
  title,
  dataStatus: 'demo',
  notice: '교육용 개략 형상(데모 데이터)입니다. 실제 경계가 아니며, 검증된 공간 자료로 교체해야 합니다.',
  generatedBy: 'scripts/gen-layers.mjs'
});
writeFileSync(join(out, 'urban-extent.geojson'), JSON.stringify(fc(urban, demoMeta('시가지 확장 범위')), null, 1));
writeFileSync(join(out, 'landuse.geojson'), JSON.stringify(fc(landuse, demoMeta('토지 이용 변화')), null, 1));
console.log('urban', urban.length, 'landuse', landuse.length);
