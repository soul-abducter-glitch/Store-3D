"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, RefreshCcw, ShieldCheck, Wrench } from "lucide-react";

type OverviewResponse = {
  success: boolean;
  error?: string;
  filters?: { hours: number; user?: string | null };
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
    successRate?: number;
    queueDepth?: number;
    activeQueueJobs?: number;
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
  prechecks?: {
    total: number;
    ok: number;
    risk: number;
    critical: number;
    blocked: number;
    recent?: Array<{
      assetId: string;
      user: { id: string; email: string; name: string };
      at: string;
      status: string;
      summary: string;
      blocked: boolean;
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
  if (!value) return "--";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "--";
  return date.toLocaleString("ru-RU");
};

const formatNumber = (value: number | undefined) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return "0";
  return new Intl.NumberFormat("ru-RU").format(value);
};

const metricClass = "rounded-2xl border border-white/10 bg-black/30 p-4";

export default function AdminToolsPage() {
  const [windowHours, setWindowHours] = useState(24);
  const [userFilter, setUserFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState<OverviewResponse | null>(null);

  const loadOverview = useCallback(async (hours: number, user?: string) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      params.set("hours", String(hours));
      if (user && user.trim()) {
        params.set("user", user.trim());
      }

      const res = await fetch(`/api/admin/ai/overview?${params.toString()}`, {
        cache: "no-store",
      });
      const json = (await res.json().catch(() => ({}))) as OverviewResponse;
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      setData(json);
    } catch (fetchError) {
      setData(null);
      setError(fetchError instanceof Error ? fetchError.message : "Failed to load admin overview.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOverview(windowHours, userFilter);
  }, [windowHours, userFilter, loadOverview]);

  const statusCounts = useMemo(() => data?.jobs?.statusCounts || {}, [data]);
  const topUsers = data?.tokens?.topUsers || [];
  const failures = data?.failures || [];
  const recentPrechecks = data?.prechecks?.recent || [];

  return (
    <main className="min-h-screen bg-[#06090f] text-white">
      <div className="mx-auto max-w-7xl px-6 py-10">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="mb-2 text-xs uppercase tracking-[0.35em] text-cyan-300/70">Ops Console</p>
            <h1 className="text-3xl font-semibold">AI Admin Dashboard</h1>
            <p className="mt-2 text-sm text-white/60">
              Monitoring jobs, errors, token flow, queue, and print preflight checks.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={windowHours}
              onChange={(event) => setWindowHours(Number(event.target.value) || 24)}
              className="rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-sm"
            >
              <option value={24}>24h</option>
              <option value={72}>3d</option>
              <option value={168}>7d</option>
            </select>
            <button
              type="button"
              onClick={() => loadOverview(windowHours, userFilter)}
              className="inline-flex items-center gap-2 rounded-xl border border-cyan-400/40 bg-cyan-500/10 px-4 py-2 text-sm"
            >
              <RefreshCcw className="h-4 w-4" />
              Refresh
            </button>
            <Link
              href="/ai-lab"
              className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-black/30 px-4 py-2 text-sm"
            >
              <Wrench className="h-4 w-4" />
              AI Lab
            </Link>
          </div>
        </div>

        <div className="mb-6 flex max-w-md items-center gap-2">
          <input
            value={userFilter}
            onChange={(event) => setUserFilter(event.target.value)}
            placeholder="Filter: user id, email, name"
            className="w-full rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-white/40"
          />
          {userFilter && (
            <button
              type="button"
              onClick={() => setUserFilter("")}
              className="rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-xs"
            >
              Clear
            </button>
          )}
        </div>

        {loading && <div className="rounded-2xl border border-white/10 bg-black/30 p-4">Loading...</div>}

        {!loading && error && (
          <div className="rounded-2xl border border-red-500/35 bg-red-500/10 p-4 text-sm text-red-200">
            {error}
          </div>
        )}

        {!loading && !error && data && (
          <div className="space-y-6">
            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <article className={metricClass}>
                <p className="mb-2 text-xs uppercase tracking-[0.25em] text-white/50">Tokens spend</p>
                <p className="text-3xl font-semibold text-cyan-300">{formatNumber(data.tokens?.spend || 0)}</p>
              </article>
              <article className={metricClass}>
                <p className="mb-2 text-xs uppercase tracking-[0.25em] text-white/50">Tokens topup</p>
                <p className="text-3xl font-semibold text-emerald-300">{formatNumber(data.tokens?.topup || 0)}</p>
              </article>
              <article className={metricClass}>
                <p className="mb-2 text-xs uppercase tracking-[0.25em] text-white/50">Jobs total</p>
                <p className="text-3xl font-semibold text-white">{formatNumber(data.jobs?.total || 0)}</p>
              </article>
              <article className={metricClass}>
                <p className="mb-2 text-xs uppercase tracking-[0.25em] text-white/50">Jobs stale</p>
                <p className="text-3xl font-semibold text-amber-300">{formatNumber(data.jobs?.staleJobs || 0)}</p>
                <p className="mt-1 text-xs text-white/50">older than {data.jobs?.staleMinutes || 30}m</p>
              </article>
              <article className={metricClass}>
                <p className="mb-2 text-xs uppercase tracking-[0.25em] text-white/50">Success rate</p>
                <p className="text-3xl font-semibold text-emerald-300">
                  {typeof data.jobs?.successRate === "number" ? `${data.jobs.successRate}%` : "0%"}
                </p>
              </article>
              <article className={metricClass}>
                <p className="mb-2 text-xs uppercase tracking-[0.25em] text-white/50">Queue depth</p>
                <p className="text-3xl font-semibold text-cyan-300">{formatNumber(data.jobs?.queueDepth || 0)}</p>
                <p className="mt-1 text-xs text-white/50">active: {formatNumber(data.jobs?.activeQueueJobs || 0)}</p>
              </article>
              <article className={metricClass}>
                <p className="mb-2 text-xs uppercase tracking-[0.25em] text-white/50">Precheck risk</p>
                <p className="text-3xl font-semibold text-amber-300">{formatNumber(data.prechecks?.risk || 0)}</p>
              </article>
              <article className={metricClass}>
                <p className="mb-2 text-xs uppercase tracking-[0.25em] text-white/50">Precheck critical</p>
                <p className="text-3xl font-semibold text-rose-300">{formatNumber(data.prechecks?.critical || 0)}</p>
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
                <h2 className="mb-4 text-lg font-semibold">AI job statuses</h2>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  {Object.entries(statusCounts).map(([status, count]) => (
                    <div key={status} className="rounded-xl border border-white/10 bg-black/25 p-3">
                      <p className="uppercase tracking-[0.2em] text-white/60">{status}</p>
                      <p className="mt-1 text-2xl font-semibold">{formatNumber(count)}</p>
                    </div>
                  ))}
                </div>
                <p className="mt-4 text-xs text-white/50">
                  oldest active: {formatNumber(data.jobs?.oldestActiveAgeMinutes || 0)}m
                </p>
              </article>
            </section>

            <section className="grid gap-4 lg:grid-cols-2">
              <article className={metricClass}>
                <h2 className="mb-4 text-lg font-semibold">Top token users</h2>
                <div className="space-y-3 text-sm">
                  {topUsers.length === 0 && <p className="text-white/60">No data for selected window.</p>}
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
                  <h2 className="text-lg font-semibold">Latest generation errors</h2>
                </div>
                <div className="space-y-3 text-sm">
                  {failures.length === 0 && <p className="text-white/60">No errors.</p>}
                  {failures.map((row) => (
                    <div key={row.id} className="rounded-xl border border-white/10 bg-black/25 p-3">
                      <p className="font-medium">{row.user.email || row.user.id}</p>
                      <p className="mt-1 text-xs text-white/50">
                        {row.provider} � {row.mode} � {formatDateTime(row.updatedAt)}
                      </p>
                      {row.error && <p className="mt-2 text-red-200">{row.error}</p>}
                      {row.prompt && <p className="mt-1 text-white/70">{row.prompt}</p>}
                    </div>
                  ))}
                </div>
              </article>
            </section>

            <section className={metricClass}>
              <h2 className="mb-4 text-lg font-semibold">Recent print preflight checks</h2>
              <div className="space-y-3 text-sm">
                {recentPrechecks.length === 0 && <p className="text-white/60">No preflight checks yet.</p>}
                {recentPrechecks.map((row, index) => (
                  <div key={`${row.assetId}-${row.at}-${index}`} className="rounded-xl border border-white/10 bg-black/25 p-3">
                    <p className="font-medium">{row.user.email || row.user.id}</p>
                    <p className="mt-1 text-xs text-white/50">
                      asset: {row.assetId} � {row.status} � {formatDateTime(row.at)}
                    </p>
                    {row.summary && <p className="mt-2 text-white/75">{row.summary}</p>}
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
