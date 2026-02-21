"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Clock3,
  FileText,
  LifeBuoy,
  Loader2,
  MessageSquare,
  Paperclip,
  RefreshCcw,
  Search,
  SendHorizontal,
  Ticket,
  X,
} from "lucide-react";
import { toast } from "sonner";

type SupportStatus = "open" | "in_progress" | "waiting_user" | "resolved" | "closed";
type SupportCategory =
  | "ai_lab"
  | "print_order"
  | "digital_purchase"
  | "payment"
  | "delivery"
  | "account"
  | "bug_ui"
  | "other";
type LinkedEntityType =
  | "none"
  | "order"
  | "ai_generation"
  | "ai_asset"
  | "digital_purchase"
  | "print_order";

type Attachment = {
  id: string;
  fileName: string;
  mimeType?: string;
  size?: number;
  url?: string;
};

type TicketListItem = {
  id: string;
  publicId: string;
  subject: string;
  category: SupportCategory;
  priority: string;
  status: SupportStatus;
  descriptionPreview: string;
  createdAt?: string;
  updatedAt?: string;
  hasSupportReply: boolean;
};

type TicketMessage = {
  id: string;
  authorType: "USER" | "SUPPORT";
  body: string;
  createdAt: string;
  attachments: Attachment[];
};

type TicketDetails = TicketListItem & {
  description: string;
  linkedEntity: null | { type: LinkedEntityType; id: string };
  messages: TicketMessage[];
};

const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const DESCRIPTION_MAX = 5000;
const SUBJECT_MAX = 120;
const ALLOWED_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".pdf", ".txt", ".zip", ".glb", ".gltf", ".stl"];

const STATUS_LABELS: Record<SupportStatus, string> = {
  open: "Открыт",
  in_progress: "В работе",
  waiting_user: "Ждет ответа",
  resolved: "Решен",
  closed: "Закрыт",
};

const STATUS_FILTERS: Array<{ value: "all" | SupportStatus; label: string }> = [
  { value: "all", label: "Все" },
  { value: "open", label: "Открытые" },
  { value: "in_progress", label: "В работе" },
  { value: "waiting_user", label: "Ждет ответа" },
  { value: "closed", label: "Закрытые" },
];

const STATUS_TONE: Record<SupportStatus, string> = {
  open: "border-cyan-300/45 bg-cyan-500/10 text-cyan-100",
  in_progress: "border-amber-300/45 bg-amber-500/10 text-amber-100",
  waiting_user: "border-orange-300/45 bg-orange-500/10 text-orange-100",
  resolved: "border-emerald-300/45 bg-emerald-500/10 text-emerald-100",
  closed: "border-white/25 bg-white/5 text-white/70",
};

const CATEGORY_OPTIONS: Array<{ value: SupportCategory; label: string }> = [
  { value: "ai_lab", label: "AI Лаборатория / генерация" },
  { value: "print_order", label: "Печать на заказ" },
  { value: "digital_purchase", label: "Цифровая покупка / скачивание" },
  { value: "payment", label: "Оплата / платеж" },
  { value: "delivery", label: "Доставка" },
  { value: "account", label: "Аккаунт / вход / профиль" },
  { value: "bug_ui", label: "Ошибка интерфейса" },
  { value: "other", label: "Другое" },
];

const CATEGORY_LABELS: Record<SupportCategory, string> = {
  ai_lab: "AI Лаборатория",
  print_order: "Печать",
  digital_purchase: "Цифровая покупка",
  payment: "Оплата",
  delivery: "Доставка",
  account: "Аккаунт",
  bug_ui: "Ошибка интерфейса",
  other: "Другое",
};

const LINK_OPTIONS: Array<{ value: LinkedEntityType; label: string }> = [
  { value: "none", label: "Нет" },
  { value: "order", label: "Заказ" },
  { value: "ai_generation", label: "AI генерация" },
  { value: "ai_asset", label: "AI библиотека" },
  { value: "digital_purchase", label: "Цифровая покупка" },
  { value: "print_order", label: "Печать на заказ" },
];

const fmtDate = (v?: string) => {
  if (!v) return "—";
  const d = new Date(v);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleString("ru-RU");
};

