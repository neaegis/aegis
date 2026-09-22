import { create } from "zustand";
import { ApiError } from "@/shared/api";
import {
  clearAuthSession,
  getAuthSession,
  setAuthSession,
  type AuthTokens,
  type AuthUser,
  type PublicUser,
  type UpdateProfileInput,
} from "@/shared/api";
import { aegisDb, type LocalUserRecord } from "@/shared/storage/aegisDb";
import { hashPassword, verifyPassword } from "@/shared/auth/passwords";
import { rehydrateUserScopedStores } from "@/shared/utils/userScope";

export type AuthStatus = "initializing" | "authenticated" | "guest" | "anonymous";

export const GUEST_USER: AuthUser = {
  id: "guest",
  username: "guest",
  displayName: "Guest",
};

const GUEST_MODE_KEY = "liner_guest_mode";
const USERNAME_RE = /^[a-z0-9_]{3,30}$/;
const MIN_PASSWORD_LENGTH = 8;

function isGuestModeSaved(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(GUEST_MODE_KEY) === "1";
  } catch {
    return false;
  }
}

function saveGuestMode(on: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (on) localStorage.setItem(GUEST_MODE_KEY, "1");
    else localStorage.removeItem(GUEST_MODE_KEY);
  } catch {
    // ignore storage failures
  }
}

function toPublicUser(record: LocalUserRecord): PublicUser {
  return {
    id: record.id,
    username: record.username,
    displayName: record.displayName,
    avatarUrl: record.avatarUrl ?? null,
    bio: record.bio ?? null,
    isPublic: record.isPublic,
  };
}

function buildLocalSession(user: PublicUser): AuthTokens {
  return {
    accessToken: `local:${user.id}`,
    refreshToken: "",
    accessTokenExpiresAt: "2099-12-31T23:59:59.999Z",
    user,
  };
}

function switchAccount() {
  rehydrateUserScopedStores();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("library:changed"));
  }
}

function newLocalUserId(): string {
  const suffix =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  return `local_${suffix}`;
}

export type AuthState = {
  status: AuthStatus;
  user: AuthUser | null;
  initialize: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  register: (
    username: string,
    password: string,
    displayName?: string,
  ) => Promise<void>;
  enterGuest: () => void;
  updateProfile: (patch: UpdateProfileInput) => Promise<PublicUser>;
  logout: () => Promise<void>;
};

export const useAuthStore = create<AuthState>((set) => ({
  status: "initializing",
  user: null,
  initialize: async () => {
    const stored = getAuthSession();
    if (!stored) {
      if (isGuestModeSaved()) {
        set({ status: "guest", user: GUEST_USER });
      } else {
        set({ status: "anonymous", user: null });
      }
      return;
    }
    set({ status: "authenticated", user: stored.user ?? null });
  },
  login: async (username, password) => {
    const normalized = username.trim().toLowerCase();
    if (!normalized || !password) {
      throw new ApiError(400, "Username or password is incorrect.", "INVALID_CREDENTIALS");
    }
    const record = await aegisDb.getUserByUsername(normalized);
    if (!record) {
      throw new ApiError(400, "Username or password is incorrect.", "INVALID_CREDENTIALS");
    }
    const ok = await verifyPassword(password, record.passwordHash);
    if (!ok) {
      throw new ApiError(400, "Username or password is incorrect.", "INVALID_CREDENTIALS");
    }
    saveGuestMode(false);
    const user = toPublicUser(record);
    setAuthSession(buildLocalSession(user));
    set({ status: "authenticated", user });
    switchAccount();
  },
  register: async (username, password, displayName) => {
    const normalizedUsername = username.trim().toLowerCase();
    if (!USERNAME_RE.test(normalizedUsername)) {
      throw new ApiError(
        400,
        "Username must be 3-30 lowercase characters (a-z, 0-9, _).",
        "INVALID_USERNAME",
      );
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new ApiError(
        400,
        "Password must contain at least 8 characters.",
        "INVALID_INPUT",
      );
    }
    const existing = await aegisDb.getUserByUsername(normalizedUsername);
    if (existing) {
      throw new ApiError(
        409,
        "This username is already taken. Please choose another.",
        "USERNAME_TAKEN",
      );
    }
    const cleanDisplayName = displayName?.trim() || normalizedUsername;
    const passwordHash = await hashPassword(password);
    const record: LocalUserRecord = {
      id: newLocalUserId(),
      username: normalizedUsername,
      displayName: cleanDisplayName,
      passwordHash,
      isPublic: true,
      createdAt: Date.now(),
    };
    await aegisDb.putUser(record);
    saveGuestMode(false);
    const user = toPublicUser(record);
    setAuthSession(buildLocalSession(user));
    set({ status: "authenticated", user });
    switchAccount();
  },
  enterGuest: () => {
    saveGuestMode(true);
    set({ status: "guest", user: GUEST_USER });
    switchAccount();
  },
  updateProfile: async (patch) => {
    const current = getAuthSession();
    const userId = current?.user?.id;
    if (!userId || userId === GUEST_USER.id) {
      return patch as PublicUser;
    }
    const updated = await aegisDb.updateUser(userId, {
      ...patch,
      displayName: patch.displayName ?? undefined,
    });
    const user = updated ? toPublicUser(updated) : (patch as PublicUser);
    if (current) {
      setAuthSession({ ...current, user: { ...current.user, ...user } });
    }
    set((prev) => ({
      user: prev.user ? { ...prev.user, ...user } : user,
    }));
    return { ...(current?.user ?? {}), ...user } as PublicUser;
  },
  logout: async () => {
    await clearAuthSession();
    saveGuestMode(false);
    set({ status: "anonymous", user: null });
    switchAccount();
  },
}));

export function getAuthErrorCode(error: unknown): string {
  if (!(error instanceof ApiError)) return "server_unavailable";
  if (error.code === "INVALID_CREDENTIALS") return "invalid_credentials";
  if (error.code === "USERNAME_TAKEN") return "username_taken";
  if (error.code === "INVALID_USERNAME") return "invalid_username";
  if (error.code === "INVALID_INPUT") return "invalid_input";
  return "unknown_error";
}

export function authErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return "Unable to reach the server.";
  if (error.code === "INVALID_CREDENTIALS")
    return "Username or password is incorrect.";
  if (error.code === "USERNAME_TAKEN")
    return "This username is already taken. Please choose another.";
  if (error.code === "INVALID_USERNAME")
    return "Username must be 3-30 lowercase characters (a-z, 0-9, _).";
  return "Something went wrong. Please try again.";
}