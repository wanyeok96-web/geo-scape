// 모달 공통 동작: 열기/닫기, 배경 클릭·Esc 닫기, 포커스 복귀
const stack = [];

export function openModal(id) {
  const m = document.getElementById(id);
  if (!m || !m.hidden) return;
  stack.push({ id, returnFocus: document.activeElement });
  m.hidden = false;
  (m.querySelector('[data-close]') || m).focus?.();
}

export function closeModal(id) {
  const m = document.getElementById(id);
  if (!m || m.hidden) return;
  m.hidden = true;
  const i = stack.findIndex((s) => s.id === id);
  if (i >= 0) { stack[i].returnFocus?.focus?.(); stack.splice(i, 1); }
}

export function initModals() {
  document.querySelectorAll('.modal').forEach((m) => {
    m.addEventListener('click', (e) => {
      if (e.target === m || e.target.closest('[data-close]')) closeModal(m.id);
    });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && stack.length) closeModal(stack[stack.length - 1].id);
  });
}
