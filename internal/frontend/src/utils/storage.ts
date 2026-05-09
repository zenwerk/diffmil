export function loadFromStorage<T>(
  key: string,
  validate: (raw: string) => T | undefined,
  fallback: T,
): T {
  try {
    const stored = localStorage.getItem(key);
    if (stored !== null) {
      const value = validate(stored);
      if (value !== undefined) return value;
    }
  } catch {
    // ignore
  }
  return fallback;
}

export function saveToStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}
