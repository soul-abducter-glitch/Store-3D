import { NextResponse, type NextRequest } from "next/server";
import { getPayload } from "payload";

import payloadConfig from "../../../../../../payload.config";
import { buildAiQueueSnapshot } from "@/lib/aiQueue";
import { runServiceReadinessChecks } from "@/lib/serviceReadiness";
import {
  isAiSubscriptionActive,
  normalizeAiPlanCode,
  resolveAiPlans,
} from "@/lib/aiSubscriptionConfig";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type TokenEventReason = "spend" | "refund" | "topup" | "adjust";

type UserSummary = {
  id: string;
  email: string;
  name: string;
};

type UserAggregate = {
  user: UserSummary;
  spend: number;
  refund: number;
  topup: number;
  adjust: number;
  net: number;
  balanceAfter: number | null;
};

type PrecheckLog = {
  at?: string;
  status?: "ok" | "risk" | "critical";
  summary?: string;
  blocked?: boolean;
};

const getPayloadClient = async () => getPayload({ config: payloadConfig });

const normalizeString = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const adminCurrency = (process.env.PAYMENTS_CURRENCY || "rub").trim().toLowerCase();

const normalizeEmail = (value?: unknown) => normalizeString(value).toLowerCase();

const parseAdminEmails = () =>
  (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((entry) => normalizeEmail(entry))
    .filter(Boolean);

const isAdminUser = (user?: { email?: unknown } | null) => {
  const email = normalizeEmail(user?.email);
  if (!email) return false;
  return parseAdminEmails().includes(email);
};

const parseHours = (value: string | null, fallback: number) => {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(24 * 30, Math.trunc(parsed)));
};

const toNumber = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
};

const normalizeReason = (value: unknown): TokenEventReason => {
  const raw = normalizeString(value).toLowerCase();
  if (raw === "spend" || raw === "refund" || raw === "topup" || raw === "adjust") return raw;
  return "adjust";
};

const normalizeUser = (value: unknown): UserSummary => {
  if (!value || typeof value !== "object") {
    return { id: "unknown", email: "", name: "" };
  }
  const doc = value as { id?: unknown; email?: unknown; name?: unknown };
  return {
    id: normalizeString(doc.id || "unknown"),
    email: normalizeString(doc.email).toLowerCase(),
    name: normalizeString(doc.name),
  };
};

const parseDateMs = (value: unknown) => {
  const raw = normalizeString(value);
  if (!raw) return 0;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : 0;
};

const matchesUserFilter = (user: UserSummary, filter: string) => {
  if (!filter) return true;
  const needle = filter.trim().toLowerCase();
  if (!needle) return true;
  return (
    user.id.toLowerCase().includes(needle) ||
    user.email.toLowerCase().includes(needle) ||
    user.name.toLowerCase().includes(needle)
  );
};

const normalizeRelationshipId = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    const candidate =
      (value as { id?: unknown; value?: unknown; _id?: unknown }).id ??
      (value as { id?: unknown; value?: unknown; _id?: unknown }).value ??
      (value as { id?: unknown; value?: unknown; _id?: unknown })._id ??
      "";
    return normalizeString(candidate);
  }
  return normalizeString(value);
};

const normalizeOrderUser = (order: any): UserSummary => {
  const fromUser = normalizeUser(order?.user);
  if (fromUser.id && fromUser.id !== "unknown") return fromUser;
  const customer = order?.customer && typeof order.customer === "object" ? order.customer : {};
  return {
    id: normalizeRelationshipId(order?.user) || "unknown",
    email: normalizeEmail((customer as { email?: unknown }).email),
    name: normalizeString((customer as { name?: unknown }).name),
  };
};

const aggregateUsers = (events: any[]): UserAggregate[] => {
  const byUser = new Map<string, UserAggregate>();

  for (const event of events) {
    const user = normalizeUser(event?.user);
    const key = user.id || "unknown";
    const reason = normalizeReason(event?.reason);
    const delta = toNumber(event?.delta);
    const balanceAfter = Number.isFinite(toNumber(event?.balanceAfter))
      ? toNumber(event?.balanceAfter)
      : null;

    const current =
      byUser.get(key) ||
      ({
        user,
        spend: 0,
        refund: 0,
        topup: 0,
        adjust: 0,
        net: 0,
        balanceAfter: null,
      } satisfies UserAggregate);

    const amount = Math.abs(Math.trunc(delta));
    if (reason === "spend") current.spend += amount;
    if (reason === "refund") current.refund += amount;
    if (reason === "topup") current.topup += amount;
    if (reason === "adjust") current.adjust += Math.trunc(delta);
    current.net += Math.trunc(delta);
    if (balanceAfter !== null) current.balanceAfter = balanceAfter;

    byUser.set(key, current);
  }

  return Array.from(byUser.values()).sort((a, b) => b.spend - a.spend || b.net - a.net);
};

