// 간단한 전역 상태 저장소 (구독형)
export function createStore(initial) {
  let state = { ...initial };
  const listeners = new Set();
  return {
    get: () => state,
    set(patch) {
      const prev = state;
      state = { ...state, ...patch };
      const changed = Object.keys(patch).filter((k) => prev[k] !== state[k]);
      if (changed.length) listeners.forEach((fn) => fn(state, prev, changed));
    },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  };
}
