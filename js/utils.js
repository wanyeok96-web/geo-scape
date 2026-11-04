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
