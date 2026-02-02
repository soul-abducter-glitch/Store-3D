 "use client";

import { useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { mergeGuestCartIntoUser } from "@/lib/cartStorage";

type AuthMode = "login" | "register";

const NAME_REGEX = /^[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё\s'-]{1,49}$/;
const PASSWORD_REGEX = /^(?=.*[A-Za-zА-Яа-яЁё])(?=.*\d)(?=.*[^A-Za-zА-Яа-яЁё\d]).{8,}$/;

type AuthFormProps = {
  onSuccess?: () => void;
  redirectOnSuccess?: boolean;
  redirectTo?: string | null;
};

export default function AuthForm({
  onSuccess,
  redirectOnSuccess = true,
  redirectTo = null,
}: AuthFormProps) {
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const apiBase = "";
  const searchParams = useSearchParams();

  const resolveRedirect = () => {
    if (redirectTo) {
      return redirectTo;
    }
    const next = searchParams.get("next");
    
    if (next && next.startsWith("/")) {
      return next;
    }
    
    return "/profile";
  };

  const getErrorMessage = async (response: Response) => {
    try {
      const data = await response.json();
      return (
        data?.errors?.[0]?.data?.errors?.[0]?.message ||
        data?.errors?.[0]?.message ||
        data?.message ||
        "Request failed."
      );
    } catch {
      return "Request failed.";
    }
  };

  const toggleMode = () => {
    setError(null);
    setMode((prev) => (prev === "login" ? "register" : "login"));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) {
      return;
    }

    setSubmitting(true);
    setError(null);
    const trimmedEmail = email.trim();
    const trimmedName = name.trim();

    try {
      const syncGuestCart = async () => {
        try {
          const meResponse = await fetch(`${apiBase}/api/users/me`, {
            credentials: "include",
            cache: "no-store",
          });
          if (!meResponse.ok) return;
          const data = await meResponse.json();
          const user = data?.user ?? data?.doc ?? null;
          if (user?.id) {
            mergeGuestCartIntoUser(String(user.id));
          }
        } catch {
          // ignore merge failures
        }
      };

      if (mode === "login") {
        const response = await fetch(`${apiBase}/api/users/login`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: trimmedEmail, password }),
        });

        if (!response.ok) {
          setError(await getErrorMessage(response));
          setSubmitting(false);
          return;
        }
        await syncGuestCart();
      } else {
        if (!trimmedName) {
          setError("Имя обязательно.");
          setSubmitting(false);
          return;
        }
        if (!NAME_REGEX.test(trimmedName)) {
          setError("Имя: только буквы, пробелы, дефис или апостроф.");
          setSubmitting(false);
          return;
        }
        if (!PASSWORD_REGEX.test(password)) {
          setError("Пароль: минимум 8 символов, буквы, цифры и спецсимвол.");
          setSubmitting(false);
          return;
        }

        const response = await fetch(`${apiBase}/api/users`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: trimmedEmail,
            password,
            name: trimmedName,
          }),
        });

        if (!response.ok) {
          setError(await getErrorMessage(response));
          setSubmitting(false);
          return;
        }

        const loginResponse = await fetch(`${apiBase}/api/users/login`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: trimmedEmail, password }),
        });

        if (!loginResponse.ok) {
          setError(await getErrorMessage(loginResponse));
          setSubmitting(false);
          return;
        }
        await syncGuestCart();
      }

      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("auth-updated"));
      }
      onSuccess?.();
      if (redirectOnSuccess) {
        window.location.assign(resolveRedirect());
      }
    } catch (err) {
      setError("Network error. Please try again.");
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold text-white">
          {mode === "login" ? "Вход в систему" : "Регистрация"}
        </h2>
        <button
          type="button"
          onClick={toggleMode}
          className="rounded-full border border-white/10 px-4 py-2 text-xs uppercase tracking-[0.3em] text-white/60 transition hover:text-white"
        >
          {mode === "login" ? "Создать аккаунт" : "Уже есть аккаунт"}
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {mode === "register" && (
          <div className="space-y-2">
            <label className="text-xs uppercase tracking-[0.3em] text-white/50">
              {"\u0418\u043c\u044f"}
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none transition focus:border-[#2ED1FF]/60"
              placeholder="Ваше имя"
            />
          </div>
        )}

        <div className="space-y-2">
          <label className="text-xs uppercase tracking-[0.3em] text-white/50">Email</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none transition focus:border-[#2ED1FF]/60"
            placeholder="you@example.com"
          />
        </div>

        <div className="space-y-2">
          <label className="text-xs uppercase tracking-[0.3em] text-white/50">Пароль</label>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none transition focus:border-[#2ED1FF]/60"
            placeholder={"\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"}
          />
        </div>

        {error && (
          <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-full bg-[#2ED1FF] px-4 py-3 text-xs font-semibold uppercase tracking-[0.3em] text-[#050505] transition hover:bg-[#8fe6ff] disabled:opacity-60"
        >
          {submitting ? "Обработка..." : mode === "login" ? "Войти" : "Создать аккаунт"}
        </button>
      </form>
    </div>
  );
}
