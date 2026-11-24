/** Kênh báo "phiên nhân viên quán đã kết thúc" (401 từ api-client) để app điều hướng về màn đăng nhập. */
export interface SessionEvents {
  onSignedOut(listener: () => void): () => void;
  emitSignedOut(): void;
}

export function createSessionEvents(): SessionEvents {
  const listeners = new Set<() => void>();
  return {
    onSignedOut(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emitSignedOut() {
      for (const listener of listeners) listener();
    },
  };
}
