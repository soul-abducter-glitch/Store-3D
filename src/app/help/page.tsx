"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { LifeBuoy, MessageSquare, RefreshCcw, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

type Ticket = {
  id: string;
  title: string;
  category: string;
  priority: string;
  status: string;
  message: string;
  adminReply?: string;
  createdAt?: string;
  updatedAt?: string;
};

const STATUS_LABELS: Record<string, string> = {
  open: "Открыт",
  in_progress: "В работе",
  resolved: "Решен",
  closed: "Закрыт",
};

const CATEGORY_LABELS: Record<string, string> = {
  ai_generation: "AI генерация",
  ai_tokens: "AI токены",
  print: "Печать",
  payment: "Оплата",
  downloads: "Загрузки",
  other: "Другое",
};

const formatDateTime = (value?: string) => {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return date.toLocaleString("ru-RU");
};

export default function HelpPage() {
  const [isAuthed, setIsAuthed] = useState(false);
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [ticketsLoading, setTicketsLoading] = useState(false);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [category, setCategory] = useState("other");
  const [priority, setPriority] = useState("normal");
  const [submitting, setSubmitting] = useState(false);

  const fetchTickets = useCallback(async () => {
    if (!isAuthed) return;
    setTicketsLoading(true);
    try {
      const response = await fetch("/api/support/tickets", { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || `HTTP ${response.status}`);
      }
      setTickets(Array.isArray(payload.tickets) ? payload.tickets : []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось загрузить тикеты.");
    } finally {
      setTicketsLoading(false);
    }
  }, [isAuthed]);

  useEffect(() => {
    (async () => {
      try {
        const response = await fetch("/api/users/me", { cache: "no-store" });
        const payload = await response.json().catch(() => ({}));
        const ok = Boolean(response.ok && payload?.user);
        setIsAuthed(ok);
      } catch {
        setIsAuthed(false);
      } finally {
        setLoadingAuth(false);
      }
    })();
  }, []);

  useEffect(() => {
    fetchTickets();
  }, [fetchTickets]);

  const canSubmit = useMemo(
    () => title.trim().length > 2 && message.trim().length >= 10 && !submitting,
    [title, message, submitting]
  );

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    try {
      const response = await fetch("/api/support/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          message: message.trim(),
          category,
          priority,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || `HTTP ${response.status}`);
      }
      setTitle("");
      setMessage("");
      setCategory("other");
      setPriority("normal");
      toast.success("Тикет создан.");
      await fetchTickets();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось создать тикет.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loadingAuth) {
    return (
      <main className="min-h-screen bg-[#05080E] px-6 py-16 text-white">
        <div className="mx-auto max-w-5xl rounded-2xl border border-white/10 bg-black/25 p-6">
          Проверка авторизации...
        </div>
      </main>
    );
  }

  if (!isAuthed) {
    return (
      <main className="min-h-screen bg-[#05080E] px-6 py-16 text-white">
        <div className="mx-auto max-w-5xl rounded-2xl border border-red-500/30 bg-red-500/10 p-6">
          <p className="text-lg font-semibold">Нужен вход в аккаунт</p>
          <p className="mt-2 text-white/80">Чтобы создать обращение, авторизуйтесь в профиле.</p>
          <Link
            href="/profile"
            className="mt-4 inline-flex rounded-xl border border-white/20 px-4 py-2 text-sm"
          >
            Перейти в профиль
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#05080E] px-6 py-10 text-white">
      <div className="mx-auto max-w-6xl space-y-6">
        <section className="rounded-2xl border border-white/10 bg-black/30 p-6">
          <p className="text-xs uppercase tracking-[0.35em] text-cyan-300/70">Support Center</p>
          <h1 className="mt-2 text-3xl font-semibold">Поддержка</h1>
          <p className="mt-2 max-w-2xl text-sm text-white/70">
            Если что-то не работает, опишите проблему. Тикет попадет в админку, а обновления статуса
            придут на email аккаунта.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              href="/profile"
              className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-black/30 px-4 py-2 text-sm"
            >
              <LifeBuoy className="h-4 w-4" />
              Вернуться в профиль
            </Link>
            <button
              type="button"
              onClick={fetchTickets}
              className="inline-flex items-center gap-2 rounded-xl border border-cyan-400/40 bg-cyan-500/10 px-4 py-2 text-sm"
            >
              <RefreshCcw className="h-4 w-4" />
              Обновить тикеты
            </button>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[1fr_1fr]">
          <form
            onSubmit={handleSubmit}
            className="rounded-2xl border border-white/10 bg-black/30 p-6"
          >
            <div className="mb-4 flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-cyan-300" />
              <h2 className="text-xl font-semibold">Новое обращение</h2>
            </div>
            <div className="space-y-4">
              <label className="block">
                <span className="mb-1 block text-sm text-white/70">Тема</span>
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  maxLength={120}
                  className="w-full rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-sm outline-none focus:border-cyan-300/60"
                  placeholder="Коротко: что случилось"
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="mb-1 block text-sm text-white/70">Категория</span>
                  <select
                    value={category}
                    onChange={(event) => setCategory(event.target.value)}
                    className="w-full rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-sm outline-none"
                  >
                    <option value="ai_generation">AI генерация</option>
                    <option value="ai_tokens">AI токены</option>
                    <option value="print">Печать</option>
                    <option value="payment">Оплата</option>
                    <option value="downloads">Загрузки</option>
                    <option value="other">Другое</option>
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-sm text-white/70">Приоритет</span>
                  <select
                    value={priority}
                    onChange={(event) => setPriority(event.target.value)}
                    className="w-full rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-sm outline-none"
                  >
                    <option value="normal">Нормальный</option>
                    <option value="high">Высокий</option>
                    <option value="low">Низкий</option>
                  </select>
                </label>
              </div>
              <label className="block">
                <span className="mb-1 block text-sm text-white/70">Описание</span>
                <textarea
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  maxLength={4000}
                  rows={7}
                  className="w-full rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-sm outline-none focus:border-cyan-300/60"
                  placeholder="Опишите шаги и что ожидали увидеть."
                />
              </label>
            </div>
            <button
              type="submit"
              disabled={!canSubmit}
              className="mt-5 inline-flex items-center gap-2 rounded-xl border border-cyan-400/50 bg-cyan-500/10 px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ShieldAlert className="h-4 w-4" />
              {submitting ? "Отправка..." : "Создать тикет"}
            </button>
          </form>

          <section className="rounded-2xl border border-white/10 bg-black/30 p-6">
            <h2 className="mb-4 text-xl font-semibold">Мои обращения</h2>
            {ticketsLoading && <p className="text-sm text-white/60">Загрузка...</p>}
            {!ticketsLoading && tickets.length === 0 && (
              <p className="text-sm text-white/60">Обращений пока нет.</p>
            )}
            <div className="space-y-3">
              {tickets.map((ticket) => (
                <article key={ticket.id} className="rounded-xl border border-white/10 bg-black/25 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold">{ticket.title}</p>
                    <span className="rounded-full border border-white/20 px-2 py-0.5 text-xs uppercase">
                      {STATUS_LABELS[ticket.status] || ticket.status}
                    </span>
                  </div>
                  <p className="mt-1 text-xs uppercase tracking-[0.2em] text-white/50">
                    {CATEGORY_LABELS[ticket.category] || ticket.category} · #{ticket.id}
                  </p>
                  <p className="mt-2 text-sm text-white/75 whitespace-pre-line">{ticket.message}</p>
                  {ticket.adminReply && (
                    <div className="mt-3 rounded-lg border border-emerald-400/30 bg-emerald-500/10 p-3">
                      <p className="text-xs uppercase tracking-[0.2em] text-emerald-200/90">Ответ поддержки</p>
                      <p className="mt-1 text-sm text-emerald-100 whitespace-pre-line">{ticket.adminReply}</p>
                    </div>
                  )}
                  <p className="mt-3 text-xs text-white/50">
                    Обновлен: {formatDateTime(ticket.updatedAt || ticket.createdAt)}
                  </p>
                </article>
              ))}
            </div>
          </section>
        </section>
      </div>
    </main>
  );
}

