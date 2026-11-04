// 사진 갤러리 + 확대 보기(라이트박스)
// - 지도 연결 사진: 위치가 확인된 사진 (지도 마커와 연결)
// - 지역 갤러리   : 촬영 위치를 확인할 수 없는 사진 (임의 좌표를 부여하지 않음)
// - 이용 조건 미확인: 정식 콘텐츠로 등록하지 않은 후보 (이미지 없이 목록만)
// - 추가 확보 필요 : 아직 사진이 없는 주제
import { $, escapeHtml, refreshIcons } from './utils.js';
import { openModal, closeModal } from './modal.js';

const CERTAINTY = { day: '촬영일 확인', month: '촬영 월 확인', year: '촬영 연도만 확인', approx: '촬영 시기 추정', unknown: '촬영 시기 미확인' };

export function initGallery(store, getData, { onLocate }) {
  const filtersEl = $('#galleryFilters');
  const body = $('#galleryBody');
  let filter = 'all';
  let lbList = [];
  let lbIndex = 0;

  const thumb = (p) => `
    <button class="photo-thumb" data-photo-id="${p.id}" title="${escapeHtml(p.title)}">
      <img src="${escapeHtml(p.thumb || p.src)}" alt="${escapeHtml(p.title)}" loading="lazy">
      ${p.mapLinked ? '<span class="pt-pin" title="지도 연결"><i data-lucide="map-pin"></i></span>' : ''}
      <span class="pt-cap">${escapeHtml(p.title)}<small>${escapeHtml(p.date?.label || p.period?.label || '시기 미상')} · ${escapeHtml(p.place)}</small></span>
    </button>`;

  function filtered() {
    const data = getData();
    const byYear = (a, b) => (a.date?.iso || '').localeCompare(b.date?.iso || '');
    let list = data.photos;
    if (filter === 'unlocated') list = list.filter((p) => !p.mapLinked);
    else if (filter !== 'all') {
      const era = data.eras.find((e) => e.id === filter);
      if (era) list = data.photosForEra(era);
    }
    return list.slice().sort(byYear);
  }

  function renderGallery() {
    const data = getData();
    const counts = Object.fromEntries(data.eras.map((e) => [e.id, data.photosForEra(e).length]));
    filtersEl.innerHTML = [['all', `전체 ${data.photos.length}`], ...data.eras.map((e) => [e.id, `${e.id.replace('s', '년대')} ${counts[e.id]}`]), ['unlocated', '위치 미확인']]
      .map(([id, label]) => `<button class="filter-btn ${filter === id ? 'is-active' : ''}" data-filter="${id}">${label}</button>`).join('');

    const list = filtered();
    const located = list.filter((p) => p.mapLinked);
    const unlocated = list.filter((p) => !p.mapLinked);
    lbList = [...located, ...unlocated].map((p) => p.id);

    const era = data.eras.find((e) => e.id === filter);
    const needed = (era ? data.neededForEra(era) : data.photoInfo.needed);
    const unverified = data.photoInfo.unverified;

    body.innerHTML = `
      <p class="callout callout-info" style="margin-bottom:14px"><i data-lucide="shield-check"></i><span>모든 사진은 Wikimedia Commons에서 <b>이용 조건(CC BY · 공공누리 제1유형 · 퍼블릭 도메인)을 확인한 실제 역사 사진</b>입니다. 사진을 사용할 때는 확대 보기의 출처·라이선스 표기를 함께 밝혀 주세요.</span></p>
      <section class="gallery-section">
        <h3><i data-lucide="map-pin"></i>지도 연결 사진 <span class="muted small">(${located.length})</span></h3>
        <p>사진 속 시설의 위치가 확인되어 지도에 마커로 표시되는 사진입니다. 마커 위치는 피사체(시설) 위치이며 촬영 지점은 아닙니다.</p>
        ${located.length ? `<div class="gallery-grid">${located.map(thumb).join('')}</div>` : '<div class="empty">해당 사진이 없습니다.</div>'}
      </section>
      <section class="gallery-section">
        <h3><i data-lucide="folder-open"></i>지역 갤러리 (위치 미확인) <span class="muted small">(${unlocated.length})</span></h3>
        <p>거리 풍경·항공사진 등 정확한 촬영 위치를 확인할 수 없어 임의로 좌표를 지정하지 않은 사진입니다.</p>
        ${unlocated.length ? `<div class="gallery-grid">${unlocated.map(thumb).join('')}</div>` : '<div class="empty">해당 사진이 없습니다.</div>'}
      </section>
      <section class="gallery-section">
        <h3><i data-lucide="shield-question"></i>이용 조건 미확인 (별도 분류) <span class="muted small">(${unverified.length})</span></h3>
        <p>저작권·이용 조건을 확인하지 못한 후보는 정식 콘텐츠로 등록하지 않고 여기에 목록만 둡니다.</p>
        ${unverified.length ? `<ul class="plain-list">${unverified.map((u) => `<li><b>${escapeHtml(u.label)}</b> (${u.year}) – ${escapeHtml(u.reason || u.status)}</li>`).join('')}</ul>` : '<div class="empty">현재 수집 목록 55건은 모두 이용 조건이 확인되었습니다.</div>'}
      </section>
      <section class="gallery-section">
        <h3><i data-lucide="search"></i>추가 확보가 필요한 사진 <span class="muted small">(${needed.length})</span></h3>
        <p>아직 사진이 없는 주제입니다. 실제 사진을 확보하기 전까지 임의의 이미지를 사용하지 않습니다.</p>
        ${needed.length ? `<ul class="plain-list">${needed.map((n) => `<li><b>${escapeHtml(n.eraId.replace('s', '년대'))} · ${escapeHtml(n.topic)}</b> <span class="muted">(${escapeHtml(n.place)})</span><br><small>${escapeHtml(n.why)} · 후보 출처: ${escapeHtml(n.suggestedSources.join(', '))}</small></li>`).join('')}</ul>` : '<div class="empty">없음</div>'}
      </section>`;
    refreshIcons();
  }

  function openGallery(initialFilter) {
    if (initialFilter) filter = initialFilter;
    renderGallery();
    openModal('galleryModal');
  }

  // ---------- 라이트박스 ----------
  function renderLightbox() {
    const data = getData();
    const p = data.photos.find((x) => x.id === lbList[lbIndex]);
    if (!p) return;
    const img = $('#lbImg');
    // 이전 사진의 로드 실패 표시 초기화
    delete img.dataset.failed;
    img.classList.remove('img-failed');
    img.parentElement.classList.remove('has-failed-img');
    img.src = p.src; img.alt = p.title;
    $('#lbType').textContent = data.photoInfo.contentTypes[p.contentType] || p.contentType;
    const loc = p.location || {};
    const precision = data.photoInfo.locationPrecision[loc.precision] || '';
    const notes = p.verification?.notes || [];
    $('#lbMeta').innerHTML = `
      <h3>${escapeHtml(p.title)}</h3>
      <p class="lb-sub">${escapeHtml(p.date?.label || '')} · ${escapeHtml(p.place)}</p>

      <div class="lb-geo"><b><i data-lucide="map"></i>지리적 변화 읽기</b><p>${escapeHtml(p.geography || '')}</p></div>

      <dl>
        <dt>촬영 시기</dt><dd>${escapeHtml(p.date?.label || '시기 미상')} <span class="muted small">(${CERTAINTY[p.date?.certainty] || '미확인'} · ${escapeHtml(p.date?.basis || '')} 기준)</span></dd>
        <dt>촬영 장소</dt><dd>${escapeHtml(p.place)}</dd>
        <dt>지도 위치</dt><dd>${loc.coords ? `${escapeHtml(loc.label)}<br><span class="muted small">${escapeHtml(precision)}</span>` : `<span class="muted">${escapeHtml(loc.note || '위치 미확인')}</span>`}</dd>
        <dt>자료 설명</dt><dd>${escapeHtml(p.description)}</dd>
        <dt>주제</dt><dd>${escapeHtml(p.theme || '')}</dd>
        <dt>저작자</dt><dd>${escapeHtml(p.source?.author || '')}</dd>
        <dt>원 출처</dt><dd>${escapeHtml(p.source?.credit || '—')}</dd>
        <dt>파일 출처</dt><dd>${p.source?.commonsPage ? `<a href="${escapeHtml(p.source.commonsPage)}" target="_blank" rel="noopener">Wikimedia Commons 파일 페이지</a>` : '—'}</dd>
        <dt>이용 조건</dt><dd>${p.license?.url ? `<a href="${escapeHtml(p.license.url)}" target="_blank" rel="noopener">${escapeHtml(p.license.nameKo || p.license.name)}</a>` : escapeHtml(p.license?.nameKo || '')}</dd>
        <dt>출처 표기</dt><dd class="small">${escapeHtml(p.attribution || '')}</dd>
      </dl>
      ${notes.length ? `<div class="lb-notes"><b>검증 메모</b><ul>${notes.map((n) => `<li>${escapeHtml(n)}</li>`).join('')}</ul></div>` : ''}
      <div class="lb-actions">
        ${p.mapLinked ? `<button class="btn btn-primary" id="lbLocate"><i data-lucide="locate-fixed"></i>지도에서 위치 보기</button>` : ''}
        <button class="btn" disabled title="같은 장소의 현재 사진을 확보하면 활성화됩니다"><i data-lucide="columns-2"></i>과거·현재 사진 비교 (예정)</button>
      </div>
      <p class="small muted" style="margin-top:10px">${lbIndex + 1} / ${lbList.length}</p>`;
    $('#lbPrev').disabled = lbIndex <= 0;
    $('#lbNext').disabled = lbIndex >= lbList.length - 1;
    $('#lbLocate')?.addEventListener('click', () => {
      closeModal('lightbox'); closeModal('galleryModal');
      onLocate(p);
    });
    refreshIcons();
  }

  function openPhoto(id, list) {
    lbList = list?.length ? list : getData().photos.map((p) => p.id);
    if (!lbList.includes(id)) lbList = [id, ...lbList];
    lbIndex = lbList.indexOf(id);
    renderLightbox();
    openModal('lightbox');
  }
  const move = (d) => {
    const n = lbIndex + d;
    if (n >= 0 && n < lbList.length) { lbIndex = n; renderLightbox(); }
  };

  filtersEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-filter]');
    if (b) { filter = b.dataset.filter; renderGallery(); }
  });
  body.addEventListener('click', (e) => {
    const t = e.target.closest('[data-photo-id]');
    if (t) openPhoto(t.dataset.photoId, lbList);
  });
  $('#lbPrev').addEventListener('click', () => move(-1));
  $('#lbNext').addEventListener('click', () => move(1));
  document.addEventListener('keydown', (e) => {
    if ($('#lightbox').hidden) return;
    if (e.key === 'ArrowLeft') move(-1);
    if (e.key === 'ArrowRight') move(1);
  });

  return { openGallery, openPhoto };
}
