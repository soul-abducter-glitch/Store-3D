import { NextResponse } from "next/server";
import { getPayload } from "payload";

import payloadConfig from "../../../../payload.config";
import {
  DEFAULT_PRINT_PRICING_RUNTIME_SETTINGS,
  normalizePrintPricingRuntimeSettings,
} from "@/lib/printPricingSettings";

export const dynamic = "force-dynamic";

const getPayloadClient = async () => getPayload({ config: payloadConfig });

const resolveSmartPricingEnabled = () =>
  (process.env.PRINT_SMART_ENABLED || "true").trim().toLowerCase() !== "false";

const resolveQueueMultiplier = () => {
  const parsed = Number.parseFloat((process.env.PRINT_QUEUE_MULTIPLIER || "1").trim());
  if (!Number.isFinite(parsed) || parsed <= 0) return 1;
  return Math.min(Math.max(parsed, 1), 2);
};

export async function GET() {
  const envFallback = {
    ...DEFAULT_PRINT_PRICING_RUNTIME_SETTINGS,
    smartEnabled: resolveSmartPricingEnabled(),
    queueMultiplier: resolveQueueMultiplier(),
  };
  try {
    const payload = await getPayloadClient();
    const globalDoc = await payload.findGlobal({
      slug: "print-pricing-settings",
      depth: 0,
    });
    const normalized = normalizePrintPricingRuntimeSettings(globalDoc);
    return NextResponse.json(
      { success: true, settings: normalized },
      { status: 200 }
    );
  } catch {
    return NextResponse.json(
      {
        success: true,
        settings: envFallback,
      },
      { status: 200 }
    );
  }
}
