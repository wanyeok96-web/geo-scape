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

// 시가지 확장 범위는 위성 실측 자료(GHSL, scripts/build_ghsl_grid.py)로 대체되어 더 이상 만들지 않습니다.

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
writeFileSync(join(out, 'landuse.geojson'), JSON.stringify(fc(landuse, demoMeta('토지 이용 변화')), null, 1));
console.log('landuse', landuse.length);
