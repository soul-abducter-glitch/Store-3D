"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, RefreshCcw, ShieldCheck, Wrench } from "lucide-react";

type OverviewResponse = {
  success: boolean;
  error?: string;
  window?: { hours: number; since: string };
  readiness?: {
    ok: boolean;
    checks: Array<{ name: string; ok: boolean; required: boolean; message: string }>;
  };
  jobs?: {
    total: number;
    statusCounts: Record<string, number>;
    staleMinutes: number;
    staleJobs: number;
    oldestActiveAgeMinutes: number;
  };
  tokens?: {
    spend: number;
    refund: number;
    topup: number;
    adjust: number;
    net: number;
    events: number;
    topUsers: Array<{
      user: { id: string; email: string; name: string };
      spend: number;
      refund: number;
      topup: number;
      adjust: number;
      net: number;
      balanceAfter: number | null;
    }>;
  };
  failures?: Array<{
    id: string;
    user: { id: string; email: string; name: string };
    provider: string;
    mode: string;
    status: string;
    prompt: string;
    error: string;
    updatedAt: string;
  }>;
};

const formatDateTime = (value?: string) => {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return date.toLocaleString("ru-RU");
};

const formatNumber = (value: number | undefined) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return "0";
  return new Intl.NumberFormat("ru-RU").format(value);
};

const metricClass = "rounded-2xl border border-white/10 bg-black/30 p-4";

