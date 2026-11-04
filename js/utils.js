// 공통 유틸리티
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function escapeHtml(str = '') {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** <i data-lucide> 요소를 SVG 아이콘으로 변환 */
export function refreshIcons() {
  if (window.lucide?.createIcons) window.lucide.createIcons();
}

/** 아이콘 SVG 문자열 (Leaflet divIcon 등 동적 HTML용) */
export function iconSvg(name, size = 16) {
  const pascal = name.replace(/(^|-)([a-z0-9])/g, (_, __, c) => c.toUpperCase());
  const node = window.lucide?.icons?.[pascal];
  if (!node || !window.lucide.createElement) return '';
  const svg = window.lucide.createElement(node);
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  return svg.outerHTML;
}

export const DATA_STATUS = {
  demo: { label: '데모', className: 'status-demo', desc: '교육용 데모 데이터 (실제 경계 아님)' },
  approx: { label: '개략', className: 'status-approx', desc: '실제 좌표 기반 개략 위치·선형' },
  placeholder: { label: '준비 중', className: 'status-placeholder', desc: '자료 준비 중' },
  verified: { label: '검증', className: 'status-verified', desc: '출처가 확인된 검증 자료' }
};

export function statusBadge(status) {
  const s = DATA_STATUS[status];
  return s ? `<span class="status-badge ${s.className}" title="${escapeHtml(s.desc)}">${s.label}</span>` : '';
}

export const storage = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, val) { try { localStorage.setItem(key, val); } catch { /* 저장소 사용 불가 시 무시 */ } }
};

// ---------- 알림(토스트): 오류·상태를 화면을 막지 않고 알려 줌 ----------
const recentNotices = new Map();
export function notify(message, { type = 'info', timeout = 6000, key } = {}) {
  const k = key || message;
  const now = Date.now();
  if (recentNotices.has(k) && now - recentNotices.get(k) < 8000) return; // 같은 알림 반복 방지
  recentNotices.set(k, now);
  let box = document.getElementById('toastBox');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toastBox';
    box.className = 'toast-box';
    box.setAttribute('role', 'status');
    box.setAttribute('aria-live', 'polite');
    document.body.appendChild(box);
  }
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `<span>${escapeHtml(message)}</span><button aria-label="닫기">×</button>`;
  const close = () => el.remove();
  el.querySelector('button').addEventListener('click', close);
  box.appendChild(el);
  while (box.children.length > 3) box.firstElementChild.remove();
  if (timeout) setTimeout(close, timeout);
}

// ---------- 이미지 로드 실패 시 깨진 아이콘 대신 안내 표시 ----------
export function installImageFallback() {
  document.addEventListener('error', (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || img.dataset.failed) return;
    if (img.closest('.leaflet-tile-container')) return; // 지도 타일은 map-view에서 처리
    img.dataset.failed = '1';
    img.classList.add('img-failed');
    img.removeAttribute('src');
    img.alt = `이미지를 불러오지 못했습니다${img.alt ? ` (${img.alt})` : ''}`;
    img.parentElement?.classList.add('has-failed-img');
  }, true);
}

/** 짧은 시간에 반복 호출되는 함수를 마지막 호출만 실행 */
export function debounce(fn, ms = 150) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
