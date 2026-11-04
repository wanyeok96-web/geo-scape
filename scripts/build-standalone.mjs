// GeoScape – 더블클릭(file://) 실행용 번들 생성
//
//   node scripts/build-standalone.mjs
//
// 브라우저는 file:// 에서 ES 모듈과 fetch(JSON)를 막습니다. 그래서
//  - dist/geoscape.bundle.js : js/*.js 모듈을 하나의 일반 스크립트로 합친 파일
//  - dist/geoscape-data.js   : data/ 의 JSON·GeoJSON을 window.GEOSCAPE_EMBEDDED 로 담은 파일
// 을 만들고, index.html 이 file:// 일 때만 이 두 파일을 불러옵니다.
// ※ data/ 나 js/ 를 수정한 뒤에는 이 스크립트를 다시 실행하세요. (웹 서버·GitHub Pages 실행에는 필요 없음)
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const ORDER = ['utils', 'store', 'data', 'map-view', 'timeline', 'sidebar', 'stats-chart', 'info-panel', 'modal', 'gallery', 'compare', 'main'];

// ---------- JS 번들 ----------
let code = '';
for (const name of ORDER) {
  const src = readFileSync(join(ROOT, 'js', name + '.js'), 'utf8')
    .replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '') // import 문 제거
    .replace(/^export\s+(?=(async\s+)?function|const|let|class)/gm, ''); // export 키워드 제거
  if (/^\s*(import|export)\s/m.test(src)) throw new Error(`${name}.js 에 처리되지 않은 import/export 가 있습니다.`);
  code += `\n// ===== js/${name}.js =====\n${src}\n`;
}
const banner = `/* GeoScape standalone bundle – 자동 생성 파일입니다. 직접 수정하지 말고 scripts/build-standalone.mjs 를 실행하세요. */\n`;
mkdirSync(join(ROOT, 'dist'), { recursive: true });
writeFileSync(join(ROOT, 'dist/geoscape.bundle.js'), `${banner}(function () {\n'use strict';\nvar __GEOSCAPE_BUNDLED = true;\n${code}\n})();\n`);

// ---------- 데이터 번들 ----------
const files = [];
(function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) { if (f !== 'photo-sources') walk(p); }
    else if (/\.(json|geojson)$/.test(f)) files.push(p);
  }
})(join(ROOT, 'data'));
const embedded = {};
for (const p of files) embedded[relative(ROOT, p).split(sep).join('/')] = JSON.parse(readFileSync(p, 'utf8'));
writeFileSync(join(ROOT, 'dist/geoscape-data.js'), `${banner}window.GEOSCAPE_EMBEDDED = ${JSON.stringify(embedded)};\n`);

console.log('bundle ok:', ORDER.length, 'modules,', Object.keys(embedded).length, 'data files');
