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
        throw new Error("\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044c \u043f\u0440\u043e\u0444\u0438\u043b\u044c.");
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
        error instanceof Error && error.message ? error.message : "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044c \u043f\u0440\u043e\u0444\u0438\u043b\u044c.";
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
            : "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0441\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u044c \u0438\u0437\u043c\u0435\u043d\u0435\u043d\u0438\u044f. \u041f\u043e\u0432\u0442\u043e\u0440\u0438\u0442\u0435 \u043f\u043e\u043f\u044b\u0442\u043a\u0443.";
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
      toast.success("\u041f\u0440\u043e\u0444\u0438\u043b\u044c \u0441\u043e\u0445\u0440\u0430\u043d\u0451\u043d");
    } catch {
      setProfileErrors({ form: "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0441\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u044c \u0438\u0437\u043c\u0435\u043d\u0435\u043d\u0438\u044f. \u041f\u043e\u0432\u0442\u043e\u0440\u0438\u0442\u0435 \u043f\u043e\u043f\u044b\u0442\u043a\u0443." });
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
              : "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0441\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u044c \u0430\u0434\u0440\u0435\u0441. \u041f\u043e\u0432\u0442\u043e\u0440\u0438\u0442\u0435 \u043f\u043e\u043f\u044b\u0442\u043a\u0443.",
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
      toast.success("\u0410\u0434\u0440\u0435\u0441 \u0441\u043e\u0445\u0440\u0430\u043d\u0451\u043d");
    } catch {
      setAddressErrors({ form: "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0441\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u044c \u0430\u0434\u0440\u0435\u0441. \u041f\u043e\u0432\u0442\u043e\u0440\u0438\u0442\u0435 \u043f\u043e\u043f\u044b\u0442\u043a\u0443." });
    } finally {
      setAddressSaving(false);
    }
  };

  const validatePasswordForm = () => {
    const errors: typeof passwordErrors = {};
    if (!passwordForm.currentPassword) {
      errors.currentPassword = "\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u0442\u0435\u043a\u0443\u0449\u0438\u0439 \u043f\u0430\u0440\u043e\u043b\u044c";
    }
    const newPasswordError = validateNewAccountPassword(passwordForm.newPassword);
    if (newPasswordError) {
      errors.newPassword = newPasswordError;
    }
    if (passwordForm.confirmNewPassword !== passwordForm.newPassword) {
      errors.confirmNewPassword = "\u041f\u0430\u0440\u043e\u043b\u0438 \u043d\u0435 \u0441\u043e\u0432\u043f\u0430\u0434\u0430\u044e\u0442";
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
              : "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0438\u0437\u043c\u0435\u043d\u0438\u0442\u044c \u043f\u0430\u0440\u043e\u043b\u044c. \u041f\u043e\u0432\u0442\u043e\u0440\u0438\u0442\u0435 \u043f\u043e\u043f\u044b\u0442\u043a\u0443.",
        });
        return;
      }

      toast.success("\u041f\u0430\u0440\u043e\u043b\u044c \u0438\u0437\u043c\u0435\u043d\u0451\u043d");
      resetPasswordSection();
    } catch {
      setPasswordErrors({ form: "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0438\u0437\u043c\u0435\u043d\u0438\u0442\u044c \u043f\u0430\u0440\u043e\u043b\u044c. \u041f\u043e\u0432\u0442\u043e\u0440\u0438\u0442\u0435 \u043f\u043e\u043f\u044b\u0442\u043a\u0443." });
    } finally {
      setPasswordSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-[24px] border border-white/5 bg-white/[0.03] p-8 text-sm text-white/60 backdrop-blur-xl">
        \u0417\u0430\u0433\u0440\u0443\u0436\u0430\u0435\u043c \u043d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0438...
      </div>
    );
  }

  if (loadError || !profileInitial) {
    return (
      <div className="rounded-[24px] border border-red-500/25 bg-red-500/10 p-8 text-sm text-red-100 backdrop-blur-xl">
        <p>{loadError || "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044c \u043d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0438."}</p>
        <button
          type="button"
          onClick={() => void loadProfile()}
          className="mt-4 rounded-full border border-red-300/35 px-4 py-2 text-[10px] uppercase tracking-[0.24em] text-red-100 transition hover:bg-red-500/20"
        >
          \u041f\u043e\u0432\u0442\u043e\u0440\u0438\u0442\u044c
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
          \u0423 \u0432\u0430\u0441 \u0435\u0441\u0442\u044c \u043d\u0435\u0441\u043e\u0445\u0440\u0430\u043d\u0451\u043d\u043d\u044b\u0435 \u0438\u0437\u043c\u0435\u043d\u0435\u043d\u0438\u044f.
        </div>
      )}

      <section className="rounded-[24px] border border-white/5 bg-white/[0.03] p-6 backdrop-blur-xl sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-semibold text-white">\u041f\u0440\u043e\u0444\u0438\u043b\u044c</h3>
          {profileDirty && (
            <span className="rounded-full border border-amber-300/35 bg-amber-500/10 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-amber-100">
              \u0415\u0441\u0442\u044c \u043d\u0435\u0441\u043e\u0445\u0440\u0430\u043d\u0451\u043d\u043d\u044b\u0435 \u0438\u0437\u043c\u0435\u043d\u0435\u043d\u0438\u044f
            </span>
          )}
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label className="text-xs uppercase tracking-[0.3em] text-white/50">\u0418\u043c\u044f</label>
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
                title="\u0424\u0443\u043d\u043a\u0446\u0438\u044f \u0431\u0443\u0434\u0435\u0442 \u0434\u043e\u0441\u0442\u0443\u043f\u043d\u0430 \u043f\u043e\u0437\u0436\u0435"
              >
                \u0418\u0437\u043c\u0435\u043d\u0438\u0442\u044c email
              </button>
            </div>
            {typeof profileInitial.emailVerified === "boolean" && (
              <p className="text-xs text-white/45">
                {profileInitial.emailVerified ? "Email \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0451\u043d" : "Email \u043d\u0435 \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0451\u043d"}
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
            {profileSaving ? "\u0421\u043e\u0445\u0440\u0430\u043d\u044f\u0435\u043c..." : "\u0421\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u044c"}
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
            \u041e\u0442\u043c\u0435\u043d\u0430
          </button>
        </div>
      </section>

      <section className="rounded-[24px] border border-white/5 bg-white/[0.03] p-6 backdrop-blur-xl sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-semibold text-white">\u0410\u0434\u0440\u0435\u0441 \u0434\u043e\u0441\u0442\u0430\u0432\u043a\u0438 \u043f\u043e \u0443\u043c\u043e\u043b\u0447\u0430\u043d\u0438\u044e</h3>
          {addressDirty && (
            <span className="rounded-full border border-amber-300/35 bg-amber-500/10 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-amber-100">
              \u0415\u0441\u0442\u044c \u043d\u0435\u0441\u043e\u0445\u0440\u0430\u043d\u0451\u043d\u043d\u044b\u0435 \u0438\u0437\u043c\u0435\u043d\u0435\u043d\u0438\u044f
            </span>
          )}
        </div>

        <div className="mt-5 space-y-2">
          <label className="text-xs uppercase tracking-[0.3em] text-white/50">\u0410\u0434\u0440\u0435\u0441</label>
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
            {addressSaving ? "\u0421\u043e\u0445\u0440\u0430\u043d\u044f\u0435\u043c..." : "\u0421\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u044c"}
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
            \u041e\u0447\u0438\u0441\u0442\u0438\u0442\u044c
          </button>
        </div>
      </section>

      <section className="rounded-[24px] border border-cyan-300/20 bg-cyan-500/[0.06] p-6 backdrop-blur-xl sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <LockKeyhole className="h-5 w-5 text-cyan-100" />
            <h3 className="text-lg font-semibold text-white">\u0411\u0435\u0437\u043e\u043f\u0430\u0441\u043d\u043e\u0441\u0442\u044c</h3>
          </div>
          {passwordOpen && passwordDirty && (
            <span className="rounded-full border border-amber-300/35 bg-amber-500/10 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-amber-100">
              \u0415\u0441\u0442\u044c \u043d\u0435\u0441\u043e\u0445\u0440\u0430\u043d\u0451\u043d\u043d\u044b\u0435 \u0438\u0437\u043c\u0435\u043d\u0435\u043d\u0438\u044f
            </span>
          )}
          {!passwordOpen && (
            <button
              type="button"
              onClick={() => setPasswordOpen(true)}
              className="rounded-full border border-cyan-300/35 bg-cyan-500/10 px-4 py-2 text-[10px] uppercase tracking-[0.24em] text-cyan-100 transition hover:border-cyan-200/60 hover:bg-cyan-500/20"
            >
              \u0421\u043c\u0435\u043d\u0438\u0442\u044c \u043f\u0430\u0440\u043e\u043b\u044c
            </button>
          )}
        </div>

        {passwordOpen && (
          <div className="mt-5 space-y-4">
            <div className="space-y-2">
              <label className="text-xs uppercase tracking-[0.3em] text-white/50">
                \u0422\u0435\u043a\u0443\u0449\u0438\u0439 \u043f\u0430\u0440\u043e\u043b\u044c
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
                  aria-label="\u041f\u043e\u043a\u0430\u0437\u0430\u0442\u044c \u0438\u043b\u0438 \u0441\u043a\u0440\u044b\u0442\u044c \u043f\u0430\u0440\u043e\u043b\u044c"
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
                \u041d\u043e\u0432\u044b\u0439 \u043f\u0430\u0440\u043e\u043b\u044c
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
                  aria-label="\u041f\u043e\u043a\u0430\u0437\u0430\u0442\u044c \u0438\u043b\u0438 \u0441\u043a\u0440\u044b\u0442\u044c \u043f\u0430\u0440\u043e\u043b\u044c"
                >
                  {showPassword.newPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
              <p className="text-[11px] text-white/45">\u041c\u0438\u043d\u0438\u043c\u0443\u043c 8 \u0441\u0438\u043c\u0432\u043e\u043b\u043e\u0432, \u0431\u0443\u043a\u0432\u044b \u0438 \u0446\u0438\u0444\u0440\u044b</p>
              {(passwordSubmitted || passwordErrors.newPassword) &&
                (passwordErrors.newPassword || passwordClientErrors.newPassword) && (
                  <p className="text-xs text-red-200">
                    {passwordErrors.newPassword || passwordClientErrors.newPassword}
                  </p>
                )}
            </div>

            <div className="space-y-2">
              <label className="text-xs uppercase tracking-[0.3em] text-white/50">
                \u041f\u043e\u0432\u0442\u043e\u0440 \u043d\u043e\u0432\u043e\u0433\u043e \u043f\u0430\u0440\u043e\u043b\u044f
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
                  aria-label="\u041f\u043e\u043a\u0430\u0437\u0430\u0442\u044c \u0438\u043b\u0438 \u0441\u043a\u0440\u044b\u0442\u044c \u043f\u0430\u0440\u043e\u043b\u044c"
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
                {passwordSaving ? "\u0421\u043e\u0445\u0440\u0430\u043d\u044f\u0435\u043c..." : "\u0421\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u044c \u043f\u0430\u0440\u043e\u043b\u044c"}
              </button>
              <button
                type="button"
                onClick={resetPasswordSection}
                disabled={passwordSaving}
                className="rounded-full border border-white/20 px-5 py-2 text-[10px] uppercase tracking-[0.24em] text-white/70 transition hover:border-white/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                \u041e\u0442\u043c\u0435\u043d\u0430
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
