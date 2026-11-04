// 간단한 전역 상태 저장소 (구독형)
// - normalize: 상태가 바뀔 때마다 값을 정리(예: 연도 범위 제한)
// - 구독자 하나에서 오류가 나도 나머지 구독자는 계속 실행되도록 격리
export function createStore(initial, { normalize, onError } = {}) {
  let state = { ...initial };
  const listeners = new Set();
  let depth = 0;
  return {
    get: () => state,
    set(patch) {
      const prev = state;
      let next = { ...state, ...patch };
      if (normalize) next = normalize(next, prev);
      state = next;
      const changed = Object.keys(state).filter((k) => prev[k] !== state[k]);
      if (!changed.length) return;
      if (++depth > 20) { depth--; console.error('[GeoScape] 상태 갱신이 반복되어 중단했습니다.', patch); return; }
      try {
        for (const fn of [...listeners]) {
          try { fn(state, prev, changed); } catch (err) { onError ? onError(err) : console.error(err); }
        }
      } finally { depth--; }
    },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  };
}