export default function AdminToolsPage() {
  const [windowHours, setWindowHours] = useState(24);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState<OverviewResponse | null>(null);

  const loadOverview = useCallback(async (hours: number) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/ai/overview?hours=${hours}`, {
        cache: "no-store",
      });
      const json = (await res.json().catch(() => ({}))) as OverviewResponse;
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      setData(json);
    } catch (fetchError) {
      setData(null);
      setError(fetchError instanceof Error ? fetchError.message : "Ошибка загрузки инструмента.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOverview(windowHours);
  }, [windowHours, loadOverview]);

  const statusCounts = useMemo(() => data?.jobs?.statusCounts || {}, [data]);
  const topUsers = data?.tokens?.topUsers || [];
  const failures = data?.failures || [];

  return (
    <main className="min-h-screen bg-[#06090f] text-white">
      <div className="mx-auto max-w-7xl px-6 py-10">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="mb-2 text-xs uppercase tracking-[0.35em] text-cyan-300/70">Ops Console</p>
            <h1 className="text-3xl font-semibold">AI инструменты админа</h1>
            <p className="mt-2 text-sm text-white/60">
              Мониторинг токенов, статусов генераций и ошибок в одном месте.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={windowHours}
              onChange={(event) => setWindowHours(Number(event.target.value) || 24)}
              className="rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-sm"
            >
              <option value={24}>24 часа</option>
              <option value={72}>3 дня</option>
              <option value={168}>7 дней</option>
            </select>
            <button
              type="button"
              onClick={() => loadOverview(windowHours)}
              className="inline-flex items-center gap-2 rounded-xl border border-cyan-400/40 bg-cyan-500/10 px-4 py-2 text-sm"
            >
              <RefreshCcw className="h-4 w-4" />
              Обновить
            </button>
            <Link
              href="/ai-lab"
              className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-black/30 px-4 py-2 text-sm"
            >
              <Wrench className="h-4 w-4" />
              К AI Lab
            </Link>
          </div>
        </div>

        {loading && <div className="rounded-2xl border border-white/10 bg-black/30 p-4">Загрузка…</div>}

        {!loading && error && (
          <div className="rounded-2xl border border-red-500/35 bg-red-500/10 p-4 text-sm text-red-200">
            {error}
          </div>
        )}

        {!loading && !error && data && (
          <div className="space-y-6">
            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <article className={metricClass}>
                <p className="mb-2 text-xs uppercase tracking-[0.25em] text-white/50">Токены списано</p>
                <p className="text-3xl font-semibold text-cyan-300">
                  {formatNumber(data.tokens?.spend || 0)}
                </p>
              </article>
              <article className={metricClass}>
                <p className="mb-2 text-xs uppercase tracking-[0.25em] text-white/50">Пополнено</p>
                <p className="text-3xl font-semibold text-emerald-300">
                  {formatNumber(data.tokens?.topup || 0)}
                </p>
              </article>
              <article className={metricClass}>
                <p className="mb-2 text-xs uppercase tracking-[0.25em] text-white/50">Задач всего</p>
                <p className="text-3xl font-semibold text-white">{formatNumber(data.jobs?.total || 0)}</p>
              </article>
              <article className={metricClass}>
                <p className="mb-2 text-xs uppercase tracking-[0.25em] text-white/50">Зависшие</p>
                <p className="text-3xl font-semibold text-amber-300">
                  {formatNumber(data.jobs?.staleJobs || 0)}
                </p>
                <p className="mt-1 text-xs text-white/50">
                  старше {data.jobs?.staleMinutes || 30} мин
                </p>
              </article>
            </section>

            <section className="grid gap-4 lg:grid-cols-2">
              <article className={metricClass}>
                <div className="mb-4 flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-cyan-300" />
                  <h2 className="text-lg font-semibold">Readiness</h2>
                </div>
                <div className="space-y-3 text-sm">
                  {(data.readiness?.checks || []).map((check) => (
                    <div key={check.name} className="rounded-xl border border-white/10 bg-black/25 p-3">
                      <p className="font-medium">
                        {check.name}{" "}
                        <span className={check.ok ? "text-emerald-300" : "text-red-300"}>
                          {check.ok ? "OK" : "FAIL"}
                        </span>
                      </p>
                      <p className="mt-1 text-white/70">{check.message}</p>
                    </div>
                  ))}
                </div>
              </article>

              <article className={metricClass}>
                <h2 className="mb-4 text-lg font-semibold">Статусы AI jobs</h2>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  {Object.entries(statusCounts).map(([status, count]) => (
                    <div key={status} className="rounded-xl border border-white/10 bg-black/25 p-3">
                      <p className="uppercase tracking-[0.2em] text-white/60">{status}</p>
                      <p className="mt-1 text-2xl font-semibold">{formatNumber(count)}</p>
                    </div>
                  ))}
                </div>
                <p className="mt-4 text-xs text-white/50">
                  Самая старая активная задача: {formatNumber(data.jobs?.oldestActiveAgeMinutes || 0)} мин
                </p>
              </article>
            </section>

            <section className="grid gap-4 lg:grid-cols-2">
              <article className={metricClass}>
                <h2 className="mb-4 text-lg font-semibold">Топ по расходу токенов</h2>
                <div className="space-y-3 text-sm">
                  {topUsers.length === 0 && <p className="text-white/60">Нет данных за выбранный период.</p>}
                  {topUsers.map((row) => (
                    <div key={row.user.id} className="rounded-xl border border-white/10 bg-black/25 p-3">
                      <p className="font-medium">{row.user.name || row.user.email || row.user.id}</p>
                      <p className="text-xs text-white/50">{row.user.email || row.user.id}</p>
                      <div className="mt-2 flex flex-wrap gap-3 text-xs">
                        <span className="text-cyan-300">spend: {formatNumber(row.spend)}</span>
                        <span className="text-emerald-300">topup: {formatNumber(row.topup)}</span>
                        <span className="text-amber-300">refund: {formatNumber(row.refund)}</span>
                        <span className="text-white/70">balance: {formatNumber(row.balanceAfter || 0)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </article>

              <article className={metricClass}>
                <div className="mb-4 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-300" />
                  <h2 className="text-lg font-semibold">Последние ошибки генерации</h2>
                </div>
                <div className="space-y-3 text-sm">
                  {failures.length === 0 && <p className="text-white/60">Ошибок нет.</p>}
                  {failures.map((row) => (
                    <div key={row.id} className="rounded-xl border border-white/10 bg-black/25 p-3">
                      <p className="font-medium">{row.user.email || row.user.id}</p>
                      <p className="mt-1 text-xs text-white/50">
                        {row.provider} · {row.mode} · {formatDateTime(row.updatedAt)}
                      </p>
                      {row.error && <p className="mt-2 text-red-200">{row.error}</p>}
                      {row.prompt && <p className="mt-1 text-white/70">{row.prompt}</p>}
                    </div>
                  ))}
                </div>
              </article>
            </section>
          </div>
        )}
      </div>
    </main>
  );
}

