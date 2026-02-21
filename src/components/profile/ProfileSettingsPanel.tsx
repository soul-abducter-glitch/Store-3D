"use client";

import { useEffect, useMemo, useState } from "react";
import { Eye, EyeOff, LockKeyhole } from "lucide-react";
import { toast } from "sonner";
import {
  normalizeTrimmedText,
  validateAccountName,
  validateDefaultShippingAddress,
  validateNewAccountPassword,
} from "@/lib/accountValidation";

type AccountProfile = {
  name: string;
  email: string;
  emailVerified: boolean | null;
  defaultShippingAddress: string;
};

type PasswordForm = {
  currentPassword: string;
  newPassword: string;
  confirmNewPassword: string;
};

const EMPTY_PASSWORD_FORM: PasswordForm = {
  currentPassword: "",
  newPassword: "",
  confirmNewPassword: "",
};

const readJson = async (response: Response) => {
  try {
    return await response.json();
  } catch {
    return null;
  }
};

export default function ProfileSettingsPanel() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [profileInitial, setProfileInitial] = useState<AccountProfile | null>(null);
  const [profileName, setProfileName] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileErrors, setProfileErrors] = useState<{ name?: string; form?: string }>({});

  const [addressInitial, setAddressInitial] = useState("");
  const [addressValue, setAddressValue] = useState("");
  const [addressSaving, setAddressSaving] = useState(false);
  const [addressErrors, setAddressErrors] = useState<{ value?: string; form?: string }>({});

  const [passwordOpen, setPasswordOpen] = useState(false);
  const [passwordForm, setPasswordForm] = useState<PasswordForm>(EMPTY_PASSWORD_FORM);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordErrors, setPasswordErrors] = useState<{
    currentPassword?: string;
    newPassword?: string;
    confirmNewPassword?: string;
    form?: string;
  }>({});
  const [showPassword, setShowPassword] = useState({
    currentPassword: false,
    newPassword: false,
    confirmNewPassword: false,
  });
  const [passwordSubmitted, setPasswordSubmitted] = useState(false);

  const profileNameClientError = validateAccountName(profileName);
  const profileDirty = useMemo(() => {
    if (!profileInitial) return false;
    return normalizeTrimmedText(profileName) !== normalizeTrimmedText(profileInitial.name);
  }, [profileInitial, profileName]);

  const addressClientError = validateDefaultShippingAddress(addressValue);
  const addressDirty = useMemo(
    () => normalizeTrimmedText(addressValue) !== normalizeTrimmedText(addressInitial),
    [addressInitial, addressValue]
  );

  const passwordDirty = useMemo(
    () =>
      Boolean(
        passwordForm.currentPassword || passwordForm.newPassword || passwordForm.confirmNewPassword
      ),
    [passwordForm]
  );

  const hasUnsavedChanges = profileDirty || addressDirty || (passwordOpen && passwordDirty);

  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [hasUnsavedChanges]);

  const loadProfile = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch("/api/account/profile", {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });
      const data = await readJson(response);
      if (!response.ok || !data?.profile) {
        throw new Error("Не удалось загрузить профиль.");
      }

      const profile: AccountProfile = {
        name: typeof data.profile.name === "string" ? data.profile.name : "",
        email: typeof data.profile.email === "string" ? data.profile.email : "",
        emailVerified:
          typeof data.profile.emailVerified === "boolean" ? data.profile.emailVerified : null,
        defaultShippingAddress:
          typeof data.profile.defaultShippingAddress === "string"
            ? data.profile.defaultShippingAddress
            : "",
      };

      setProfileInitial(profile);
      setProfileName(profile.name);
      setAddressInitial(profile.defaultShippingAddress);
      setAddressValue(profile.defaultShippingAddress);
      setProfileErrors({});
      setAddressErrors({});
    } catch (error) {
      const message =
        error instanceof Error && error.message ? error.message : "Не удалось загрузить профиль.";
      setLoadError(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadProfile();
  }, []);

  const handleProfileSave = async () => {
    if (!profileDirty || profileSaving || !profileInitial) {
      return;
    }

    if (profileNameClientError) {
      setProfileErrors({ name: profileNameClientError });
      return;
    }

    setProfileSaving(true);
    setProfileErrors({});
    try {
      const response = await fetch("/api/account/profile", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: normalizeTrimmedText(profileName) }),
      });
      const data = await readJson(response);
      if (!response.ok) {
        const fieldError =
          typeof data?.fieldErrors?.name === "string" ? data.fieldErrors.name : undefined;
        const formError =
          typeof data?.error === "string" && data.error !== "validation_error"
            ? data.error
            : "Не удалось сохранить изменения. Повторите попытку.";
        setProfileErrors({
          ...(fieldError ? { name: fieldError } : {}),
          form: fieldError ? undefined : formError,
        });
        return;
      }

      const nextProfile: AccountProfile = {
        name:
          typeof data?.profile?.name === "string"
            ? data.profile.name
            : normalizeTrimmedText(profileName),
        email: profileInitial.email,
        emailVerified:
          typeof data?.profile?.emailVerified === "boolean"
            ? data.profile.emailVerified
            : profileInitial.emailVerified,
        defaultShippingAddress: profileInitial.defaultShippingAddress,
      };

      setProfileInitial(nextProfile);
      setProfileName(nextProfile.name);
      setProfileErrors({});
      toast.success("Профиль сохранён");
    } catch {
      setProfileErrors({ form: "Не удалось сохранить изменения. Повторите попытку." });
    } finally {
      setProfileSaving(false);
    }
  };

  const handleAddressSave = async () => {
    if (!addressDirty || addressSaving) {
      return;
    }

    if (addressClientError) {
      setAddressErrors({ value: addressClientError });
      return;
    }

    setAddressSaving(true);
    setAddressErrors({});
    try {
      const response = await fetch("/api/account/profile", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defaultShippingAddress: normalizeTrimmedText(addressValue) }),
      });
      const data = await readJson(response);
      if (!response.ok) {
        const fieldError =
          typeof data?.fieldErrors?.defaultShippingAddress === "string"
            ? data.fieldErrors.defaultShippingAddress
            : undefined;
        setAddressErrors({
          ...(fieldError ? { value: fieldError } : {}),
          form:
            fieldError || !data?.error
              ? undefined
              : "Не удалось сохранить адрес. Повторите попытку.",
        });
        return;
      }

      const nextAddress =
        typeof data?.profile?.defaultShippingAddress === "string"
          ? data.profile.defaultShippingAddress
          : normalizeTrimmedText(addressValue);

      setAddressInitial(nextAddress);
      setAddressValue(nextAddress);
      if (profileInitial) {
        setProfileInitial({ ...profileInitial, defaultShippingAddress: nextAddress });
      }
      setAddressErrors({});
      toast.success("Адрес сохранён");
    } catch {
      setAddressErrors({ form: "Не удалось сохранить адрес. Повторите попытку." });
    } finally {
      setAddressSaving(false);
    }
  };

  const validatePasswordForm = () => {
    const errors: typeof passwordErrors = {};
    if (!passwordForm.currentPassword) {
      errors.currentPassword = "Введите текущий пароль";
    }
    const newPasswordError = validateNewAccountPassword(passwordForm.newPassword);
    if (newPasswordError) {
      errors.newPassword = newPasswordError;
    }
    if (passwordForm.confirmNewPassword !== passwordForm.newPassword) {
      errors.confirmNewPassword = "Пароли не совпадают";
    }
    return errors;
  };

  const passwordClientErrors = validatePasswordForm();
  const passwordHasClientErrors =
    Boolean(passwordClientErrors.currentPassword) ||
    Boolean(passwordClientErrors.newPassword) ||
    Boolean(passwordClientErrors.confirmNewPassword);

  const resetPasswordSection = () => {
    setPasswordForm(EMPTY_PASSWORD_FORM);
    setPasswordErrors({});
    setPasswordSubmitted(false);
    setShowPassword({
      currentPassword: false,
      newPassword: false,
      confirmNewPassword: false,
    });
    setPasswordOpen(false);
  };

  const handleChangePassword = async () => {
    if (passwordSaving || !passwordDirty) {
      return;
    }

    setPasswordSubmitted(true);
    const nextErrors = validatePasswordForm();
    if (Object.keys(nextErrors).length > 0) {
      setPasswordErrors(nextErrors);
      return;
    }

    setPasswordSaving(true);
    setPasswordErrors({});
    try {
      const response = await fetch("/api/account/change-password", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(passwordForm),
      });
      const data = await readJson(response);
      if (!response.ok) {
        setPasswordErrors({
          currentPassword:
            typeof data?.fieldErrors?.currentPassword === "string"
              ? data.fieldErrors.currentPassword
              : undefined,
          newPassword:
            typeof data?.fieldErrors?.newPassword === "string"
              ? data.fieldErrors.newPassword
              : undefined,
          confirmNewPassword:
            typeof data?.fieldErrors?.confirmNewPassword === "string"
              ? data.fieldErrors.confirmNewPassword
              : undefined,
          form:
            typeof data?.error === "string" && data.error !== "validation_error"
              ? data.error
              : "Не удалось изменить пароль. Повторите попытку.",
        });
        return;
      }

      toast.success("Пароль изменён");
      resetPasswordSection();
    } catch {
      setPasswordErrors({ form: "Не удалось изменить пароль. Повторите попытку." });
    } finally {
      setPasswordSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-[24px] border border-white/5 bg-white/[0.03] p-8 text-sm text-white/60 backdrop-blur-xl">
        Загружаем настройки...
      </div>
    );
  }

  if (loadError || !profileInitial) {
    return (
      <div className="rounded-[24px] border border-red-500/25 bg-red-500/10 p-8 text-sm text-red-100 backdrop-blur-xl">
        <p>{loadError || "Не удалось загрузить настройки."}</p>
        <button
          type="button"
          onClick={() => void loadProfile()}
          className="mt-4 rounded-full border border-red-300/35 px-4 py-2 text-[10px] uppercase tracking-[0.24em] text-red-100 transition hover:bg-red-500/20"
        >
          Повторить
        </button>
      </div>
    );
  }

  const shouldShowProfileNameError =
    Boolean(profileErrors.name) || normalizeTrimmedText(profileName).length > 0;
  const resolvedProfileNameError =
    profileErrors.name ?? (shouldShowProfileNameError ? profileNameClientError : null);

  const shouldShowAddressError = Boolean(addressErrors.value) || addressDirty;
  const resolvedAddressError =
    addressErrors.value ?? (shouldShowAddressError ? addressClientError : null);

  const fieldClassName =
    "w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none transition focus:border-[#2ED1FF]/60";

  return (
    <div className="space-y-4">
      {hasUnsavedChanges && (
        <div className="rounded-2xl border border-amber-300/25 bg-amber-500/10 px-4 py-3 text-xs text-amber-100">
          У вас есть несохранённые изменения.
        </div>
      )}

      <section className="rounded-[24px] border border-white/5 bg-white/[0.03] p-6 backdrop-blur-xl sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-semibold text-white">Профиль</h3>
          {profileDirty && (
            <span className="rounded-full border border-amber-300/35 bg-amber-500/10 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-amber-100">
              Есть несохранённые изменения
            </span>
          )}
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label className="text-xs uppercase tracking-[0.3em] text-white/50">Имя</label>
            <input
              type="text"
              value={profileName}
              onChange={(event) => {
                setProfileName(event.target.value);
                setProfileErrors((prev) => ({ ...prev, name: undefined, form: undefined }));
              }}
              maxLength={40}
              className={fieldClassName}
            />
            {resolvedProfileNameError && (
              <p className="text-xs text-red-200">{resolvedProfileNameError}</p>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-xs uppercase tracking-[0.3em] text-white/50">Email</label>
            <div className="flex gap-2">
              <input type="email" value={profileInitial.email} readOnly className={fieldClassName} />
              <button
                type="button"
                disabled
                className="shrink-0 rounded-full border border-white/15 px-4 py-2 text-[10px] uppercase tracking-[0.2em] text-white/50"
                title="Функция будет доступна позже"
              >
                Изменить email
              </button>
            </div>
            {typeof profileInitial.emailVerified === "boolean" && (
              <p className="text-xs text-white/45">
                {profileInitial.emailVerified ? "Email подтверждён" : "Email не подтверждён"}
              </p>
            )}
          </div>
        </div>

        {profileErrors.form && <p className="mt-4 text-sm text-red-200">{profileErrors.form}</p>}

        <div className="mt-6 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void handleProfileSave()}
            disabled={profileSaving || !profileDirty || Boolean(profileNameClientError)}
            className="rounded-full bg-[#2ED1FF] px-5 py-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-[#050505] transition hover:bg-[#8fe6ff] disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/50"
          >
            {profileSaving ? "Сохраняем..." : "Сохранить"}
          </button>
          <button
            type="button"
            onClick={() => {
              setProfileName(profileInitial.name);
              setProfileErrors({});
            }}
            disabled={profileSaving || !profileDirty}
            className="rounded-full border border-white/20 px-5 py-2 text-[10px] uppercase tracking-[0.24em] text-white/70 transition hover:border-white/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            Отмена
          </button>
        </div>
      </section>

      <section className="rounded-[24px] border border-white/5 bg-white/[0.03] p-6 backdrop-blur-xl sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-semibold text-white">Адрес доставки по умолчанию</h3>
          {addressDirty && (
            <span className="rounded-full border border-amber-300/35 bg-amber-500/10 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-amber-100">
              Есть несохранённые изменения
            </span>
          )}
        </div>

        <div className="mt-5 space-y-2">
          <label className="text-xs uppercase tracking-[0.3em] text-white/50">Адрес</label>
          <textarea
            value={addressValue}
            onChange={(event) => {
              setAddressValue(event.target.value);
              setAddressErrors((prev) => ({ ...prev, value: undefined, form: undefined }));
            }}
            className={`${fieldClassName} min-h-[120px]`}
            maxLength={300}
          />
          {resolvedAddressError && <p className="text-xs text-red-200">{resolvedAddressError}</p>}
        </div>

        {addressErrors.form && <p className="mt-4 text-sm text-red-200">{addressErrors.form}</p>}

        <div className="mt-6 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void handleAddressSave()}
            disabled={addressSaving || !addressDirty || Boolean(addressClientError)}
            className="rounded-full bg-[#2ED1FF] px-5 py-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-[#050505] transition hover:bg-[#8fe6ff] disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/50"
          >
            {addressSaving ? "Сохраняем..." : "Сохранить"}
          </button>
          <button
            type="button"
            onClick={() => {
              setAddressValue("");
              setAddressErrors({});
            }}
            disabled={addressSaving || addressValue.length === 0}
            className="rounded-full border border-white/20 px-5 py-2 text-[10px] uppercase tracking-[0.24em] text-white/70 transition hover:border-white/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            Очистить
          </button>
        </div>
      </section>

      <section className="rounded-[24px] border border-cyan-300/20 bg-cyan-500/[0.06] p-6 backdrop-blur-xl sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <LockKeyhole className="h-5 w-5 text-cyan-100" />
            <h3 className="text-lg font-semibold text-white">Безопасность</h3>
          </div>
          {passwordOpen && passwordDirty && (
            <span className="rounded-full border border-amber-300/35 bg-amber-500/10 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-amber-100">
              Есть несохранённые изменения
            </span>
          )}
          {!passwordOpen && (
            <button
              type="button"
              onClick={() => setPasswordOpen(true)}
              className="rounded-full border border-cyan-300/35 bg-cyan-500/10 px-4 py-2 text-[10px] uppercase tracking-[0.24em] text-cyan-100 transition hover:border-cyan-200/60 hover:bg-cyan-500/20"
            >
              Сменить пароль
            </button>
          )}
        </div>

        {passwordOpen && (
          <div className="mt-5 space-y-4">
            <div className="space-y-2">
              <label className="text-xs uppercase tracking-[0.3em] text-white/50">
                Текущий пароль
              </label>
              <div className="relative">
                <input
                  type={showPassword.currentPassword ? "text" : "password"}
                  value={passwordForm.currentPassword}
                  onChange={(event) => {
                    setPasswordForm((prev) => ({ ...prev, currentPassword: event.target.value }));
                    setPasswordErrors((prev) => ({
                      ...prev,
                      currentPassword: undefined,
                      form: undefined,
                    }));
                  }}
                  autoComplete="current-password"
                  className={`${fieldClassName} pr-12`}
                />
                <button
                  type="button"
                  onClick={() =>
                    setShowPassword((prev) => ({
                      ...prev,
                      currentPassword: !prev.currentPassword,
                    }))
                  }
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-white/60 transition hover:text-white"
                  aria-label="Показать или скрыть пароль"
                >
                  {showPassword.currentPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
              {(passwordSubmitted || passwordErrors.currentPassword) &&
                (passwordErrors.currentPassword || passwordClientErrors.currentPassword) && (
                  <p className="text-xs text-red-200">
                    {passwordErrors.currentPassword || passwordClientErrors.currentPassword}
                  </p>
                )}
            </div>

            <div className="space-y-2">
              <label className="text-xs uppercase tracking-[0.3em] text-white/50">
                Новый пароль
              </label>
              <div className="relative">
                <input
                  type={showPassword.newPassword ? "text" : "password"}
                  value={passwordForm.newPassword}
                  onChange={(event) => {
                    setPasswordForm((prev) => ({ ...prev, newPassword: event.target.value }));
                    setPasswordErrors((prev) => ({
                      ...prev,
                      newPassword: undefined,
                      confirmNewPassword: undefined,
                      form: undefined,
                    }));
                  }}
                  autoComplete="new-password"
                  className={`${fieldClassName} pr-12`}
                />
                <button
                  type="button"
                  onClick={() =>
                    setShowPassword((prev) => ({ ...prev, newPassword: !prev.newPassword }))
                  }
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-white/60 transition hover:text-white"
                  aria-label="Показать или скрыть пароль"
                >
                  {showPassword.newPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
              <p className="text-[11px] text-white/45">Минимум 8 символов, буквы и цифры</p>
              {(passwordSubmitted || passwordErrors.newPassword) &&
                (passwordErrors.newPassword || passwordClientErrors.newPassword) && (
                  <p className="text-xs text-red-200">
                    {passwordErrors.newPassword || passwordClientErrors.newPassword}
                  </p>
                )}
            </div>

            <div className="space-y-2">
              <label className="text-xs uppercase tracking-[0.3em] text-white/50">
                Повтор нового пароля
              </label>
              <div className="relative">
                <input
                  type={showPassword.confirmNewPassword ? "text" : "password"}
                  value={passwordForm.confirmNewPassword}
                  onChange={(event) => {
                    setPasswordForm((prev) => ({
                      ...prev,
                      confirmNewPassword: event.target.value,
                    }));
                    setPasswordErrors((prev) => ({
                      ...prev,
                      confirmNewPassword: undefined,
                      form: undefined,
                    }));
                  }}
                  autoComplete="new-password"
                  className={`${fieldClassName} pr-12`}
                />
                <button
                  type="button"
                  onClick={() =>
                    setShowPassword((prev) => ({
                      ...prev,
                      confirmNewPassword: !prev.confirmNewPassword,
                    }))
                  }
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-white/60 transition hover:text-white"
                  aria-label="Показать или скрыть пароль"
                >
                  {showPassword.confirmNewPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
              {(passwordSubmitted || passwordErrors.confirmNewPassword) &&
                (passwordErrors.confirmNewPassword || passwordClientErrors.confirmNewPassword) && (
                  <p className="text-xs text-red-200">
                    {passwordErrors.confirmNewPassword || passwordClientErrors.confirmNewPassword}
                  </p>
                )}
            </div>

            {passwordErrors.form && <p className="text-sm text-red-200">{passwordErrors.form}</p>}

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void handleChangePassword()}
                disabled={passwordSaving || !passwordDirty || passwordHasClientErrors}
                className="rounded-full bg-[#2ED1FF] px-5 py-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-[#050505] transition hover:bg-[#8fe6ff] disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/50"
              >
                {passwordSaving ? "Сохраняем..." : "Сохранить пароль"}
              </button>
              <button
                type="button"
                onClick={resetPasswordSection}
                disabled={passwordSaving}
                className="rounded-full border border-white/20 px-5 py-2 text-[10px] uppercase tracking-[0.24em] text-white/70 transition hover:border-white/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                Отмена
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