const ext = (name: string) => {
  const i = name.toLowerCase().lastIndexOf(".");
  return i < 0 ? "" : name.toLowerCase().slice(i);
};

const validateCreate = (f: {
  subject: string;
  category: SupportCategory;
  description: string;
  linkedEntityType: LinkedEntityType;
  linkedEntityId: string;
}) => {
  const e: Record<string, string> = {};
  if (f.subject.trim().length < 5) e.subject = "Введите тему обращения (минимум 5 символов)";
  if (f.subject.trim().length > SUBJECT_MAX) e.subject = "Тема слишком длинная (максимум 120 символов)";
  if (f.description.trim().length < 20) e.description = "Опишите проблему подробнее (минимум 20 символов)";
  if (f.description.trim().length > DESCRIPTION_MAX) e.description = "Описание слишком длинное (максимум 5000 символов)";
  if (!f.category) e.category = "Выберите категорию обращения";
  if (f.linkedEntityType !== "none" && !f.linkedEntityId.trim()) e.linkedEntityId = "Укажите ID связанного объекта";
  return e;
};

export default function HelpPage() {
  const [authLoading, setAuthLoading] = useState(true);
  const [isAuthed, setIsAuthed] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const [statusFilter, setStatusFilter] = useState<"all" | SupportStatus>("all");
  const [search, setSearch] = useState("");
  const [searchQ, setSearchQ] = useState("");

  const [tickets, setTickets] = useState<TicketListItem[]>([]);
  const [ticketsLoading, setTicketsLoading] = useState(false);
  const [ticketsError, setTicketsError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [details, setDetails] = useState<TicketDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);

  const [form, setForm] = useState({
    subject: "",
    category: "other" as SupportCategory,
    description: "",
    linkedEntityType: "none" as LinkedEntityType,
    linkedEntityId: "",
  });
  const [formSubmitted, setFormSubmitted] = useState(false);
  const [formServerErrors, setFormServerErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formUploading, setFormUploading] = useState(false);
  const [formAttachments, setFormAttachments] = useState<Attachment[]>([]);

  const [reply, setReply] = useState("");
  const [replySubmitted, setReplySubmitted] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [replySending, setReplySending] = useState(false);
  const [replyUploading, setReplyUploading] = useState(false);
  const [replyAttachments, setReplyAttachments] = useState<Attachment[]>([]);

  const clientErrors = useMemo(() => validateCreate(form), [form]);
  const canCreate = !formSubmitting && !formUploading && Object.keys(clientErrors).length === 0 && formAttachments.length <= MAX_ATTACHMENTS;
  const canReply = !!selectedId && !!reply.trim() && reply.trim().length >= 2 && !replySending && !replyUploading && details?.status !== "closed";

  const uploadFile = useCallback(async (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    const r = await fetch("/api/support/uploads", { method: "POST", body: fd });
    const p = await r.json().catch(() => ({}));
    if (!r.ok || !p?.success || !p?.attachment) {
      throw new Error(p?.error || "Не удалось загрузить файл. Повторите попытку.");
    }
    return p.attachment as Attachment;
  }, []);

  const handleUpload = useCallback(async (files: FileList | null, target: "form" | "reply") => {
    if (!files?.length) return;
    const current = target === "form" ? formAttachments : replyAttachments;
    const setCurrent = target === "form" ? setFormAttachments : setReplyAttachments;
    const setUploading = target === "form" ? setFormUploading : setReplyUploading;
    const setErr = target === "form" ? setFormError : setReplyError;

    if (current.length + files.length > MAX_ATTACHMENTS) {
      setErr(`Можно прикрепить не более ${MAX_ATTACHMENTS} файлов`);
      return;
    }

    setUploading(true);
    setErr(null);
    try {
      for (const f of Array.from(files)) {
        if (f.size > MAX_ATTACHMENT_BYTES) {
          setErr("Файл слишком большой");
          continue;
        }
        if (!ALLOWED_EXTENSIONS.includes(ext(f.name))) {
          setErr("Формат файла не поддерживается");
          continue;
        }
        const uploaded = await uploadFile(f);
        setCurrent((prev) => [...prev, uploaded].slice(0, MAX_ATTACHMENTS));
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Не удалось загрузить файл. Повторите попытку.");
    } finally {
      setUploading(false);
    }
  }, [formAttachments, replyAttachments, uploadFile]);

  const fetchTickets = useCallback(async (silent = false) => {
    if (!isAuthed) return;
    if (!silent) setTicketsLoading(true);
    setTicketsError(null);
    try {
      const qs = new URLSearchParams();
      qs.set("limit", "20");
      if (statusFilter !== "all") qs.set("status", statusFilter);
      if (searchQ) qs.set("search", searchQ);
      const r = await fetch(`/api/support/tickets?${qs.toString()}`, { cache: "no-store" });
      const p = await r.json().catch(() => ({}));
      if (!r.ok || !p?.success) throw new Error(p?.error || "Не удалось загрузить обращения.");
      const next = Array.isArray(p.tickets) ? p.tickets : [];
      setTickets(next);
      setLastUpdatedAt(p.lastUpdatedAt || new Date().toISOString());
      if (selectedId && !next.some((t: TicketListItem) => t.id === selectedId)) {
        setSelectedId(null);
        setDetails(null);
      }
    } catch (e) {
      setTicketsError(e instanceof Error ? e.message : "Не удалось загрузить обращения.");
    } finally {
      if (!silent) setTicketsLoading(false);
    }
  }, [isAuthed, searchQ, selectedId, statusFilter]);

  const fetchDetails = useCallback(async (id: string, silent = false) => {
    if (!silent) setDetailsLoading(true);
    setDetailsError(null);
    try {
      const r = await fetch(`/api/support/tickets/${encodeURIComponent(id)}`, { cache: "no-store" });
      const p = await r.json().catch(() => ({}));
      if (!r.ok || !p?.success || !p?.ticket) throw new Error(p?.error || "Не удалось открыть обращение.");
      setDetails(p.ticket as TicketDetails);
    } catch (e) {
      setDetailsError(e instanceof Error ? e.message : "Не удалось открыть обращение.");
    } finally {
      if (!silent) setDetailsLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setSearchQ(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/users/me", { cache: "no-store" });
        const p = await r.json().catch(() => ({}));
        setIsAuthed(Boolean(r.ok && (p?.user || p?.doc)));
      } catch {
        setIsAuthed(false);
      } finally {
        setAuthLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!isAuthed) return;
    void fetchTickets();
  }, [fetchTickets, isAuthed]);

  useEffect(() => {
    if (!selectedId) return;
    void fetchDetails(selectedId);
  }, [fetchDetails, selectedId]);

  useEffect(() => {
    if (!isAuthed || !autoRefresh) return;
    const id = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void fetchTickets(true);
      if (selectedId) void fetchDetails(selectedId, true);
    }, 45000);
    return () => window.clearInterval(id);
  }, [autoRefresh, fetchDetails, fetchTickets, isAuthed, selectedId]);

  const onCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFormSubmitted(true);
    setFormServerErrors({});
    setFormError(null);
    if (!canCreate) return;

    setFormSubmitting(true);
    try {
      const r = await fetch("/api/support/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: form.subject.trim(),
          category: form.category,
          description: form.description.trim(),
          linkedEntityType: form.linkedEntityType === "none" ? undefined : form.linkedEntityType,
          linkedEntityId: form.linkedEntityType === "none" ? undefined : form.linkedEntityId.trim(),
          attachments: formAttachments,
        }),
      });
      const p = await r.json().catch(() => ({}));
      if (!r.ok || !p?.success) {
        if (p?.error === "validation_error" && p?.fieldErrors) {
          setFormServerErrors(p.fieldErrors as Record<string, string>);
          return;
        }
        throw new Error(p?.error || "Не удалось создать тикет. Повторите попытку.");
      }

      toast.success("Тикет создан");
      setForm({ subject: "", category: "other", description: "", linkedEntityType: "none", linkedEntityId: "" });
      setFormSubmitted(false);
      setFormAttachments([]);
      await fetchTickets();
      if (p?.ticket?.id) {
        setSelectedId(String(p.ticket.id));
        await fetchDetails(String(p.ticket.id));
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Не удалось создать тикет. Повторите попытку.");
    } finally {
      setFormSubmitting(false);
    }
  };

  const onReply = async () => {
    if (!selectedId || !canReply) return;
    setReplySubmitted(true);
    setReplyError(null);

    if (reply.trim().length < 2) {
      setReplyError("Введите сообщение");
      return;
    }

    setReplySending(true);
    try {
      const r = await fetch(`/api/support/tickets/${encodeURIComponent(selectedId)}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: reply.trim(), attachments: replyAttachments }),
      });
      const p = await r.json().catch(() => ({}));
      if (!r.ok || !p?.success) throw new Error(p?.error || "Не удалось отправить ответ.");
      toast.success("Ответ отправлен");
      setReply("");
      setReplySubmitted(false);
      setReplyAttachments([]);
      if (p?.ticket) setDetails(p.ticket as TicketDetails);
      await fetchTickets(true);
    } catch (err) {
      setReplyError(err instanceof Error ? err.message : "Не удалось отправить ответ.");
    } finally {
      setReplySending(false);
    }
  };

  const fieldErr = (field: string) => formServerErrors[field] || (formSubmitted ? clientErrors[field] : undefined) || undefined;

  if (authLoading) {
    return <main className="min-h-screen bg-[#05080E] px-6 py-16 text-white"><div className="mx-auto max-w-6xl rounded-[24px] border border-white/10 bg-black/30 p-6">Проверяем авторизацию...</div></main>;
  }

  if (!isAuthed) {
    return (
      <main className="min-h-screen bg-[#05080E] px-6 py-16 text-white">
        <div className="mx-auto max-w-6xl rounded-[24px] border border-red-500/25 bg-red-500/10 p-6">
          <p className="text-lg font-semibold">Нужен вход в аккаунт</p>
          <p className="mt-2 text-sm text-red-100/90">Чтобы создать обращение в поддержку, войдите в профиль.</p>
          <Link href="/profile" className="mt-5 inline-flex items-center gap-2 rounded-full border border-red-200/40 px-4 py-2 text-xs uppercase tracking-[0.2em] text-red-100">Вернуться в профиль</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#05080E] px-6 py-8 text-white">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="rounded-[24px] border border-white/10 bg-black/30 p-6 sm:p-8">
          <p className="text-xs uppercase tracking-[0.32em] text-cyan-300/70">Support Center</p>
          <h1 className="mt-2 text-3xl font-semibold">Поддержка</h1>
          <p className="mt-3 max-w-3xl text-sm text-white/75">Если что-то не работает, опишите проблему. Тикет попадет в админку, а обновления статуса придут на email аккаунта.</p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link href="/profile" className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-black/35 px-4 py-2 text-xs uppercase tracking-[0.2em] text-white/80"><LifeBuoy className="h-4 w-4" />Вернуться в профиль</Link>
            <button type="button" onClick={() => { void fetchTickets(); if (selectedId) void fetchDetails(selectedId); }} className="inline-flex items-center gap-2 rounded-full border border-cyan-300/45 bg-cyan-500/10 px-4 py-2 text-xs uppercase tracking-[0.2em] text-cyan-100"><RefreshCcw className="h-4 w-4" />Обновить тикеты</button>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-white/60">
            <p className="inline-flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5" />Последнее обновление: {fmtDate(lastUpdatedAt || undefined)}</p>
            <button type="button" onClick={() => setAutoRefresh((p) => !p)} className="rounded-full border border-white/20 px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-white/70">Автообновление: {autoRefresh ? "вкл" : "выкл"}</button>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.08fr_1fr]">
          <form onSubmit={onCreate} className="rounded-[24px] border border-white/10 bg-black/30 p-6 sm:p-8 space-y-4">
            <div className="flex items-center gap-2"><MessageSquare className="h-4 w-4 text-cyan-300" /><h2 className="text-xl font-semibold">Новое обращение</h2></div>

            <label className="block space-y-2"><span className="text-xs uppercase tracking-[0.2em] text-white/60">Тема</span><input value={form.subject} onChange={(e) => setForm((p) => ({ ...p, subject: e.target.value.slice(0, SUBJECT_MAX) }))} placeholder="Коротко: что случилось" className="w-full rounded-xl border border-white/15 bg-black/35 px-3 py-2.5 text-sm" />{fieldErr("subject") && <p className="text-xs text-red-200">{fieldErr("subject")}</p>}</label>

            <label className="block space-y-2"><span className="text-xs uppercase tracking-[0.2em] text-white/60">Категория</span><select value={form.category} onChange={(e) => setForm((p) => ({ ...p, category: e.target.value as SupportCategory }))} className="w-full rounded-xl border border-white/15 bg-black/35 px-3 py-2.5 text-sm">{CATEGORY_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select>{fieldErr("category") && <p className="text-xs text-red-200">{fieldErr("category")}</p>}</label>

            <label className="block space-y-2"><span className="text-xs uppercase tracking-[0.2em] text-white/60">Описание</span><textarea value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value.slice(0, DESCRIPTION_MAX) }))} rows={8} placeholder="Опишите шаги и что ожидали увидеть." className="w-full rounded-xl border border-white/15 bg-black/35 px-3 py-2.5 text-sm" /><div className="flex justify-between text-[11px] text-white/50"><span>Опишите, что вы делали, что произошло и что ожидали.</span><span>{form.description.length} / {DESCRIPTION_MAX}</span></div>{fieldErr("description") && <p className="text-xs text-red-200">{fieldErr("description")}</p>}</label>

            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3 space-y-2"><p className="text-xs uppercase tracking-[0.2em] text-white/60">Связать с</p><div className="grid gap-3 sm:grid-cols-2"><select value={form.linkedEntityType} onChange={(e) => setForm((p) => ({ ...p, linkedEntityType: e.target.value as LinkedEntityType, linkedEntityId: e.target.value === "none" ? "" : p.linkedEntityId }))} className="rounded-xl border border-white/15 bg-black/35 px-3 py-2.5 text-sm">{LINK_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select><input value={form.linkedEntityId} disabled={form.linkedEntityType === "none"} onChange={(e) => setForm((p) => ({ ...p, linkedEntityId: e.target.value.slice(0, 120) }))} placeholder="ID связанного объекта" className="rounded-xl border border-white/15 bg-black/35 px-3 py-2.5 text-sm disabled:opacity-50" /></div>{fieldErr("linkedEntityId") && <p className="text-xs text-red-200">{fieldErr("linkedEntityId")}</p>}</div>

            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3"><div className="flex justify-between text-xs text-white/60"><p className="uppercase tracking-[0.2em]">Вложения</p><p>{formAttachments.length} / {MAX_ATTACHMENTS}</p></div><label className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-full border border-white/20 px-3 py-1.5 text-xs text-white/80"><Paperclip className="h-3.5 w-3.5" />Прикрепить файл<input type="file" multiple className="hidden" accept={ALLOWED_EXTENSIONS.join(",")} onChange={(e) => { void handleUpload(e.target.files, "form"); e.currentTarget.value = ""; }} /></label>{formAttachments.length > 0 && <div className="mt-3 space-y-2">{formAttachments.map((a) => <div key={a.id} className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs"><span className="truncate">{a.fileName}</span><button type="button" onClick={() => setFormAttachments((p) => p.filter((x) => x.id !== a.id))}><X className="h-3.5 w-3.5" /></button></div>)}</div>}{formUploading && <p className="mt-2 text-xs text-white/60">Загрузка файлов...</p>}</div>

            {formError && <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-100">{formError}</div>}
            {!canCreate && formSubmitted && Object.keys(clientErrors).length > 0 && <p className="text-xs text-amber-100">Проверьте обязательные поля формы перед отправкой.</p>}

            <button type="submit" disabled={!canCreate} className="inline-flex items-center gap-2 rounded-full border border-cyan-300/45 bg-cyan-500/10 px-5 py-2 text-xs uppercase tracking-[0.2em] text-cyan-100 disabled:opacity-50">{formSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ticket className="h-4 w-4" />}{formSubmitting ? "Создаем..." : "Создать тикет"}</button>
          </form>

          <section className="rounded-[24px] border border-white/10 bg-black/30 p-6 sm:p-8">
            <div className="flex items-center justify-between"><h2 className="text-xl font-semibold">Мои обращения</h2><button type="button" onClick={() => void fetchTickets()} className="inline-flex items-center gap-1 rounded-full border border-white/20 px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-white/75"><RefreshCcw className="h-3.5 w-3.5" />Обновить</button></div>
            <div className="mt-4 space-y-3"><div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/45" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск по тикетам..." className="w-full rounded-xl border border-white/15 bg-black/35 py-2 pl-10 pr-3 text-sm" /></div><div className="flex flex-wrap gap-1.5">{STATUS_FILTERS.map((f) => <button key={f.value} type="button" onClick={() => setStatusFilter(f.value)} className={`rounded-full border px-3 py-1 text-[10px] uppercase tracking-[0.18em] ${statusFilter === f.value ? "border-cyan-300/50 bg-cyan-500/10 text-cyan-100" : "border-white/20 text-white/65"}`}>{f.label}</button>)}</div></div>

            <div className="mt-5 space-y-3">
              {ticketsLoading && <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="animate-pulse rounded-xl border border-white/10 bg-black/20 p-4"><div className="h-3 w-24 rounded bg-white/10" /><div className="mt-3 h-4 w-3/4 rounded bg-white/10" /><div className="mt-2 h-3 w-1/2 rounded bg-white/10" /></div>)}</div>}
              {!ticketsLoading && ticketsError && <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-100">Не удалось загрузить обращения<p className="mt-1 text-xs">{ticketsError}</p></div>}
              {!ticketsLoading && !ticketsError && tickets.length === 0 && <div className="rounded-xl border border-white/10 bg-black/20 p-5 text-center text-sm text-white/70"><FileText className="mx-auto h-5 w-5 text-white/45" /><p className="mt-2 font-medium text-white/80">У вас пока нет обращений</p><p className="mt-1 text-xs text-white/60">Создайте первое обращение через форму слева.</p></div>}
              {!ticketsLoading && !ticketsError && tickets.map((t) => <button key={t.id} type="button" onClick={() => setSelectedId(t.id)} className={`w-full rounded-xl border bg-black/20 p-4 text-left ${selectedId === t.id ? "border-cyan-300/45 bg-cyan-500/[0.08]" : "border-white/10"}`}><div className="flex justify-between"><p className="text-xs uppercase tracking-[0.18em] text-white/55">{t.publicId}</p><span className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] ${STATUS_TONE[t.status]}`}>{STATUS_LABELS[t.status]}</span></div><p className="mt-2 text-sm font-semibold">{t.subject}</p><p className="mt-1 text-[11px] uppercase tracking-[0.15em] text-white/45">{CATEGORY_LABELS[t.category]}</p><p className="mt-2 text-xs text-white/65 line-clamp-2">{t.descriptionPreview}</p><div className="mt-3 text-[11px] text-white/50">Обновлен: {fmtDate(t.updatedAt || t.createdAt)}</div>{t.hasSupportReply && <span className="mt-2 inline-flex rounded-full border border-emerald-300/45 bg-emerald-500/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-emerald-100">Есть ответ поддержки</span>}</button>)}
            </div>

            <div className="mt-6 border-t border-white/10 pt-6">
              <h3 className="text-lg font-semibold">Детали обращения</h3>
              {!selectedId && <p className="mt-3 rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white/65">Выберите обращение справа, чтобы посмотреть переписку.</p>}
              {selectedId && detailsLoading && <div className="mt-3 animate-pulse space-y-3 rounded-xl border border-white/10 bg-black/20 p-4"><div className="h-4 w-40 rounded bg-white/10" /><div className="h-3 w-3/4 rounded bg-white/10" /><div className="h-24 rounded bg-white/10" /></div>}
              {selectedId && !detailsLoading && detailsError && <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-100">Не удалось открыть обращение.<p className="mt-1 text-xs">{detailsError}</p></div>}
              {selectedId && !detailsLoading && !detailsError && details && (
                <div className="mt-3 space-y-4">
                  <div className="rounded-xl border border-white/10 bg-black/20 p-4"><div className="flex justify-between"><p className="text-xs uppercase tracking-[0.18em] text-white/55">{details.publicId}</p><span className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] ${STATUS_TONE[details.status]}`}>{STATUS_LABELS[details.status]}</span></div><h4 className="mt-2 text-base font-semibold">{details.subject}</h4><p className="mt-1 text-xs uppercase tracking-[0.15em] text-white/45">{CATEGORY_LABELS[details.category]}</p><div className="mt-3 text-xs text-white/60">Создан: {fmtDate(details.createdAt)} • Обновлен: {fmtDate(details.updatedAt)}</div>{details.linkedEntity && <p className="mt-2 text-xs text-white/70">Связанный объект: <span className="text-white/90">{details.linkedEntity.type} / {details.linkedEntity.id}</span></p>}</div>

                  <div className="space-y-3">{details.messages.map((m) => <article key={m.id} className={`rounded-xl border p-3 ${m.authorType === "SUPPORT" ? "border-emerald-300/30 bg-emerald-500/10" : "border-white/10 bg-black/20"}`}><div className="flex justify-between text-[11px] uppercase tracking-[0.16em]"><span>{m.authorType === "SUPPORT" ? "Поддержка" : "Вы"}</span><span>{fmtDate(m.createdAt)}</span></div><p className="mt-2 whitespace-pre-wrap text-sm text-white/85">{m.body}</p>{m.attachments?.length > 0 && <div className="mt-2 space-y-1">{m.attachments.map((a) => <a key={`${m.id}_${a.id}`} href={a.url || "#"} target="_blank" rel="noreferrer" className="inline-flex w-full justify-between rounded-lg border border-white/15 bg-black/25 px-3 py-1.5 text-xs text-white/80"><span className="truncate">{a.fileName}</span></a>)}</div>}</article>)}</div>

                  {details.status === "closed" ? <div className="rounded-xl border border-white/15 bg-black/20 px-4 py-3 text-sm text-white/70">Тикет закрыт. Создайте новое обращение, если проблема повторилась.</div> : <div className="rounded-xl border border-white/10 bg-black/20 p-4"><p className="text-xs uppercase tracking-[0.2em] text-white/60">Ответ пользователю</p><textarea value={reply} onChange={(e) => { setReply(e.target.value.slice(0, DESCRIPTION_MAX)); setReplyError(null); }} rows={4} placeholder="Напишите ответ..." className="mt-3 w-full rounded-xl border border-white/15 bg-black/35 px-3 py-2.5 text-sm" /><div className="mt-3 flex flex-wrap items-center gap-2"><label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-white/20 px-3 py-1.5 text-xs text-white/80"><Paperclip className="h-3.5 w-3.5" />Прикрепить файл<input type="file" multiple className="hidden" accept={ALLOWED_EXTENSIONS.join(",")} onChange={(e) => { void handleUpload(e.target.files, "reply"); e.currentTarget.value = ""; }} /></label>{replyUploading && <span className="text-xs text-white/60">Загрузка...</span>}</div>{replyAttachments.length > 0 && <div className="mt-3 space-y-2">{replyAttachments.map((a) => <div key={a.id} className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs"><span className="truncate">{a.fileName}</span><button type="button" onClick={() => setReplyAttachments((p) => p.filter((x) => x.id !== a.id))}><X className="h-3.5 w-3.5" /></button></div>)}</div>}{(replyError || (replySubmitted && reply.trim().length < 2)) && <p className="mt-3 text-xs text-red-200">{replyError || "Введите сообщение"}</p>}<button type="button" onClick={() => { setReplySubmitted(true); void onReply(); }} disabled={!canReply} className="mt-4 inline-flex items-center gap-2 rounded-full border border-cyan-300/45 bg-cyan-500/10 px-4 py-2 text-xs uppercase tracking-[0.2em] text-cyan-100 disabled:opacity-50">{replySending ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizontal className="h-4 w-4" />}{replySending ? "Отправляем..." : "Отправить ответ"}</button></div>}
                </div>
              )}
            </div>
          </section>
        </section>
      </div>
    </main>
  );
}
