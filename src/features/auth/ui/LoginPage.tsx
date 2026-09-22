import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import Button from "@/shared/ui/Button";
import TextInput from "@/shared/ui/TextInput";
import Select from "@/shared/ui/Select";
import { EyeLine, EyeCloseLine } from "@mingcute/react";
import { useTheme } from "next-themes";
import WindowControls from "@/features/navigation/ui/WindowControls";
import { getBrandLogo } from "@/assets/branding";
import { getAuraColor } from "@/assets/branding/aura";
import { usePlayerStore } from "@/features/player";
import cloudsBanner from "@/assets/wallhaven-5g1yz8.jpg";
import CircleDitherCanvas from "@/shared/ui/CircleDitherCanvas";
import AppImage from "@/features/covers/ui/AppImage";
import {
  authErrorMessage,
  getAuthErrorCode,
  useAuthStore,
} from "../store/authStore";
import { useTranslation, LOCALE_OPTIONS } from "@/languages";

const USERNAME_RE = /^[a-z0-9_]{3,30}$/;

export default function LoginPage() {
  const navigate = useNavigate();
  const login = useAuthStore((state) => state.login);
  const register = useAuthStore((state) => state.register);
  const enterGuest = useAuthStore((state) => state.enterGuest);
  const { locale, setLocale, t } = useTranslation();
  const { resolvedTheme, theme } = useTheme();
  const accentVariant = usePlayerStore((state) => state.accentVariant);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const selectMode = (next: "login" | "register") => {
    if (submitting || next === mode) return;
    setMode(next);
    setError("");
    setConfirmPassword("");
  };

  const resolveErrorMessage = (nextError: unknown): string => {
    const code = getAuthErrorCode(nextError);
    if (code === "server_unavailable")
      return t("login.errors.server_unavailable");
    if (code === "invalid_credentials")
      return t("login.errors.invalid_credentials");
    if (code === "username_taken")
      return t("login.errors.username_taken");
    if (code === "invalid_username")
      return t("login.errors.username_invalid");
    return authErrorMessage(nextError);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;

    if (mode === "login") {
      const normalizedUsername = username.trim().toLowerCase();
      if (!normalizedUsername) {
        setError(t("login.errors.username_invalid"));
        return;
      }
      if (!password) {
        setError(t("login.errors.password_min_8"));
        return;
      }
      setSubmitting(true);
      setError("");
      try {
        await login(normalizedUsername, password);
        navigate("/", { replace: true });
      } catch (nextError) {
        setError(resolveErrorMessage(nextError));
      } finally {
        setSubmitting(false);
      }
      return;
    }

    // mode === "register"
    const normalizedUsername = username.trim().toLowerCase();
    const cleanDisplayName = displayName.trim();

    if (!USERNAME_RE.test(normalizedUsername)) {
      setError(t("login.errors.username_invalid"));
      return;
    }
    if (password.length < 8) {
      setError(t("login.errors.password_min_8"));
      return;
    }
    if (password !== confirmPassword) {
      setError(t("login.errors.password_mismatch"));
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      await register(
        normalizedUsername,
        password,
        cleanDisplayName || normalizedUsername,
      );
      navigate("/", { replace: true });
    } catch (nextError) {
      setError(resolveErrorMessage(nextError));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="page-transition relative flex h-full w-full items-center justify-center overflow-hidden rounded-5xl border border-border-primary bg-bg-primary">
      {/* Full background circle-dither canvas */}
      <div className="absolute inset-0 z-0 select-none overflow-hidden rounded-5xl">
        <CircleDitherCanvas
          src={cloudsBanner}
          alt="Clouds Dither Background"
          dotSize={7}
          gap={0.5}
          edgePadding={1.5}
          cornerRadius={12}
          gridType="square"
          objectFit="cover"
          className="h-full w-full rounded-5xl overflow-hidden"
        />
      </div>

      <WindowControls variant="glass" />

      {/* Centered solid panel in new app style — bg stays visible around it */}
      <section className="relative z-10 mx-4 my-auto flex max-h-[calc(100%-48px)] w-full max-w-[400px] flex-col overflow-y-auto rounded-xl border border-border-primary bg-bg-panel p-[28px]">
        <div className="flex min-h-full w-full flex-col justify-between">
          {/* Top: logo + lang picker */}
          <div className="flex shrink-0 items-center gap-[10px]">
            <div
              className="flex items-center justify-center rounded-full"
              style={{
                boxShadow: `0 0 32px 8px ${getAuraColor(accentVariant)}cc, 0 0 70px 20px ${getAuraColor(accentVariant)}88`,
              }}
            >
              <AppImage
                src={getBrandLogo("default", (resolvedTheme || theme) === "dark")}
                alt="Aegis"
                width={25}
                height={30}
                className="h-[22px] w-auto"
                priority
              />
            </div>
            <span className="text-[16px] font-[600] tracking-[-0.025em] text-text-primary">
              Aegis
            </span>
            <Select
              options={LOCALE_OPTIONS}
              value={locale}
              onChange={setLocale}
              align="bottom-right"
              variant="transparent"
              className="ml-auto"
              aria-label={t("login.select_language")}
            />
          </div>

          {/* Middle: grows + centers form content */}
          <div className="my-auto flex flex-col justify-center py-6">
            <div className="w-full">
              {/* mode switch, same segmented pattern as create-playlist tabs */}
              <div className="mb-[16px] flex rounded-lg bg-bg-elevated p-[3px]">
                {(
                  [
                    { id: "login", label: t("login.btn_sign_in") },
                    { id: "register", label: t("login.btn_create_account") },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => selectMode(item.id)}
                    className={`h-[30px] flex-1 cursor-pointer rounded-md border-none text-[13px] font-[500] transition-all ${
                      mode === item.id
                        ? "bg-bg-primary text-text-primary"
                        : "bg-transparent text-text-secondary hover:text-text-primary"
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <h1
                className="m-0 text-[22px] font-[600] leading-tight tracking-[-0.02em] text-text-primary"
                style={{ textWrap: "balance" }}
              >
                {mode === "login"
                  ? t("login.auth_title_login")
                  : t("login.auth_title_register")}
              </h1>
              <p
                className="m-0 mt-[6px] text-[13px] font-[400] leading-[1.5] text-text-secondary"
                style={{ textWrap: "pretty" }}
              >
                {mode === "login"
                  ? t("login.auth_subtitle_login")
                  : t("login.auth_subtitle_register")}
              </p>

              <form onSubmit={submit} className="mt-[20px] flex flex-col">
                <label
                  className="mb-[7px] text-[12px] font-[500] text-text-secondary"
                  htmlFor="auth-username"
                >
                  {t("login.label_username")}
                </label>
                <TextInput
                  id="auth-username"
                  autoFocus
                  type="text"
                  autoCapitalize="none"
                  spellCheck={false}
                  autoComplete="username"
                  placeholder={t("login.placeholder_username")}
                  value={username}
                  icon={
                    <span className="text-[14px] font-medium text-text-tertiary select-none">
                      @
                    </span>
                  }
                  hasError={Boolean(error)}
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? "auth-form-error" : undefined}
                  onChange={(event) => {
                    setUsername(
                      event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""),
                    );
                    if (error) setError("");
                  }}
                  disabled={submitting}
                />

                <AnimatePresence initial={false}>
                  {mode === "register" && (
                    <motion.div
                      key="register-extra-fields"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{
                        duration: 0.18,
                        ease: [0.22, 1, 0.36, 1],
                      }}
                      className="overflow-hidden"
                    >
                      <label
                        className="mb-[7px] mt-[15px] block text-[12px] font-[500] text-text-secondary"
                        htmlFor="auth-display-name"
                      >
                        {t("login.label_display_name")}
                      </label>
                      <TextInput
                        id="auth-display-name"
                        type="text"
                        autoComplete="name"
                        placeholder={t("login.placeholder_display_name")}
                        value={displayName}
                        hasError={Boolean(error)}
                        aria-invalid={Boolean(error)}
                        aria-describedby={error ? "auth-form-error" : undefined}
                        onChange={(event) => {
                          setDisplayName(event.target.value);
                          if (error) setError("");
                        }}
                        disabled={submitting}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>

                <label
                  className="mb-[7px] mt-[15px] text-[12px] font-[500] text-text-secondary"
                  htmlFor="auth-password"
                >
                  {t("login.label_password")}
                </label>
                <TextInput
                  id="auth-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete={
                    mode === "login" ? "current-password" : "new-password"
                  }
                  placeholder={
                    mode === "login"
                      ? t("login.placeholder_password")
                      : t("login.placeholder_password_new")
                  }
                  value={password}
                  hasError={Boolean(error)}
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? "auth-form-error" : undefined}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    if (error) setError("");
                  }}
                  disabled={submitting}
                  rightSlot={
                    <button
                      type="button"
                      aria-label={
                        showPassword
                          ? t("login.hide_password")
                          : t("login.show_password")
                      }
                      onClick={() => setShowPassword((v) => !v)}
                      className="flex h-7 w-7 items-center justify-center rounded-sm text-text-tertiary transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-text-secondary cursor-pointer"
                    >
                      {showPassword ? (
                        <EyeCloseLine className="h-4 w-4" />
                      ) : (
                        <EyeLine className="h-4 w-4" />
                      )}
                    </button>
                  }
                />

                <AnimatePresence initial={false}>
                  {mode === "register" && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{
                        duration: 0.18,
                        ease: [0.22, 1, 0.36, 1],
                      }}
                      className="overflow-hidden"
                    >
                      <label
                        className="mb-[7px] mt-[15px] block text-[12px] font-[500] text-text-secondary"
                        htmlFor="auth-confirm"
                      >
                        {t("login.label_confirm_password")}
                      </label>
                      <TextInput
                        id="auth-confirm"
                        type={showConfirmPassword ? "text" : "password"}
                        autoComplete="new-password"
                        placeholder={t("login.placeholder_confirm")}
                        value={confirmPassword}
                        hasError={Boolean(error)}
                        aria-invalid={Boolean(error)}
                        aria-describedby={error ? "auth-form-error" : undefined}
                        onChange={(event) => {
                          setConfirmPassword(event.target.value);
                          if (error) setError("");
                        }}
                        disabled={submitting}
                        rightSlot={
                          <button
                            type="button"
                            aria-label={
                              showConfirmPassword
                                ? t("login.hide_password")
                                : t("login.show_password")
                            }
                            onClick={() => setShowConfirmPassword((v) => !v)}
                            className="flex h-7 w-7 items-center justify-center rounded-sm text-text-tertiary transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-text-secondary cursor-pointer"
                          >
                            {showConfirmPassword ? (
                              <EyeCloseLine className="h-4 w-4" />
                            ) : (
                              <EyeLine className="h-4 w-4" />
                            )}
                          </button>
                        }
                      />
                    </motion.div>
                  )}
                </AnimatePresence>

                <div className="min-h-[22px] py-[6px]">
                  <AnimatePresence mode="wait" initial={false}>
                    {error && (
                      <motion.p
                        key={error}
                        id="auth-form-error"
                        role="alert"
                        initial={{ opacity: 0, y: -3 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        className="m-0 text-[12px] font-[500] leading-[1.4] text-accent-primary"
                      >
                        {error}
                      </motion.p>
                    )}
                  </AnimatePresence>
                </div>

                <Button
                  type="submit"
                  disabled={submitting}
                  className="mt-[2px] w-full"
                >
                  {submitting ? (
                    mode === "login" ? (
                      <>
                        <span className="h-[14px] w-[14px] animate-spin rounded-full border-2 border-current border-t-transparent" />
                        <span>{t("login.btn_signing_in")}</span>
                      </>
                    ) : (
                      <>
                        <span className="h-[14px] w-[14px] animate-spin rounded-full border-2 border-current border-t-transparent" />
                        <span>{t("login.btn_creating_account")}</span>
                      </>
                    )
                  ) : mode === "login" ? (
                    t("login.btn_sign_in")
                  ) : (
                    t("login.btn_create_account")
                  )}
                </Button>
              </form>

              {/* Guest access — browse without an account */}
              <div
                className="mt-[18px] flex items-center gap-[10px]"
                aria-hidden
              >
                <span className="h-px flex-1 bg-border-primary" />
                <span className="text-[11px] font-[500] tracking-wide text-text-tertiary">
                  {t("login.separator_or")}
                </span>
                <span className="h-px flex-1 bg-border-primary" />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mt-[10px] w-full"
                onClick={() => {
                  enterGuest();
                  navigate("/", { replace: true });
                }}
              >
                {t("login.btn_guest")}
              </Button>
            </div>
          </div>

          {/* Bottom: legal warning */}
          <p className="m-0 shrink-0 text-center text-[11px] leading-[1.5] text-text-tertiary">
            {t("login.legal")}{" "}
            <a
              href="https://tryliner.fun/terms"
              target="_blank"
              rel="noreferrer"
              className="text-text-secondary underline underline-offset-2 hover:text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-text-primary rounded-xs transition-colors"
            >
              {t("login.legal_tos")}
            </a>{" "}
            {t("login.legal_and")}{" "}
            <a
              href="https://tryliner.fun/privacy"
              target="_blank"
              rel="noreferrer"
              className="text-text-secondary underline underline-offset-2 hover:text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-text-primary rounded-xs transition-colors"
            >
              {t("login.legal_pp")}
            </a>
            .
          </p>
        </div>
      </section>
    </main>
  );
}