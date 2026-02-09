import {
  DEFAULT_PRINT_PRICING_COEFFICIENTS,
  type PrintPricingCoefficients,
} from "@/lib/printPricing";

export type PrintPricingRuntimeSettings = {
  smartEnabled: boolean;
  queueMultiplier: number;
  coefficients: PrintPricingCoefficients;
};

export const DEFAULT_PRINT_PRICING_RUNTIME_SETTINGS: PrintPricingRuntimeSettings = {
  smartEnabled: true,
  queueMultiplier: 1,
  coefficients: DEFAULT_PRINT_PRICING_COEFFICIENTS,
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const asFinite = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const asPositive = (value: unknown) => {
  const parsed = asFinite(value);
  return parsed !== null && parsed > 0 ? parsed : null;
};

const asNonNegative = (value: unknown) => {
  const parsed = asFinite(value);
  return parsed !== null && parsed >= 0 ? parsed : null;
};

const normalizeCoefficients = (value: any): PrintPricingCoefficients => {
  const raw = value && typeof value === "object" ? value : {};
  const base = DEFAULT_PRINT_PRICING_COEFFICIENTS;

  return {
    baseFee: asNonNegative(raw.baseFee) ?? base.baseFee,
    minPrice: asNonNegative(raw.minPrice) ?? base.minPrice,
    maxSmartPrice: asPositive(raw.maxSmartPrice) ?? base.maxSmartPrice,
    materialRateToughResin:
      asPositive(raw.materialRateToughResin) ?? base.materialRateToughResin,
    materialRateStandardResin:
      asPositive(raw.materialRateStandardResin) ?? base.materialRateStandardResin,
    materialRateStandardPLA:
      asPositive(raw.materialRateStandardPLA) ?? base.materialRateStandardPLA,
    materialRateABSPro: asPositive(raw.materialRateABSPro) ?? base.materialRateABSPro,
    machineRateSla: asPositive(raw.machineRateSla) ?? base.machineRateSla,
    machineRateFdm: asPositive(raw.machineRateFdm) ?? base.machineRateFdm,
    qualityMultiplierPro:
      asPositive(raw.qualityMultiplierPro) ?? base.qualityMultiplierPro,
    slaHollowFactor: clamp(
      asPositive(raw.slaHollowFactor) ?? base.slaHollowFactor,
      0.08,
      1
    ),
  };
};

export const normalizePrintPricingRuntimeSettings = (
  value: any
): PrintPricingRuntimeSettings => {
  const raw = value && typeof value === "object" ? value : {};
  return {
    smartEnabled:
      typeof raw.smartEnabled === "boolean"
        ? raw.smartEnabled
        : DEFAULT_PRINT_PRICING_RUNTIME_SETTINGS.smartEnabled,
    queueMultiplier: clamp(
      asPositive(raw.queueMultiplier) ??
        DEFAULT_PRINT_PRICING_RUNTIME_SETTINGS.queueMultiplier,
      1,
      2
    ),
    coefficients: normalizeCoefficients(raw.coefficients),
  };
};

