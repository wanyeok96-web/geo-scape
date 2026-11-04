// GeoScape 점검 스크립트 – 자료를 수정한 뒤, 커밋하기 전에 실행하세요.
//
//   node scripts/check.mjs          점검만
//   node scripts/check.mjs --fix    더블클릭용 번들(dist/)이 오래됐으면 다시 생성
//
// 점검 항목: JSON 형식, 필수 필드, 연도 범위, 피처·출처 연결, 사진 파일 존재·라이선스, JS 문법, dist 번들 최신 여부
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const errors = [], warns = [];
const err = (m) => errors.push(m), warn = (m) => warns.push(m);
const read = (rel) => {
  try { return JSON.parse(readFileSync(join(ROOT, rel), 'utf8')); }
  catch (e) { err(`${rel}: ${e.code === 'ENOENT' ? '파일 없음' : 'JSON 형식 오류 – ' + e.message}`); return null; }
};
const isLatLng = (c) => Array.isArray(c) && c.length === 2 && c.every(Number.isFinite) && Math.abs(c[0]) <= 90 && Math.abs(c[1]) <= 180;

// ---------- 지역 ----------
const registry = read('data/regions.json');
const photosFile = read('data/photos.json');
for (const r of registry?.regions ?? []) {
  if (!r.enabled) continue;
  const base = r.path;
  const region = read(base + 'region.json');
  if (!region) continue;
  const { start, end } = region.timeRange ?? {};
  if (!(start < end)) err(`${r.id}: timeRange 오류`);
  const resolve = (p) => (p.startsWith('data/') ? p : base + p);
  const eras = read(resolve(region.files?.eras ?? 'eras.json'))?.eras ?? [];
  const sources = read(resolve(region.files?.sources ?? 'sources.json'))?.sources ?? [];
  read(resolve(region.files?.stats ?? 'stats.json'));
  const srcIds = new Set(sources.map((s) => s.id));

  // 레이어·피처
  const featureIds = new Set();
  for (const l of region.layers ?? []) {
    if (!l.file) continue;
    const fc = read(base + l.file);
    for (const ft of fc?.features ?? []) {
      const id = ft.properties?.id;
      if (!id) err(`${l.file}: id 없는 피처`);
      else if (featureIds.has(id)) err(`${l.file}: 중복 id ${id}`);
      featureIds.add(id);
      const y = ft.properties?.yearStart ?? ft.properties?.year;
      if (y != null && (y < start || y > end)) warn(`${l.file}: ${id} 연도 ${y}가 timeRange(${start}–${end}) 밖`);
    }
  }
  // 시대
  const sorted = [...eras].sort((a, b) => a.start - b.start);
  if (sorted.length && sorted[0].start > start) warn(`${r.id}: ${start}–${sorted[0].start - 1}년에 해당하는 시대 정보 없음`);
  sorted.forEach((e, i) => {
    if (i && e.start !== sorted[i - 1].end + 1) warn(`${r.id}: 시대 ${sorted[i - 1].id}–${e.id} 사이 연도 공백/겹침`);
    for (const c of e.cases ?? []) if (c.featureId && !featureIds.has(c.featureId)) err(`eras ${e.id}: 사례 '${c.title}'의 featureId '${c.featureId}' 없음`);
    for (const s of e.sourceIds ?? []) if (!srcIds.has(s)) err(`eras ${e.id}: 출처 '${s}' 없음`);
  });
  for (const m of region.milestones ?? []) {
    if (m.year < start || m.year > end) err(`주요 시점 ${m.year}: 범위 밖`);
    if (m.focus?.featureId && !featureIds.has(m.focus.featureId)) err(`주요 시점 ${m.year}: featureId '${m.focus.featureId}' 없음`);
  }
  for (const t of region.topics ?? []) for (const lid of t.layers ?? []) if (!(region.layers ?? []).some((l) => l.id === lid)) err(`탐구 주제 ${t.id}: 레이어 '${lid}' 없음`);

  // 사진
  const ids = new Set();
  for (const p of (photosFile?.photos ?? []).filter((x) => (x.region ?? r.id) === r.id)) {
    if (!p.id || ids.has(p.id)) err(`사진 id 누락/중복: ${p.id}`);
    ids.add(p.id);
    for (const k of ['src', 'thumb']) if (p[k] && !existsSync(join(ROOT, p[k]))) err(`사진 ${p.id}: ${k} 파일 없음 (${p[k]})`);
    if (!p.license?.name) err(`사진 ${p.id}: 라이선스 정보 없음 → 정식 등록 불가`);
    if (p.mapLinked && !isLatLng(p.location?.coords)) err(`사진 ${p.id}: 지도 연결인데 좌표 오류`);
    if (p.year != null && (p.year < start || p.year > end)) warn(`사진 ${p.id}: ${p.year}년이 타임라인 범위 밖`);
    if (!p.eraIds?.length) warn(`사진 ${p.id}: eraIds 없음 (시대 패널에 표시 안 됨)`);
  }
}

// ---------- JS 문법 ----------
for (const f of readdirSync(join(ROOT, 'js'))) {
  try { execFileSync(process.execPath, ['--check', join(ROOT, 'js', f)], { stdio: 'pipe' }); }
  catch (e) { err(`js/${f}: 문법 오류 – ${String(e.stderr).split('\n').slice(0, 4).join(' ')}`); }
}

// ---------- dist 번들 최신 여부 ----------
const distFiles = ['dist/geoscape.bundle.js', 'dist/geoscape-data.js'];
const before = distFiles.map((f) => (existsSync(join(ROOT, f)) ? readFileSync(join(ROOT, f), 'utf8') : ''));
execFileSync(process.execPath, [join(ROOT, 'scripts/build-standalone.mjs')], { stdio: 'pipe' });
const after = distFiles.map((f) => readFileSync(join(ROOT, f), 'utf8'));
const stale = before.some((b, i) => b !== after[i]);
if (stale) {
  if (process.argv.includes('--fix')) warn('dist/ 번들이 오래되어 다시 생성했습니다. 함께 커밋하세요.');
  else {
    // 점검 모드에서는 원래 파일로 되돌리고 오류로 보고
    for (const [i, f] of distFiles.entries()) if (before[i]) writeFileSync(join(ROOT, f), before[i]);
    err('dist/ 번들이 js/·data/ 와 다릅니다 → node scripts/check.mjs --fix (또는 build-standalone.mjs) 실행 필요');
  }
}
try { execFileSync(process.execPath, ['--check', join(ROOT, 'dist/geoscape.bundle.js')], { stdio: 'pipe' }); }
catch { err('dist/geoscape.bundle.js 문법 오류'); }

// ---------- 결과 ----------
for (const w of warns) console.log('⚠ ', w);
for (const e of errors) console.log('✖ ', e);
console.log(errors.length ? `\n점검 실패: 오류 ${errors.length}건, 경고 ${warns.length}건` : `\n점검 통과 (경고 ${warns.length}건)`);
process.exit(errors.length ? 1 : 0);
