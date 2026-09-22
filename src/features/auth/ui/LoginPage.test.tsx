import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, Root } from "react-dom/client";
import { act } from "react";
import LoginPage from "./LoginPage";

const mockNavigate = vi.fn();
const mockLogin = vi.fn();
const mockRegister = vi.fn();
const mockEnterGuest = vi.fn();

vi.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: any) => <>{children}</>,
  motion: {
    div: ({ children, className, style, ...props }: any) => (
      <div className={className} style={style} {...props}>
        {children}
      </div>
    ),
    p: ({ children, className, style, ...props }: any) => (
      <p className={className} style={style} {...props}>
        {children}
      </p>
    ),
  },
}));

vi.mock("../store/authStore", () => ({
  useAuthStore: (selector: any) =>
    selector({
      login: mockLogin,
      register: mockRegister,
      enterGuest: mockEnterGuest,
      status: "anonymous",
      user: null,
    }),
  getAuthErrorCode: (err: any) => (err?.code ? err.code.toLowerCase() : "server_unavailable"),
  authErrorMessage: (err: any) => err?.message || "An error occurred",
}));

vi.mock("@/languages", () => {
  const translations: Record<string, string> = {
    "login.auth_title_login": "Your music, your way",
    "login.auth_subtitle_login": "Sign in and pick up right where you left off.",
    "login.auth_title_register": "Join Aegis",
    "login.auth_subtitle_register": "Create an account and start building your personal library.",
    "login.label_username": "Username",
    "login.placeholder_username": "soundwave",
    "login.label_display_name": "Display Name",
    "login.placeholder_display_name": "Your name or alias",
    "login.label_password": "Password",
    "login.label_confirm_password": "Confirm password",
    "login.placeholder_password": "Your password",
    "login.placeholder_password_new": "At least 8 characters",
    "login.placeholder_confirm": "Repeat your password",
    "login.btn_sign_in": "Sign in",
    "login.btn_signing_in": "Signing in…",
    "login.btn_create_account": "Create account",
    "login.btn_creating_account": "Creating account…",
    "login.btn_guest": "Browse as guest",
    "login.separator_or": "or",
    "login.legal": "By continuing, you agree to the",
    "login.legal_tos": "Terms of Service",
    "login.legal_and": "and",
    "login.legal_pp": "Privacy Policy",
    "login.errors.password_min_8": "Password must contain at least 8 characters.",
    "login.errors.password_mismatch": "Passwords do not match.",
    "login.errors.username_invalid": "Username must be 3-30 lowercase letters, numbers, or underscores.",
    "login.errors.username_taken": "This username is already taken. Please choose another.",
  };

  return {
    LOCALE_OPTIONS: [
      { value: "en", label: "English" },
      { value: "ru", label: "Русский" },
    ],
    useTranslation: () => ({
      locale: "en",
      setLocale: vi.fn(),
      t: (key: string, params?: Record<string, any>) => {
        let str = translations[key] || key;
        if (params) {
          Object.entries(params).forEach(([k, v]) => {
            str = str.replace(`{${k}}`, String(v));
          });
        }
        return str;
      },
    }),
  };
});

vi.mock("@/shared/ui/CircleDitherCanvas", () => ({
  default: () => <div data-testid="dither-canvas" />,
}));

vi.mock("@/features/navigation/ui/WindowControls", () => ({
  default: () => <div data-testid="window-controls" />,
}));

vi.mock("react-apple-emojis", () => ({
  Emoji: () => <span data-testid="emoji" />,
}));

vi.mock("@/features/player", () => ({
  usePlayerStore: (selector: any) => selector({ accentVariant: "violet" }),
}));

function fillInput(container: HTMLElement, id: string, value: string) {
  const input = container.querySelector(`#${id}`) as HTMLInputElement;
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  nativeInputValueSetter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  return input;
}

