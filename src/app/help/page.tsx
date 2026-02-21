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
  open: "\u041e\u0442\u043a\u0440\u044b\u0442",
  in_progress: "\u0412 \u0440\u0430\u0431\u043e\u0442\u0435",
  waiting_user: "\u0416\u0434\u0435\u0442 \u043e\u0442\u0432\u0435\u0442\u0430",
  resolved: "\u0420\u0435\u0448\u0435\u043d",
  closed: "\u0417\u0430\u043a\u0440\u044b\u0442",
};

const STATUS_FILTERS: Array<{ value: "all" | SupportStatus; label: string }> = [
  { value: "all", label: "\u0412\u0441\u0435" },
  { value: "open", label: "\u041e\u0442\u043a\u0440\u044b\u0442\u044b\u0435" },
  { value: "in_progress", label: "\u0412 \u0440\u0430\u0431\u043e\u0442\u0435" },
  { value: "waiting_user", label: "\u0416\u0434\u0435\u0442 \u043e\u0442\u0432\u0435\u0442\u0430" },
  { value: "closed", label: "\u0417\u0430\u043a\u0440\u044b\u0442\u044b\u0435" },
];

const STATUS_TONE: Record<SupportStatus, string> = {
  open: "border-cyan-300/45 bg-cyan-500/10 text-cyan-100",
  in_progress: "border-amber-300/45 bg-amber-500/10 text-amber-100",
  waiting_user: "border-orange-300/45 bg-orange-500/10 text-orange-100",
  resolved: "border-emerald-300/45 bg-emerald-500/10 text-emerald-100",
  closed: "border-white/25 bg-white/5 text-white/70",
};

const CATEGORY_OPTIONS: Array<{ value: SupportCategory; label: string }> = [
  { value: "ai_lab", label: "AI \u041b\u0430\u0431\u043e\u0440\u0430\u0442\u043e\u0440\u0438\u044f / \u0433\u0435\u043d\u0435\u0440\u0430\u0446\u0438\u044f" },
  { value: "print_order", label: "\u041f\u0435\u0447\u0430\u0442\u044c \u043d\u0430 \u0437\u0430\u043a\u0430\u0437" },
  { value: "digital_purchase", label: "\u0426\u0438\u0444\u0440\u043e\u0432\u0430\u044f \u043f\u043e\u043a\u0443\u043f\u043a\u0430 / \u0441\u043a\u0430\u0447\u0438\u0432\u0430\u043d\u0438\u0435" },
  { value: "payment", label: "\u041e\u043f\u043b\u0430\u0442\u0430 / \u043f\u043b\u0430\u0442\u0435\u0436" },
  { value: "delivery", label: "\u0414\u043e\u0441\u0442\u0430\u0432\u043a\u0430" },
  { value: "account", label: "\u0410\u043a\u043a\u0430\u0443\u043d\u0442 / \u0432\u0445\u043e\u0434 / \u043f\u0440\u043e\u0444\u0438\u043b\u044c" },
  { value: "bug_ui", label: "\u041e\u0448\u0438\u0431\u043a\u0430 \u0438\u043d\u0442\u0435\u0440\u0444\u0435\u0439\u0441\u0430" },
  { value: "other", label: "\u0414\u0440\u0443\u0433\u043e\u0435" },
];

const CATEGORY_LABELS: Record<SupportCategory, string> = {
  ai_lab: "AI \u041b\u0430\u0431\u043e\u0440\u0430\u0442\u043e\u0440\u0438\u044f",
  print_order: "\u041f\u0435\u0447\u0430\u0442\u044c",
  digital_purchase: "\u0426\u0438\u0444\u0440\u043e\u0432\u0430\u044f \u043f\u043e\u043a\u0443\u043f\u043a\u0430",
  payment: "\u041e\u043f\u043b\u0430\u0442\u0430",
  delivery: "\u0414\u043e\u0441\u0442\u0430\u0432\u043a\u0430",
  account: "\u0410\u043a\u043a\u0430\u0443\u043d\u0442",
  bug_ui: "\u041e\u0448\u0438\u0431\u043a\u0430 \u0438\u043d\u0442\u0435\u0440\u0444\u0435\u0439\u0441\u0430",
  other: "\u0414\u0440\u0443\u0433\u043e\u0435",
};

