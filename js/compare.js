// 과거·현재 비교 모드: 두 지도의 범위·확대 수준 동기화 + 변화 해설
import { $, escapeHtml, refreshIcons } from './utils.js';
import { createMapView } from './map-view.js';

export function initCompare(store, getData, { onPhotoOpen, onBasemapStatus }) {
  const wrap = $('#compare');
  const leftSel = $('#compareLeftYear');
  const rightSel = $('#compareRightYear');
  const commentary = $('#compareCommentary');
  let left = null, right = null;
  let syncing = false;

  function fillSelects() {
    const data = getData();
    const years = data.keyYears();
    const opts = years.map((y) => `<option value="${y}">${y}년</option>`).join('');
    leftSel.innerHTML = opts; rightSel.innerHTML = opts;
    leftSel.value = years[0];
    rightSel.value = years[years.length - 1];
  }

  function sync(from, to) {
    from.map.on('move', () => {
      if (syncing) return;
      syncing = true;
      to.map.setView(from.map.getCenter(), from.map.getZoom(), { animate: false });
      syncing = false;
    });
  }

  function ensureMaps() {
    if (left) return;
    const data = getData();
    const s = store.get();
    // 배경 지도 알림은 왼쪽 지도에서만 (중복 알림 방지)
    left = createMapView($('#mapLeft'), data, { onPhotoOpen, compact: true, onBasemapStatus });
    right = createMapView($('#mapRight'), data, { onPhotoOpen, compact: true });
    for (const v of [left, right]) {
      v.setBasemap(s.basemap);
      Object.entries(s.layers).forEach(([id, on]) => v.setLayerVisible(id, on));
    }
    sync(left, right); sync(right, left);
  }

  function popAt(data, year) {
    const series = data.stats[0];
    if (!series) return null;
    let d = null;
    series.data.forEach((x) => { if (x.year <= year) d = x; });
    return d ? { ...d, unit: series.unit, label: series.label } : null;
  }

  function renderCommentary() {
    const data = getData();
    const ly = +leftSel.value, ry = +rightSel.value;
    const le = data.getEra(ly), re = data.getEra(ry);
    const lp = popAt(data, ly), rp = popAt(data, ry);
    const builtText = (y) => {
      const ep = data.gridEpoch('urban', y);
      return ep == null ? '자료 없음' : `약 ${Math.round(data.gridBuiltArea('urban', ep)).toLocaleString()} km²(${ep})`;
    };
    const linesOpen = (y) => new Set((data.geo.subway?.features || []).filter((f) => f.properties.yearStart <= y).map((f) => f.properties.line)).size;
    const newDev = data.geo.developments?.features.filter((f) => f.properties.year > ly && f.properties.year <= ry) ?? [];

    let diff = '';
    if (lp && rp) {
      const delta = rp.value - lp.value;
      diff += `<b>${escapeHtml(lp.label)}</b> ${lp.value.toLocaleString()}${lp.unit}(${lp.year}) → ${rp.value.toLocaleString()}${rp.unit}(${rp.year}), <b>${delta >= 0 ? '+' : ''}${delta.toLocaleString()}${rp.unit}</b>. `;
    }
    diff += `건물 피복 면적(위성 관측) ${builtText(ly)} → ${builtText(ry)}. 지하철 노선 ${linesOpen(ly)}개 → ${linesOpen(ry)}개. `;
    if (newDev.length) diff += `그 사이 주요 개발: ${newDev.map((f) => escapeHtml(f.properties.name)).join(', ')}.`;

    commentary.innerHTML = `
      <div><h4>${ly}년 · ${escapeHtml(le.title)}</h4><ul>${le.features.map((f) => `<li>${escapeHtml(f)}</li>`).join('')}</ul></div>
      <div class="compare-arrow"><i data-lucide="arrow-right"></i></div>
      <div><h4>${ry}년 · ${escapeHtml(re.title)}</h4><ul>${re.features.map((f) => `<li>${escapeHtml(f)}</li>`).join('')}</ul></div>
      <div class="compare-diff"><b>변화 해설</b> · ${diff}${ly >= ry ? ' <span class="muted">(왼쪽에 더 이른 연도를 선택하면 변화를 읽기 쉽습니다.)</span>' : ''}</div>`;
    refreshIcons();
  }

  function update() {
    left.setYear(+leftSel.value);
    right.setYear(+rightSel.value);
    renderCommentary();
  }

  function show() {
    wrap.hidden = false;
    ensureMaps();
    requestAnimationFrame(() => {
      left.invalidate(); right.invalidate();
      const main = store.get().mainView;
      if (main) left.map.setView(main.getCenter(), main.getZoom(), { animate: false });
      update();
    });
  }
  function hide() { wrap.hidden = true; }

  leftSel.addEventListener('change', update);
  rightSel.addEventListener('change', update);

  store.subscribe((s, prev, changed) => {
    if (changed.includes('mode')) s.mode === 'compare' ? show() : hide();
    if (left && (changed.includes('layers') || changed.includes('basemap'))) {
      for (const v of [left, right]) {
        if (changed.includes('basemap')) v.setBasemap(s.basemap);
        if (changed.includes('layers')) Object.entries(s.layers).forEach(([id, on]) => v.setLayerVisible(id, on));
      }
    }
  });

  return {
    reset() { left?.destroy(); right?.destroy(); left = right = null; fillSelects(); },
    fillSelects,
    invalidate() { left?.invalidate(); right?.invalidate(); }
  };
}