export async function GET(request: NextRequest) {
  try {
    const payload = await getPayloadClient();
    const authResult = await payload.auth({ headers: request.headers }).catch(() => null);
    if (!authResult?.user) {
      return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
    }
    if (!isAdminUser(authResult.user as any)) {
      return NextResponse.json({ success: false, error: "Forbidden." }, { status: 403 });
    }

    const hours = parseHours(request.nextUrl.searchParams.get("hours"), 24);
    const sinceMs = Date.now() - hours * 60 * 60 * 1000;
    const sinceIso = new Date(sinceMs).toISOString();
    const staleMinutes = parseHours(request.nextUrl.searchParams.get("staleMinutes"), 30);
    const staleMs = staleMinutes * 60 * 1000;
    const userFilter = normalizeString(request.nextUrl.searchParams.get("user")).toLowerCase();

    const readiness = await runServiceReadinessChecks(payload as any);

    const [
      eventsFound,
      jobsFound,
      assetsFound,
      ordersFound,
      subscriptionsFound,
      processedWebhooksFound,
      queueSnapshot,
    ] = await Promise.all([
      payload.find({
        collection: "ai_token_events",
        depth: 1,
        limit: 1000,
        sort: "-createdAt",
        overrideAccess: true,
        where: {
          createdAt: {
            greater_than_equal: sinceIso,
          },
        },
      }),
      payload.find({
        collection: "ai_jobs",
        depth: 1,
        limit: 1000,
        sort: "-createdAt",
        overrideAccess: true,
        where: {
          createdAt: {
            greater_than_equal: sinceIso,
          },
        },
      }),
      payload.find({
        collection: "ai_assets",
        depth: 1,
        limit: 1000,
        sort: "-updatedAt",
        overrideAccess: true,
        where: {
          updatedAt: {
            greater_than_equal: sinceIso,
          },
        },
      }),
      payload.find({
        collection: "orders",
        depth: 1,
        limit: 1000,
        sort: "-createdAt",
        overrideAccess: true,
        where: {
          createdAt: {
            greater_than_equal: sinceIso,
          },
        },
      }),
      payload.find({
        collection: "ai_subscriptions",
        depth: 1,
        limit: 2000,
        sort: "-updatedAt",
        overrideAccess: true,
      }),
      payload.find({
        collection: "processed_webhooks",
        depth: 0,
        limit: 2000,
        sort: "-createdAt",
        overrideAccess: true,
        where: {
          createdAt: {
            greater_than_equal: sinceIso,
          },
        },
      }),
      buildAiQueueSnapshot(payload as any),
    ]);

    const rawEvents = Array.isArray(eventsFound?.docs) ? eventsFound.docs : [];
    const rawJobs = Array.isArray(jobsFound?.docs) ? jobsFound.docs : [];
    const rawAssets = Array.isArray(assetsFound?.docs) ? assetsFound.docs : [];
    const rawOrders = Array.isArray(ordersFound?.docs) ? ordersFound.docs : [];
    const rawSubscriptions = Array.isArray(subscriptionsFound?.docs) ? subscriptionsFound.docs : [];
    const rawProcessedWebhooks = Array.isArray(processedWebhooksFound?.docs)
      ? processedWebhooksFound.docs
      : [];

    const events = rawEvents.filter((event) => matchesUserFilter(normalizeUser(event?.user), userFilter));
    const jobs = rawJobs.filter((job) => matchesUserFilter(normalizeUser(job?.user), userFilter));
    const assets = rawAssets.filter((asset) => matchesUserFilter(normalizeUser(asset?.user), userFilter));
    const orders = rawOrders.filter((order) =>
      matchesUserFilter(normalizeOrderUser(order), userFilter)
    );
    const subscriptions = rawSubscriptions.filter((subscription) =>
      matchesUserFilter(normalizeUser(subscription?.user), userFilter)
    );

    const tokenTotals = {
      spend: 0,
      refund: 0,
      topup: 0,
      topupSubscription: 0,
      topupOneTime: 0,
      adjust: 0,
      net: 0,
      events: events.length,
    };

    for (const event of events) {
      const reason = normalizeReason(event?.reason);
      const delta = Math.trunc(toNumber(event?.delta));
      const source = normalizeString(event?.source).toLowerCase();
      tokenTotals.net += delta;
      if (reason === "spend") tokenTotals.spend += Math.abs(delta);
      if (reason === "refund") tokenTotals.refund += Math.abs(delta);
      if (reason === "topup") {
        const amount = Math.abs(delta);
        tokenTotals.topup += amount;
        if (source === "subscription_cycle") {
          tokenTotals.topupSubscription += amount;
        } else {
          tokenTotals.topupOneTime += amount;
        }
      }
      if (reason === "adjust") tokenTotals.adjust += delta;
    }

    const statusCounts: Record<string, number> = {
      queued: 0,
      processing: 0,
      completed: 0,
      failed: 0,
    };
    let staleJobs = 0;
    let oldestActiveAgeMinutes = 0;

    for (const job of jobs) {
      const status = normalizeString(job?.status).toLowerCase();
      if (status in statusCounts) {
        statusCounts[status] += 1;
      } else {
        statusCounts[status] = (statusCounts[status] || 0) + 1;
      }

      if (status === "queued" || status === "processing") {
        const createdMs = parseDateMs(job?.createdAt);
        if (createdMs > 0) {
          const age = Date.now() - createdMs;
          oldestActiveAgeMinutes = Math.max(oldestActiveAgeMinutes, Math.floor(age / 60000));
          if (age >= staleMs) {
            staleJobs += 1;
          }
        }
      }
    }

    const finished = Math.max(0, (statusCounts.completed || 0) + (statusCounts.failed || 0));
    const successRate = finished > 0 ? Number((((statusCounts.completed || 0) / finished) * 100).toFixed(2)) : 0;

    const topUsers = aggregateUsers(events).slice(0, 10);
    const recentFailures = jobs
      .filter((job) => normalizeString(job?.status).toLowerCase() === "failed")
      .sort((a, b) => parseDateMs(b?.updatedAt) - parseDateMs(a?.updatedAt))
      .slice(0, 20)
      .map((job) => {
        const user = normalizeUser(job?.user);
        return {
          id: normalizeString(job?.id),
          user,
          provider: normalizeString(job?.provider) || "unknown",
          mode: normalizeString(job?.mode) || "image",
          status: normalizeString(job?.status) || "failed",
          prompt: normalizeString(job?.prompt).slice(0, 160),
          error: normalizeString(job?.errorMessage).slice(0, 240),
          updatedAt: normalizeString(job?.updatedAt),
          createdAt: normalizeString(job?.createdAt),
        };
      });

    const recentEvents = events.slice(0, 20).map((event) => {
      const user = normalizeUser(event?.user);
      return {
        id: normalizeString(event?.id),
        user,
        reason: normalizeReason(event?.reason),
        delta: Math.trunc(toNumber(event?.delta)),
        balanceAfter: Math.trunc(toNumber(event?.balanceAfter)),
        source: normalizeString(event?.source) || "system",
        createdAt: normalizeString(event?.createdAt),
      };
    });

    const precheckStats = {
      total: 0,
      ok: 0,
      risk: 0,
      critical: 0,
      blocked: 0,
    };

    const recentPrechecks: Array<{
      assetId: string;
      user: UserSummary;
      at: string;
      status: string;
      summary: string;
      blocked: boolean;
    }> = [];

    for (const asset of assets) {
      const logs = Array.isArray(asset?.precheckLogs) ? (asset.precheckLogs as PrecheckLog[]) : [];
      const user = normalizeUser(asset?.user);
      const assetId = normalizeString(asset?.id);

      for (const log of logs) {
        const at = normalizeString(log?.at);
        const atMs = parseDateMs(at);
        if (atMs <= 0 || atMs < sinceMs) continue;

        const status = normalizeString(log?.status).toLowerCase();
        const blocked = Boolean(log?.blocked) || status === "critical";

        precheckStats.total += 1;
        if (status === "ok") precheckStats.ok += 1;
        if (status === "risk") precheckStats.risk += 1;
        if (status === "critical") precheckStats.critical += 1;
        if (blocked) precheckStats.blocked += 1;

        recentPrechecks.push({
          assetId,
          user,
          at,
          status: status || "unknown",
          summary: normalizeString(log?.summary).slice(0, 200),
          blocked,
        });
      }
    }

    recentPrechecks.sort((a, b) => parseDateMs(b.at) - parseDateMs(a.at));

    const completedGenerations = statusCounts.completed || 0;
    const savedAssets = assets.filter((asset) => Boolean(normalizeRelationshipId(asset?.job))).length;
    const printedAssets = new Set(
      recentPrechecks.map((entry) => normalizeString(entry.assetId)).filter(Boolean)
    ).size;

    let cartOrders = 0;
    let cartItems = 0;
    for (const order of orders) {
      const items = Array.isArray(order?.items) ? order.items : [];
      let orderHasCartStep = false;
      for (const item of items) {
        const format = normalizeString(item?.format).toLowerCase();
        const isPhysical = format === "physical";
        const customerUploadId = normalizeRelationshipId(item?.customerUpload);
        if (!isPhysical || !customerUploadId) continue;
        const quantity = Math.max(1, Math.trunc(toNumber(item?.quantity) || 1));
        cartItems += quantity;
        orderHasCartStep = true;
      }
      if (orderHasCartStep) {
        cartOrders += 1;
      }
    }

    const toRate = (current: number, previous: number) =>
      previous > 0 ? Number(((current / previous) * 100).toFixed(1)) : 0;

    const funnel = {
      generate: completedGenerations,
      save: savedAssets,
      print: printedAssets,
      cart: cartItems,
      cartOrders,
      rates: {
        generateToSave: toRate(savedAssets, completedGenerations),
        saveToPrint: toRate(printedAssets, savedAssets),
        printToCart: toRate(cartItems, printedAssets),
      },
      dropoff: {
        generateToSave: Math.max(0, completedGenerations - savedAssets),
        saveToPrint: Math.max(0, savedAssets - printedAssets),
        printToCart: Math.max(0, printedAssets - cartItems),
      },
    };

    const plans = resolveAiPlans();
    const activeSubscriptions = subscriptions.filter((subscription) =>
      isAiSubscriptionActive(subscription?.status)
    );
    const activeSubscribers = activeSubscriptions.length;
    const mrrMinor = activeSubscriptions.reduce((sum, subscription) => {
      const planCode = normalizeAiPlanCode(subscription?.planCode);
      if (!planCode) return sum;
      const plan = plans[planCode];
      if (!plan) return sum;
      return sum + Math.max(0, Math.trunc(plan.monthlyAmountCents || 0));
    }, 0);
    const canceledInWindow = subscriptions.filter((subscription) => {
      const status = normalizeString(subscription?.status).toLowerCase();
      if (status !== "canceled" && status !== "cancelled") return false;
      return parseDateMs(subscription?.updatedAt) >= sinceMs;
    }).length;
    const churnRate =
      activeSubscribers + canceledInWindow > 0
        ? Number(((canceledInWindow / (activeSubscribers + canceledInWindow)) * 100).toFixed(2))
        : 0;
    const pastDueSubscribers = subscriptions.filter(
      (subscription) => normalizeString(subscription?.status).toLowerCase() === "past_due"
    ).length;

    const failedWebhooks = rawProcessedWebhooks.filter(
      (row) => normalizeString(row?.status).toLowerCase() === "failed"
    );
    const paymentFailedWebhooks = rawProcessedWebhooks.filter(
      (row) => normalizeString(row?.eventType).toLowerCase() === "invoice.payment_failed"
    );
    const recentWebhookFailures = failedWebhooks
      .slice(0, 20)
      .map((row) => ({
        id: normalizeString(row?.id),
        provider: normalizeString(row?.provider) || "stripe",
        eventType: normalizeString(row?.eventType) || "unknown",
        failureReason: normalizeString(row?.failureReason),
        createdAt: normalizeString(row?.createdAt),
        processedAt: normalizeString(row?.processedAt),
      }));

    return NextResponse.json(
      {
        success: true,
        filters: {
          hours,
          user: userFilter || null,
        },
        window: {
          hours,
          since: sinceIso,
        },
        readiness,
        jobs: {
          total: jobs.length,
          statusCounts,
          staleMinutes,
          staleJobs,
          oldestActiveAgeMinutes,
          successRate,
          queueDepth: queueSnapshot.queueDepth,
          activeQueueJobs: queueSnapshot.activeCount,
        },
        tokens: {
          ...tokenTotals,
          topUsers,
          recentEvents,
        },
        prechecks: {
          ...precheckStats,
          recent: recentPrechecks.slice(0, 20),
        },
        subscriptions: {
          activeSubscribers,
          pastDueSubscribers,
          canceledInWindow,
          churnRate,
          mrrMinor,
          mrrCurrency: adminCurrency,
        },
        webhooks: {
          failed: failedWebhooks.length,
          paymentFailed: paymentFailedWebhooks.length,
          recentFailures: recentWebhookFailures,
        },
        funnel,
        failures: recentFailures,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[admin/ai/overview] failed", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to build AI overview.",
      },
      { status: 500 }
    );
  }
}
