import { getAuthSession } from "@/shared/api/auth-session";
import { debouncedStorage, flushPendingStorageWrite } from "./storage";

function currentUserId(): string {
  const session = getAuthSession();
  return session?.user?.id ?? "guest";
}

export function userScopedKey(key: string): string {
  return `u:${currentUserId()}:${key}`;
}

export const userScopedStorage = {
  getItem: (name: string) => debouncedStorage.getItem(userScopedKey(name)),
  setItem: (name: string, value: string) =>
    debouncedStorage.setItem(userScopedKey(name), value),
  removeItem: (name: string) => debouncedStorage.removeItem(userScopedKey(name)),
};

const rehydrateFns = new Set<() => void>();

export function registerUserScopedRehydrate(fn: () => void): void {
  rehydrateFns.add(fn);
}

export function rehydrateUserScopedStores(): void {
  flushPendingStorageWrite();
  rehydrateFns.forEach((fn) => {
    try {
      fn();
    } catch {
      // ignore rehydrate failures during account switches
    }
  });
}