describe("LoginPage Local Account Flow", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
  });

  it("renders in Login mode by default with username + password", async () => {
    await act(async () => {
      root.render(<LoginPage />);
    });

    expect(container.querySelector("#auth-username")).not.toBeNull();
    expect(container.querySelector("#auth-password")).not.toBeNull();
    expect(container.querySelector("#auth-confirm")).toBeNull();
    expect(container.querySelector("#auth-display-name")).toBeNull();
    expect(container.querySelector("#auth-email")).toBeNull();

    const buttons = Array.from(container.querySelectorAll("button"));
    const createAccBtn = buttons.find((b) => b.textContent?.includes("Create account"));
    expect(createAccBtn).toBeDefined();
  });

  it("switches to Register showing all fields in a single step", async () => {
    await act(async () => {
      root.render(<LoginPage />);
    });

    const createAccBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Create account"),
    );
    await act(async () => {
      createAccBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.querySelector("#auth-username")).not.toBeNull();
    expect(container.querySelector("#auth-display-name")).not.toBeNull();
    expect(container.querySelector("#auth-password")).not.toBeNull();
    expect(container.querySelector("#auth-confirm")).not.toBeNull();
  });

  it("signs in with username and password", async () => {
    mockLogin.mockResolvedValueOnce(undefined);
    await act(async () => {
      root.render(<LoginPage />);
    });

    fillInput(container, "auth-username", "alice");
    fillInput(container, "auth-password", "password123");

    const form = container.querySelector("form");
    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(mockLogin).toHaveBeenCalledWith("alice", "password123");
    expect(mockNavigate).toHaveBeenCalledWith("/", { replace: true });
  });

  it("rejects a login submit with an empty username", async () => {
    await act(async () => {
      root.render(<LoginPage />);
    });

    const form = container.querySelector("form");
    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(mockLogin).not.toHaveBeenCalled();
    expect(container.querySelector("#auth-form-error")?.textContent).toContain(
      "Username must be 3-30",
    );
  });

  it("validates register fields before submitting", async () => {
    await act(async () => {
      root.render(<LoginPage />);
    });

    const createAccBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Create account"),
    );
    await act(async () => {
      createAccBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const form = container.querySelector("form");

    // Invalid short username
    fillInput(container, "auth-username", "a");
    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(container.querySelector("#auth-form-error")?.textContent).toContain(
      "Username must be 3-30",
    );
    expect(mockRegister).not.toHaveBeenCalled();

    // Valid username, short password
    fillInput(container, "auth-username", "bob_sound");
    fillInput(container, "auth-password", "abc");
    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(container.querySelector("#auth-form-error")?.textContent).toContain(
      "at least 8 characters",
    );

    // Matching passwords but short? force mismatch case too
    fillInput(container, "auth-password", "password123");
    fillInput(container, "auth-confirm", "different");
    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(container.querySelector("#auth-form-error")?.textContent).toContain(
      "Passwords do not match",
    );
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it("submits a valid registration", async () => {
    mockRegister.mockResolvedValueOnce(undefined);
    await act(async () => {
      root.render(<LoginPage />);
    });

    const createAccBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Create account"),
    );
    await act(async () => {
      createAccBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    fillInput(container, "auth-username", "carol_sound");
    fillInput(container, "auth-display-name", "Carol Music");
    fillInput(container, "auth-password", "password123");
    fillInput(container, "auth-confirm", "password123");

    const form = container.querySelector("form");
    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(mockRegister).toHaveBeenCalledWith(
      "carol_sound",
      "password123",
      "Carol Music",
    );
    expect(mockNavigate).toHaveBeenCalledWith("/", { replace: true });
  });

  it("enters guest mode when clicking Browse as guest", async () => {
    await act(async () => {
      root.render(<LoginPage />);
    });

    const guestBtn = Array.from(
      container.querySelectorAll("button"),
    ).find((b) => b.textContent?.includes("Browse as guest"));
    expect(guestBtn).toBeDefined();

    await act(async () => {
      guestBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(mockEnterGuest).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith("/", { replace: true });
  });
});