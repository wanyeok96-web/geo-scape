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
import { createHash } from 'node:crypto';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const ORDER = ['utils', 'store', 'data', 'map-view', 'timeline', 'sidebar', 'stats-chart', 'info-panel', 'modal', 'gallery', 'compare', 'simulator', 'main'];

// ---------- JS 번들 ----------
// 모듈마다 자기 범위(함수)로 감싸 내부 이름이 서로 부딪히지 않게 하고, export 한 이름만 바깥으로 꺼냅니다.
// (실제 ES 모듈과 같은 규칙. 두 모듈이 같은 이름을 export 하면 빌드를 멈춤)
let code = '';
const exported = new Map();
for (const name of ORDER) {
  const raw = readFileSync(join(ROOT, 'js', name + '.js'), 'utf8');
  const names = [...raw.matchAll(/^export\s+(?:async\s+)?(?:function\s*\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
  for (const n of names) {
    if (exported.has(n)) throw new Error(`'${n}' 를 ${exported.get(n)}.js 와 ${name}.js 가 함께 export 합니다.`);
    exported.set(n, name);
  }
  const src = raw
    .replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '') // import 문 제거 (앞 모듈이 꺼낸 이름을 그대로 사용)
    .replace(/^export\s+(?=(async\s+)?function|const|let|class)/gm, ''); // export 키워드 제거
  if (/^\s*(import|export)\s/m.test(src)) throw new Error(`${name}.js 에 처리되지 않은 import/export 가 있습니다.`);
  const head = names.length ? `const { ${names.join(', ')} } = ` : '';
  code += `\n// ===== js/${name}.js =====\n${head}(function () {\n${src}\nreturn { ${names.join(', ')} };\n})();\n`;
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

// ---------- 캐시 무효화: index.html 의 CSS·JS 주소에 내용 해시 버전을 붙임 ----------
// 새 버전을 배포했는데 브라우저가 옛 CSS·JS를 캐시에서 꺼내 새 HTML과 섞이는 문제를 막습니다.
// (모듈끼리의 import 는 import map 으로 같은 버전 주소에 연결)
const hash = createHash('sha1');
for (const name of ORDER) hash.update(readFileSync(join(ROOT, 'js', name + '.js')));
hash.update(readFileSync(join(ROOT, 'css/style.css')));
hash.update(readFileSync(join(ROOT, 'dist/geoscape-data.js')));
const v = hash.digest('hex').slice(0, 10);
const indexPath = join(ROOT, 'index.html');
let html = readFileSync(indexPath, 'utf8');
const importMap = `<!-- importmap:start (자동 생성) -->
  <script type="importmap">${JSON.stringify({ imports: Object.fromEntries(ORDER.map((n) => [`./js/${n}.js`, `./js/${n}.js?v=${v}`])) })}</script>
  <!-- importmap:end -->`;
if (!html.includes('<!-- importmap:start')) {
  html = html.replace('<!-- 웹 서버·GitHub Pages: ES 모듈판 -->', `${importMap}
  <!-- 웹 서버·GitHub Pages: ES 모듈판 -->`);
} else {
  html = html.replace(/<!-- importmap:start[\s\S]*?<!-- importmap:end -->/, importMap);
}
html = html
  .replace(/href="css\/style\.css(\?v=[^"]*)?"/, `href="css/style.css?v=${v}"`)
  .replace(/src="js\/main\.js(\?v=[^"]*)?"/, `src="js/main.js?v=${v}"`)
  .replace(/'dist\/geoscape-data\.js(\?v=[^']*)?'/, `'dist/geoscape-data.js?v=${v}'`)
  .replace(/'dist\/geoscape\.bundle\.js(\?v=[^']*)?'/, `'dist/geoscape.bundle.js?v=${v}'`);
writeFileSync(indexPath, html);

console.log('bundle ok:', ORDER.length, 'modules,', Object.keys(embedded).length, 'data files, version', v);