const LINK_OPTIONS: Array<{ value: LinkedEntityType; label: string }> = [
  { value: "none", label: "\u041d\u0435\u0442" },
  { value: "order", label: "\u0417\u0430\u043a\u0430\u0437" },
  { value: "ai_generation", label: "AI \u0433\u0435\u043d\u0435\u0440\u0430\u0446\u0438\u044f" },
  { value: "ai_asset", label: "AI \u0431\u0438\u0431\u043b\u0438\u043e\u0442\u0435\u043a\u0430" },
  { value: "digital_purchase", label: "\u0426\u0438\u0444\u0440\u043e\u0432\u0430\u044f \u043f\u043e\u043a\u0443\u043f\u043a\u0430" },
  { value: "print_order", label: "\u041f\u0435\u0447\u0430\u0442\u044c \u043d\u0430 \u0437\u0430\u043a\u0430\u0437" },
];

const fmtDate = (v?: string) => {
  if (!v) return "\u2014";
  const d = new Date(v);
  if (!Number.isFinite(d.getTime())) return "\u2014";
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
  if (f.subject.trim().length < 5) e.subject = "\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u0442\u0435\u043c\u0443 \u043e\u0431\u0440\u0430\u0449\u0435\u043d\u0438\u044f (\u043c\u0438\u043d\u0438\u043c\u0443\u043c 5 \u0441\u0438\u043c\u0432\u043e\u043b\u043e\u0432)";
  if (f.subject.trim().length > SUBJECT_MAX) e.subject = "\u0422\u0435\u043c\u0430 \u0441\u043b\u0438\u0448\u043a\u043e\u043c \u0434\u043b\u0438\u043d\u043d\u0430\u044f (\u043c\u0430\u043a\u0441\u0438\u043c\u0443\u043c 120 \u0441\u0438\u043c\u0432\u043e\u043b\u043e\u0432)";
  if (f.description.trim().length < 20) e.description = "\u041e\u043f\u0438\u0448\u0438\u0442\u0435 \u043f\u0440\u043e\u0431\u043b\u0435\u043c\u0443 \u043f\u043e\u0434\u0440\u043e\u0431\u043d\u0435\u0435 (\u043c\u0438\u043d\u0438\u043c\u0443\u043c 20 \u0441\u0438\u043c\u0432\u043e\u043b\u043e\u0432)";
  if (f.description.trim().length > DESCRIPTION_MAX) e.description = "\u041e\u043f\u0438\u0441\u0430\u043d\u0438\u0435 \u0441\u043b\u0438\u0448\u043a\u043e\u043c \u0434\u043b\u0438\u043d\u043d\u043e\u0435 (\u043c\u0430\u043a\u0441\u0438\u043c\u0443\u043c 5000 \u0441\u0438\u043c\u0432\u043e\u043b\u043e\u0432)";
  if (!f.category) e.category = "\u0412\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u043a\u0430\u0442\u0435\u0433\u043e\u0440\u0438\u044e \u043e\u0431\u0440\u0430\u0449\u0435\u043d\u0438\u044f";
  if (f.linkedEntityType !== "none" && !f.linkedEntityId.trim()) e.linkedEntityId = "\u0423\u043a\u0430\u0436\u0438\u0442\u0435 ID \u0441\u0432\u044f\u0437\u0430\u043d\u043d\u043e\u0433\u043e \u043e\u0431\u044a\u0435\u043a\u0442\u0430";
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
      throw new Error(p?.error || "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044c \u0444\u0430\u0439\u043b. \u041f\u043e\u0432\u0442\u043e\u0440\u0438\u0442\u0435 \u043f\u043e\u043f\u044b\u0442\u043a\u0443.");
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
      setErr(`\u041c\u043e\u0436\u043d\u043e \u043f\u0440\u0438\u043a\u0440\u0435\u043f\u0438\u0442\u044c \u043d\u0435 \u0431\u043e\u043b\u0435\u0435 ${MAX_ATTACHMENTS} \u0444\u0430\u0439\u043b\u043e\u0432`);
      return;
    }

    setUploading(true);
    setErr(null);
    try {
      for (const f of Array.from(files)) {
        if (f.size > MAX_ATTACHMENT_BYTES) {
          setErr("\u0424\u0430\u0439\u043b \u0441\u043b\u0438\u0448\u043a\u043e\u043c \u0431\u043e\u043b\u044c\u0448\u043e\u0439");
          continue;
        }
        if (!ALLOWED_EXTENSIONS.includes(ext(f.name))) {
          setErr("\u0424\u043e\u0440\u043c\u0430\u0442 \u0444\u0430\u0439\u043b\u0430 \u043d\u0435 \u043f\u043e\u0434\u0434\u0435\u0440\u0436\u0438\u0432\u0430\u0435\u0442\u0441\u044f");
          continue;
        }
        const uploaded = await uploadFile(f);
        setCurrent((prev) => [...prev, uploaded].slice(0, MAX_ATTACHMENTS));
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044c \u0444\u0430\u0439\u043b. \u041f\u043e\u0432\u0442\u043e\u0440\u0438\u0442\u0435 \u043f\u043e\u043f\u044b\u0442\u043a\u0443.");
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
      if (!r.ok || !p?.success) throw new Error(p?.error || "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044c \u043e\u0431\u0440\u0430\u0449\u0435\u043d\u0438\u044f.");
      const next = Array.isArray(p.tickets) ? p.tickets : [];
      setTickets(next);
      setLastUpdatedAt(p.lastUpdatedAt || new Date().toISOString());
      if (selectedId && !next.some((t: TicketListItem) => t.id === selectedId)) {
        setSelectedId(null);
        setDetails(null);
      }
    } catch (e) {
      setTicketsError(e instanceof Error ? e.message : "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044c \u043e\u0431\u0440\u0430\u0449\u0435\u043d\u0438\u044f.");
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
      if (!r.ok || !p?.success || !p?.ticket) throw new Error(p?.error || "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043e\u0442\u043a\u0440\u044b\u0442\u044c \u043e\u0431\u0440\u0430\u0449\u0435\u043d\u0438\u0435.");
      setDetails(p.ticket as TicketDetails);
    } catch (e) {
      setDetailsError(e instanceof Error ? e.message : "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043e\u0442\u043a\u0440\u044b\u0442\u044c \u043e\u0431\u0440\u0430\u0449\u0435\u043d\u0438\u0435.");
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
        throw new Error(p?.error || "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0441\u043e\u0437\u0434\u0430\u0442\u044c \u0442\u0438\u043a\u0435\u0442. \u041f\u043e\u0432\u0442\u043e\u0440\u0438\u0442\u0435 \u043f\u043e\u043f\u044b\u0442\u043a\u0443.");
      }

      toast.success("\u0422\u0438\u043a\u0435\u0442 \u0441\u043e\u0437\u0434\u0430\u043d");
      setForm({ subject: "", category: "other", description: "", linkedEntityType: "none", linkedEntityId: "" });
      setFormSubmitted(false);
      setFormAttachments([]);
      await fetchTickets();
      if (p?.ticket?.id) {
        setSelectedId(String(p.ticket.id));
        await fetchDetails(String(p.ticket.id));
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0441\u043e\u0437\u0434\u0430\u0442\u044c \u0442\u0438\u043a\u0435\u0442. \u041f\u043e\u0432\u0442\u043e\u0440\u0438\u0442\u0435 \u043f\u043e\u043f\u044b\u0442\u043a\u0443.");
    } finally {
      setFormSubmitting(false);
    }
  };

  const onReply = async () => {
    if (!selectedId || !canReply) return;
    setReplySubmitted(true);
    setReplyError(null);

    if (reply.trim().length < 2) {
      setReplyError("\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u0435");
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
      if (!r.ok || !p?.success) throw new Error(p?.error || "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043e\u0442\u043f\u0440\u0430\u0432\u0438\u0442\u044c \u043e\u0442\u0432\u0435\u0442.");
      toast.success("\u041e\u0442\u0432\u0435\u0442 \u043e\u0442\u043f\u0440\u0430\u0432\u043b\u0435\u043d");
      setReply("");
      setReplySubmitted(false);
      setReplyAttachments([]);
      if (p?.ticket) setDetails(p.ticket as TicketDetails);
      await fetchTickets(true);
    } catch (err) {
      setReplyError(err instanceof Error ? err.message : "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043e\u0442\u043f\u0440\u0430\u0432\u0438\u0442\u044c \u043e\u0442\u0432\u0435\u0442.");
    } finally {
      setReplySending(false);
    }
  };

  const fieldErr = (field: string) => formServerErrors[field] || (formSubmitted ? clientErrors[field] : undefined) || undefined;

  if (authLoading) {
    return <main className="min-h-screen bg-[#05080E] px-6 py-16 text-white"><div className="mx-auto max-w-6xl rounded-[24px] border border-white/10 bg-black/30 p-6">\u041f\u0440\u043e\u0432\u0435\u0440\u044f\u0435\u043c \u0430\u0432\u0442\u043e\u0440\u0438\u0437\u0430\u0446\u0438\u044e...</div></main>;
  }

  if (!isAuthed) {
    return (
      <main className="min-h-screen bg-[#05080E] px-6 py-16 text-white">
        <div className="mx-auto max-w-6xl rounded-[24px] border border-red-500/25 bg-red-500/10 p-6">
          <p className="text-lg font-semibold">\u041d\u0443\u0436\u0435\u043d \u0432\u0445\u043e\u0434 \u0432 \u0430\u043a\u043a\u0430\u0443\u043d\u0442</p>
          <p className="mt-2 text-sm text-red-100/90">\u0427\u0442\u043e\u0431\u044b \u0441\u043e\u0437\u0434\u0430\u0442\u044c \u043e\u0431\u0440\u0430\u0449\u0435\u043d\u0438\u0435 \u0432 \u043f\u043e\u0434\u0434\u0435\u0440\u0436\u043a\u0443, \u0432\u043e\u0439\u0434\u0438\u0442\u0435 \u0432 \u043f\u0440\u043e\u0444\u0438\u043b\u044c.</p>
          <Link href="/profile" className="mt-5 inline-flex items-center gap-2 rounded-full border border-red-200/40 px-4 py-2 text-xs uppercase tracking-[0.2em] text-red-100">\u0412\u0435\u0440\u043d\u0443\u0442\u044c\u0441\u044f \u0432 \u043f\u0440\u043e\u0444\u0438\u043b\u044c</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#05080E] px-6 py-8 text-white">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="rounded-[24px] border border-white/10 bg-black/30 p-6 sm:p-8">
          <p className="text-xs uppercase tracking-[0.32em] text-cyan-300/70">Support Center</p>
          <h1 className="mt-2 text-3xl font-semibold">\u041f\u043e\u0434\u0434\u0435\u0440\u0436\u043a\u0430</h1>
          <p className="mt-3 max-w-3xl text-sm text-white/75">\u0415\u0441\u043b\u0438 \u0447\u0442\u043e-\u0442\u043e \u043d\u0435 \u0440\u0430\u0431\u043e\u0442\u0430\u0435\u0442, \u043e\u043f\u0438\u0448\u0438\u0442\u0435 \u043f\u0440\u043e\u0431\u043b\u0435\u043c\u0443. \u0422\u0438\u043a\u0435\u0442 \u043f\u043e\u043f\u0430\u0434\u0435\u0442 \u0432 \u0430\u0434\u043c\u0438\u043d\u043a\u0443, \u0430 \u043e\u0431\u043d\u043e\u0432\u043b\u0435\u043d\u0438\u044f \u0441\u0442\u0430\u0442\u0443\u0441\u0430 \u043f\u0440\u0438\u0434\u0443\u0442 \u043d\u0430 email \u0430\u043a\u043a\u0430\u0443\u043d\u0442\u0430.</p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link href="/profile" className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-black/35 px-4 py-2 text-xs uppercase tracking-[0.2em] text-white/80"><LifeBuoy className="h-4 w-4" />\u0412\u0435\u0440\u043d\u0443\u0442\u044c\u0441\u044f \u0432 \u043f\u0440\u043e\u0444\u0438\u043b\u044c</Link>
            <button type="button" onClick={() => { void fetchTickets(); if (selectedId) void fetchDetails(selectedId); }} className="inline-flex items-center gap-2 rounded-full border border-cyan-300/45 bg-cyan-500/10 px-4 py-2 text-xs uppercase tracking-[0.2em] text-cyan-100"><RefreshCcw className="h-4 w-4" />\u041e\u0431\u043d\u043e\u0432\u0438\u0442\u044c \u0442\u0438\u043a\u0435\u0442\u044b</button>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-white/60">
            <p className="inline-flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5" />\u041f\u043e\u0441\u043b\u0435\u0434\u043d\u0435\u0435 \u043e\u0431\u043d\u043e\u0432\u043b\u0435\u043d\u0438\u0435: {fmtDate(lastUpdatedAt || undefined)}</p>
            <button type="button" onClick={() => setAutoRefresh((p) => !p)} className="rounded-full border border-white/20 px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-white/70">\u0410\u0432\u0442\u043e\u043e\u0431\u043d\u043e\u0432\u043b\u0435\u043d\u0438\u0435: {autoRefresh ? "\u0432\u043a\u043b" : "\u0432\u044b\u043a\u043b"}</button>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.08fr_1fr]">
          <form onSubmit={onCreate} className="rounded-[24px] border border-white/10 bg-black/30 p-6 sm:p-8 space-y-4">
            <div className="flex items-center gap-2"><MessageSquare className="h-4 w-4 text-cyan-300" /><h2 className="text-xl font-semibold">\u041d\u043e\u0432\u043e\u0435 \u043e\u0431\u0440\u0430\u0449\u0435\u043d\u0438\u0435</h2></div>

            <label className="block space-y-2"><span className="text-xs uppercase tracking-[0.2em] text-white/60">\u0422\u0435\u043c\u0430</span><input value={form.subject} onChange={(e) => setForm((p) => ({ ...p, subject: e.target.value.slice(0, SUBJECT_MAX) }))} placeholder="\u041a\u043e\u0440\u043e\u0442\u043a\u043e: \u0447\u0442\u043e \u0441\u043b\u0443\u0447\u0438\u043b\u043e\u0441\u044c" className="w-full rounded-xl border border-white/15 bg-black/35 px-3 py-2.5 text-sm" />{fieldErr("subject") && <p className="text-xs text-red-200">{fieldErr("subject")}</p>}</label>

            <label className="block space-y-2"><span className="text-xs uppercase tracking-[0.2em] text-white/60">\u041a\u0430\u0442\u0435\u0433\u043e\u0440\u0438\u044f</span><select value={form.category} onChange={(e) => setForm((p) => ({ ...p, category: e.target.value as SupportCategory }))} className="w-full rounded-xl border border-white/15 bg-black/35 px-3 py-2.5 text-sm">{CATEGORY_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select>{fieldErr("category") && <p className="text-xs text-red-200">{fieldErr("category")}</p>}</label>

            <label className="block space-y-2"><span className="text-xs uppercase tracking-[0.2em] text-white/60">\u041e\u043f\u0438\u0441\u0430\u043d\u0438\u0435</span><textarea value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value.slice(0, DESCRIPTION_MAX) }))} rows={8} placeholder="\u041e\u043f\u0438\u0448\u0438\u0442\u0435 \u0448\u0430\u0433\u0438 \u0438 \u0447\u0442\u043e \u043e\u0436\u0438\u0434\u0430\u043b\u0438 \u0443\u0432\u0438\u0434\u0435\u0442\u044c." className="w-full rounded-xl border border-white/15 bg-black/35 px-3 py-2.5 text-sm" /><div className="flex justify-between text-[11px] text-white/50"><span>\u041e\u043f\u0438\u0448\u0438\u0442\u0435, \u0447\u0442\u043e \u0432\u044b \u0434\u0435\u043b\u0430\u043b\u0438, \u0447\u0442\u043e \u043f\u0440\u043e\u0438\u0437\u043e\u0448\u043b\u043e \u0438 \u0447\u0442\u043e \u043e\u0436\u0438\u0434\u0430\u043b\u0438.</span><span>{form.description.length} / {DESCRIPTION_MAX}</span></div>{fieldErr("description") && <p className="text-xs text-red-200">{fieldErr("description")}</p>}</label>

            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3 space-y-2"><p className="text-xs uppercase tracking-[0.2em] text-white/60">\u0421\u0432\u044f\u0437\u0430\u0442\u044c \u0441</p><div className="grid gap-3 sm:grid-cols-2"><select value={form.linkedEntityType} onChange={(e) => setForm((p) => ({ ...p, linkedEntityType: e.target.value as LinkedEntityType, linkedEntityId: e.target.value === "none" ? "" : p.linkedEntityId }))} className="rounded-xl border border-white/15 bg-black/35 px-3 py-2.5 text-sm">{LINK_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select><input value={form.linkedEntityId} disabled={form.linkedEntityType === "none"} onChange={(e) => setForm((p) => ({ ...p, linkedEntityId: e.target.value.slice(0, 120) }))} placeholder="ID \u0441\u0432\u044f\u0437\u0430\u043d\u043d\u043e\u0433\u043e \u043e\u0431\u044a\u0435\u043a\u0442\u0430" className="rounded-xl border border-white/15 bg-black/35 px-3 py-2.5 text-sm disabled:opacity-50" /></div>{fieldErr("linkedEntityId") && <p className="text-xs text-red-200">{fieldErr("linkedEntityId")}</p>}</div>

            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3"><div className="flex justify-between text-xs text-white/60"><p className="uppercase tracking-[0.2em]">\u0412\u043b\u043e\u0436\u0435\u043d\u0438\u044f</p><p>{formAttachments.length} / {MAX_ATTACHMENTS}</p></div><label className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-full border border-white/20 px-3 py-1.5 text-xs text-white/80"><Paperclip className="h-3.5 w-3.5" />\u041f\u0440\u0438\u043a\u0440\u0435\u043f\u0438\u0442\u044c \u0444\u0430\u0439\u043b<input type="file" multiple className="hidden" accept={ALLOWED_EXTENSIONS.join(",")} onChange={(e) => { void handleUpload(e.target.files, "form"); e.currentTarget.value = ""; }} /></label>{formAttachments.length > 0 && <div className="mt-3 space-y-2">{formAttachments.map((a) => <div key={a.id} className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs"><span className="truncate">{a.fileName}</span><button type="button" onClick={() => setFormAttachments((p) => p.filter((x) => x.id !== a.id))}><X className="h-3.5 w-3.5" /></button></div>)}</div>}{formUploading && <p className="mt-2 text-xs text-white/60">\u0417\u0430\u0433\u0440\u0443\u0437\u043a\u0430 \u0444\u0430\u0439\u043b\u043e\u0432...</p>}</div>

            {formError && <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-100">{formError}</div>}
            {!canCreate && formSubmitted && Object.keys(clientErrors).length > 0 && <p className="text-xs text-amber-100">\u041f\u0440\u043e\u0432\u0435\u0440\u044c\u0442\u0435 \u043e\u0431\u044f\u0437\u0430\u0442\u0435\u043b\u044c\u043d\u044b\u0435 \u043f\u043e\u043b\u044f \u0444\u043e\u0440\u043c\u044b \u043f\u0435\u0440\u0435\u0434 \u043e\u0442\u043f\u0440\u0430\u0432\u043a\u043e\u0439.</p>}

            <button type="submit" disabled={!canCreate} className="inline-flex items-center gap-2 rounded-full border border-cyan-300/45 bg-cyan-500/10 px-5 py-2 text-xs uppercase tracking-[0.2em] text-cyan-100 disabled:opacity-50">{formSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ticket className="h-4 w-4" />}{formSubmitting ? "\u0421\u043e\u0437\u0434\u0430\u0435\u043c..." : "\u0421\u043e\u0437\u0434\u0430\u0442\u044c \u0442\u0438\u043a\u0435\u0442"}</button>
          </form>

          <section className="rounded-[24px] border border-white/10 bg-black/30 p-6 sm:p-8">
            <div className="flex items-center justify-between"><h2 className="text-xl font-semibold">\u041c\u043e\u0438 \u043e\u0431\u0440\u0430\u0449\u0435\u043d\u0438\u044f</h2><button type="button" onClick={() => void fetchTickets()} className="inline-flex items-center gap-1 rounded-full border border-white/20 px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-white/75"><RefreshCcw className="h-3.5 w-3.5" />\u041e\u0431\u043d\u043e\u0432\u0438\u0442\u044c</button></div>
            <div className="mt-4 space-y-3"><div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/45" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="\u041f\u043e\u0438\u0441\u043a \u043f\u043e \u0442\u0438\u043a\u0435\u0442\u0430\u043c..." className="w-full rounded-xl border border-white/15 bg-black/35 py-2 pl-10 pr-3 text-sm" /></div><div className="flex flex-wrap gap-1.5">{STATUS_FILTERS.map((f) => <button key={f.value} type="button" onClick={() => setStatusFilter(f.value)} className={`rounded-full border px-3 py-1 text-[10px] uppercase tracking-[0.18em] ${statusFilter === f.value ? "border-cyan-300/50 bg-cyan-500/10 text-cyan-100" : "border-white/20 text-white/65"}`}>{f.label}</button>)}</div></div>

            <div className="mt-5 space-y-3">
              {ticketsLoading && <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="animate-pulse rounded-xl border border-white/10 bg-black/20 p-4"><div className="h-3 w-24 rounded bg-white/10" /><div className="mt-3 h-4 w-3/4 rounded bg-white/10" /><div className="mt-2 h-3 w-1/2 rounded bg-white/10" /></div>)}</div>}
              {!ticketsLoading && ticketsError && <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-100">\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044c \u043e\u0431\u0440\u0430\u0449\u0435\u043d\u0438\u044f<p className="mt-1 text-xs">{ticketsError}</p></div>}
              {!ticketsLoading && !ticketsError && tickets.length === 0 && <div className="rounded-xl border border-white/10 bg-black/20 p-5 text-center text-sm text-white/70"><FileText className="mx-auto h-5 w-5 text-white/45" /><p className="mt-2 font-medium text-white/80">\u0423 \u0432\u0430\u0441 \u043f\u043e\u043a\u0430 \u043d\u0435\u0442 \u043e\u0431\u0440\u0430\u0449\u0435\u043d\u0438\u0439</p><p className="mt-1 text-xs text-white/60">\u0421\u043e\u0437\u0434\u0430\u0439\u0442\u0435 \u043f\u0435\u0440\u0432\u043e\u0435 \u043e\u0431\u0440\u0430\u0449\u0435\u043d\u0438\u0435 \u0447\u0435\u0440\u0435\u0437 \u0444\u043e\u0440\u043c\u0443 \u0441\u043b\u0435\u0432\u0430.</p></div>}
              {!ticketsLoading && !ticketsError && tickets.map((t) => <button key={t.id} type="button" onClick={() => setSelectedId(t.id)} className={`w-full rounded-xl border bg-black/20 p-4 text-left ${selectedId === t.id ? "border-cyan-300/45 bg-cyan-500/[0.08]" : "border-white/10"}`}><div className="flex justify-between"><p className="text-xs uppercase tracking-[0.18em] text-white/55">{t.publicId}</p><span className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] ${STATUS_TONE[t.status]}`}>{STATUS_LABELS[t.status]}</span></div><p className="mt-2 text-sm font-semibold">{t.subject}</p><p className="mt-1 text-[11px] uppercase tracking-[0.15em] text-white/45">{CATEGORY_LABELS[t.category]}</p><p className="mt-2 text-xs text-white/65 line-clamp-2">{t.descriptionPreview}</p><div className="mt-3 text-[11px] text-white/50">\u041e\u0431\u043d\u043e\u0432\u043b\u0435\u043d: {fmtDate(t.updatedAt || t.createdAt)}</div>{t.hasSupportReply && <span className="mt-2 inline-flex rounded-full border border-emerald-300/45 bg-emerald-500/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-emerald-100">\u0415\u0441\u0442\u044c \u043e\u0442\u0432\u0435\u0442 \u043f\u043e\u0434\u0434\u0435\u0440\u0436\u043a\u0438</span>}</button>)}
            </div>

            <div className="mt-6 border-t border-white/10 pt-6">
              <h3 className="text-lg font-semibold">\u0414\u0435\u0442\u0430\u043b\u0438 \u043e\u0431\u0440\u0430\u0449\u0435\u043d\u0438\u044f</h3>
              {!selectedId && <p className="mt-3 rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white/65">\u0412\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u043e\u0431\u0440\u0430\u0449\u0435\u043d\u0438\u0435 \u0441\u043f\u0440\u0430\u0432\u0430, \u0447\u0442\u043e\u0431\u044b \u043f\u043e\u0441\u043c\u043e\u0442\u0440\u0435\u0442\u044c \u043f\u0435\u0440\u0435\u043f\u0438\u0441\u043a\u0443.</p>}
              {selectedId && detailsLoading && <div className="mt-3 animate-pulse space-y-3 rounded-xl border border-white/10 bg-black/20 p-4"><div className="h-4 w-40 rounded bg-white/10" /><div className="h-3 w-3/4 rounded bg-white/10" /><div className="h-24 rounded bg-white/10" /></div>}
              {selectedId && !detailsLoading && detailsError && <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-100">\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043e\u0442\u043a\u0440\u044b\u0442\u044c \u043e\u0431\u0440\u0430\u0449\u0435\u043d\u0438\u0435.<p className="mt-1 text-xs">{detailsError}</p></div>}
              {selectedId && !detailsLoading && !detailsError && details && (
                <div className="mt-3 space-y-4">
                  <div className="rounded-xl border border-white/10 bg-black/20 p-4"><div className="flex justify-between"><p className="text-xs uppercase tracking-[0.18em] text-white/55">{details.publicId}</p><span className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] ${STATUS_TONE[details.status]}`}>{STATUS_LABELS[details.status]}</span></div><h4 className="mt-2 text-base font-semibold">{details.subject}</h4><p className="mt-1 text-xs uppercase tracking-[0.15em] text-white/45">{CATEGORY_LABELS[details.category]}</p><div className="mt-3 text-xs text-white/60">\u0421\u043e\u0437\u0434\u0430\u043d: {fmtDate(details.createdAt)} \u2022 \u041e\u0431\u043d\u043e\u0432\u043b\u0435\u043d: {fmtDate(details.updatedAt)}</div>{details.linkedEntity && <p className="mt-2 text-xs text-white/70">\u0421\u0432\u044f\u0437\u0430\u043d\u043d\u044b\u0439 \u043e\u0431\u044a\u0435\u043a\u0442: <span className="text-white/90">{details.linkedEntity.type} / {details.linkedEntity.id}</span></p>}</div>

                  <div className="space-y-3">{details.messages.map((m) => <article key={m.id} className={`rounded-xl border p-3 ${m.authorType === "SUPPORT" ? "border-emerald-300/30 bg-emerald-500/10" : "border-white/10 bg-black/20"}`}><div className="flex justify-between text-[11px] uppercase tracking-[0.16em]"><span>{m.authorType === "SUPPORT" ? "\u041f\u043e\u0434\u0434\u0435\u0440\u0436\u043a\u0430" : "\u0412\u044b"}</span><span>{fmtDate(m.createdAt)}</span></div><p className="mt-2 whitespace-pre-wrap text-sm text-white/85">{m.body}</p>{m.attachments?.length > 0 && <div className="mt-2 space-y-1">{m.attachments.map((a) => <a key={`${m.id}_${a.id}`} href={a.url || "#"} target="_blank" rel="noreferrer" className="inline-flex w-full justify-between rounded-lg border border-white/15 bg-black/25 px-3 py-1.5 text-xs text-white/80"><span className="truncate">{a.fileName}</span></a>)}</div>}</article>)}</div>

                  {details.status === "closed" ? <div className="rounded-xl border border-white/15 bg-black/20 px-4 py-3 text-sm text-white/70">\u0422\u0438\u043a\u0435\u0442 \u0437\u0430\u043a\u0440\u044b\u0442. \u0421\u043e\u0437\u0434\u0430\u0439\u0442\u0435 \u043d\u043e\u0432\u043e\u0435 \u043e\u0431\u0440\u0430\u0449\u0435\u043d\u0438\u0435, \u0435\u0441\u043b\u0438 \u043f\u0440\u043e\u0431\u043b\u0435\u043c\u0430 \u043f\u043e\u0432\u0442\u043e\u0440\u0438\u043b\u0430\u0441\u044c.</div> : <div className="rounded-xl border border-white/10 bg-black/20 p-4"><p className="text-xs uppercase tracking-[0.2em] text-white/60">\u041e\u0442\u0432\u0435\u0442 \u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u044e</p><textarea value={reply} onChange={(e) => { setReply(e.target.value.slice(0, DESCRIPTION_MAX)); setReplyError(null); }} rows={4} placeholder="\u041d\u0430\u043f\u0438\u0448\u0438\u0442\u0435 \u043e\u0442\u0432\u0435\u0442..." className="mt-3 w-full rounded-xl border border-white/15 bg-black/35 px-3 py-2.5 text-sm" /><div className="mt-3 flex flex-wrap items-center gap-2"><label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-white/20 px-3 py-1.5 text-xs text-white/80"><Paperclip className="h-3.5 w-3.5" />\u041f\u0440\u0438\u043a\u0440\u0435\u043f\u0438\u0442\u044c \u0444\u0430\u0439\u043b<input type="file" multiple className="hidden" accept={ALLOWED_EXTENSIONS.join(",")} onChange={(e) => { void handleUpload(e.target.files, "reply"); e.currentTarget.value = ""; }} /></label>{replyUploading && <span className="text-xs text-white/60">\u0417\u0430\u0433\u0440\u0443\u0437\u043a\u0430...</span>}</div>{replyAttachments.length > 0 && <div className="mt-3 space-y-2">{replyAttachments.map((a) => <div key={a.id} className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs"><span className="truncate">{a.fileName}</span><button type="button" onClick={() => setReplyAttachments((p) => p.filter((x) => x.id !== a.id))}><X className="h-3.5 w-3.5" /></button></div>)}</div>}{(replyError || (replySubmitted && reply.trim().length < 2)) && <p className="mt-3 text-xs text-red-200">{replyError || "\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u0435"}</p>}<button type="button" onClick={() => { setReplySubmitted(true); void onReply(); }} disabled={!canReply} className="mt-4 inline-flex items-center gap-2 rounded-full border border-cyan-300/45 bg-cyan-500/10 px-4 py-2 text-xs uppercase tracking-[0.2em] text-cyan-100 disabled:opacity-50">{replySending ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizontal className="h-4 w-4" />}{replySending ? "\u041e\u0442\u043f\u0440\u0430\u0432\u043b\u044f\u0435\u043c..." : "\u041e\u0442\u043f\u0440\u0430\u0432\u0438\u0442\u044c \u043e\u0442\u0432\u0435\u0442"}</button></div>}
                </div>
              )}
            </div>
          </section>
        </section>
      </div>
    </main>
  );
}
