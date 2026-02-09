export type PrintTech = "sla" | "fdm";
export type PrintQuality = "pro" | "standard";

export type PrintDimensions = {
  x: number;
  y: number;
  z: number;
};

export type PrintPricingCoefficients = {
  baseFee: number;
  minPrice: number;
  maxSmartPrice: number;
  materialRateToughResin: number;
  materialRateStandardResin: number;
  materialRateStandardPLA: number;
  materialRateABSPro: number;
  machineRateSla: number;
  machineRateFdm: number;
  qualityMultiplierPro: number;
  slaHollowFactor: number;
};

export const DEFAULT_PRINT_PRICING_COEFFICIENTS: PrintPricingCoefficients = {
  baseFee: 300,
  minPrice: 450,
  maxSmartPrice: 250_000,
  materialRateToughResin: 3.8,
  materialRateStandardResin: 2.9,
  materialRateStandardPLA: 1.2,
  materialRateABSPro: 1.6,
  machineRateSla: 55,
  machineRateFdm: 45,
  qualityMultiplierPro: 1.35,
  slaHollowFactor: 0.28,
};

export type ComputePrintPriceInput = {
  technology?: string;
  material?: string;
  quality?: string;
  dimensions?: PrintDimensions;
  volumeCm3?: number;
  isHollow?: boolean;
  infillPercent?: number;
  enableSmart?: boolean;
  queueMultiplier?: number;
};

export type ComputePrintPriceResult = {
  price: number;
  legacyPrice: number;
  smartPrice: number | null;
  model: "smart" | "legacy";
  confidence: "high" | "medium" | "low";
  queueMultiplier: number;
};

const LEGACY_TECH_SURCHARGE: Record<PrintTech, number> = {
  sla: 120,
  fdm: 0,
};

const LEGACY_MATERIAL_SURCHARGE: Record<string, number> = {
  "Tough Resin": 50,
  "Standard Resin": 0,
  "Standard PLA": 0,
  "ABS Pro": 60,
};

const LEGACY_QUALITY_SURCHARGE: Record<PrintQuality, number> = {
  pro: 100,
  standard: 0,
};

const DEFAULT_MATERIAL_BY_TECH: Record<PrintTech, string> = {
  sla: "Standard Resin",
  fdm: "Standard PLA",
};

const MAX_EFFECTIVE_VOLUME_CM3 = 12_000;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const asPositive = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;

const asNonNegative = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;

const normalizePrintTech = (value?: string): PrintTech => {
  if (!value) return "sla";
  return value.toLowerCase().includes("fdm") ? "fdm" : "sla";
};

const normalizePrintQuality = (value?: string): PrintQuality => {
  if (!value) return "standard";
  const raw = value.toLowerCase();
  if (raw.includes("0.05") || raw.includes("pro")) return "pro";
  return "standard";
};

const normalizePrintMaterial = (value: string | undefined, tech: PrintTech) => {
  const safe = value?.trim();
  if (!safe) {
    return DEFAULT_MATERIAL_BY_TECH[tech];
  }
  if (tech === "sla") {
    if (safe === "Tough Resin" || safe === "Standard Resin") return safe;
    return "Standard Resin";
  }
  if (safe === "Standard PLA" || safe === "ABS Pro") return safe;
  return "Standard PLA";
};

const normalizeDimensions = (value?: PrintDimensions) => {
  if (!value) return null;
  const x = asPositive(value.x);
  const y = asPositive(value.y);
  const z = asPositive(value.z);
  if (!x || !y || !z) return null;
  return { x, y, z };
};

const resolveQueueMultiplier = (value?: number) => {
  const multiplier = asPositive(value) ?? 1;
  return clamp(multiplier, 1, 2);
};

const resolveCoefficients = (
  overrides?: Partial<PrintPricingCoefficients>
): PrintPricingCoefficients => {
  const base = DEFAULT_PRINT_PRICING_COEFFICIENTS;
  return {
    baseFee: asNonNegative(overrides?.baseFee) ?? base.baseFee,
    minPrice: asNonNegative(overrides?.minPrice) ?? base.minPrice,
    maxSmartPrice: asPositive(overrides?.maxSmartPrice) ?? base.maxSmartPrice,
    materialRateToughResin:
      asPositive(overrides?.materialRateToughResin) ?? base.materialRateToughResin,
    materialRateStandardResin:
      asPositive(overrides?.materialRateStandardResin) ?? base.materialRateStandardResin,
    materialRateStandardPLA:
      asPositive(overrides?.materialRateStandardPLA) ?? base.materialRateStandardPLA,
    materialRateABSPro:
      asPositive(overrides?.materialRateABSPro) ?? base.materialRateABSPro,
    machineRateSla: asPositive(overrides?.machineRateSla) ?? base.machineRateSla,
    machineRateFdm: asPositive(overrides?.machineRateFdm) ?? base.machineRateFdm,
    qualityMultiplierPro:
      asPositive(overrides?.qualityMultiplierPro) ?? base.qualityMultiplierPro,
    slaHollowFactor: clamp(
      asPositive(overrides?.slaHollowFactor) ?? base.slaHollowFactor,
      0.08,
      1
    ),
  };
};

const resolveLegacyPrice = (
  tech: PrintTech,
  material: string,
  quality: PrintQuality,
  coefficients: PrintPricingCoefficients
) => {
  const techFee = LEGACY_TECH_SURCHARGE[tech] ?? 0;
  const materialFee = LEGACY_MATERIAL_SURCHARGE[material] ?? 0;
  const qualityFee = LEGACY_QUALITY_SURCHARGE[quality] ?? 0;
  return Math.max(
    0,
    Math.round(coefficients.baseFee + techFee + materialFee + qualityFee)
  );
};

const resolveMaterialRate = (
  material: string,
  tech: PrintTech,
  coefficients: PrintPricingCoefficients
) => {
  if (material === "Tough Resin") return coefficients.materialRateToughResin;
  if (material === "Standard Resin") return coefficients.materialRateStandardResin;
  if (material === "ABS Pro") return coefficients.materialRateABSPro;
  if (material === "Standard PLA") return coefficients.materialRateStandardPLA;
  return tech === "sla"
    ? coefficients.materialRateStandardResin
    : coefficients.materialRateStandardPLA;
};

const resolveMachineRate = (tech: PrintTech, coefficients: PrintPricingCoefficients) => {
  return tech === "sla" ? coefficients.machineRateSla : coefficients.machineRateFdm;
};

const resolveQualityTimeMultiplier = (
  quality: PrintQuality,
  coefficients: PrintPricingCoefficients
) => {
  if (quality === "pro") {
    return clamp(coefficients.qualityMultiplierPro, 1, 3);
  }
  return 1;
};

const resolveMaterialUsageFactor = (
  tech: PrintTech,
  isHollow: boolean | undefined,
  infillPercent: number | undefined,
  coefficients: PrintPricingCoefficients
) => {
  if (tech === "sla") {
    // For figurines we assume hollow print by default.
    return isHollow === false ? 1 : coefficients.slaHollowFactor;
  }

  const infill = asPositive(infillPercent) ?? 20;
  const clamped = clamp(infill, 8, 100) / 100;
  const shellBase = 0.12;
  // FDM shell + infill simplified into a single material factor.
  return clamp(shellBase + clamped * (1 - shellBase), shellBase, 1);
};

const computeSmartPrice = (
  tech: PrintTech,
  material: string,
  quality: PrintQuality,
  dimensions: PrintDimensions | null,
  volumeCm3: number | null,
  queueMultiplier: number,
  materialUsageFactor: number,
  coefficients: PrintPricingCoefficients
) => {
  const boundsVolumeCm3 = dimensions ? (dimensions.x * dimensions.y * dimensions.z) / 1000 : null;
  const estimatedInfill = tech === "fdm" ? 0.24 : 0.34;
  let effectiveVolumeCm3 = volumeCm3 ?? (boundsVolumeCm3 ? boundsVolumeCm3 * estimatedInfill : null);
  if (boundsVolumeCm3 && effectiveVolumeCm3 && effectiveVolumeCm3 > boundsVolumeCm3 * 1.15) {
    effectiveVolumeCm3 = boundsVolumeCm3 * estimatedInfill;
  }
  if (!effectiveVolumeCm3 || effectiveVolumeCm3 <= 0) {
    return null;
  }
  if (effectiveVolumeCm3 > MAX_EFFECTIVE_VOLUME_CM3) {
    return null;
  }

  const maxDim = dimensions ? Math.max(dimensions.x, dimensions.y, dimensions.z) : null;
  const minDim = dimensions ? Math.max(1, Math.min(dimensions.x, dimensions.y, dimensions.z)) : null;
  const heightMm = dimensions?.z ?? Math.cbrt(effectiveVolumeCm3 * 1000);
  const fillRatio = boundsVolumeCm3
    ? clamp(effectiveVolumeCm3 / Math.max(boundsVolumeCm3, 1), 0.03, 0.95)
    : tech === "fdm"
      ? 0.24
      : 0.34;
  const slenderness = maxDim && minDim ? maxDim / minDim : 2.5;
  const complexity = clamp(
    (1 - fillRatio) * 0.55 +
      Math.max(0, slenderness - 2) * 0.035 +
      (quality === "pro" ? 0.12 : 0.05),
    0.08,
    0.95
  );

  const supportPct = clamp(0.08 + complexity * 0.24, 0.08, tech === "sla" ? 0.42 : 0.36);
  const wastePct = tech === "sla" ? 0.12 : 0.08;
  const materialRate = resolveMaterialRate(material, tech, coefficients);
  const materialVolumeCm3 = Math.max(4, effectiveVolumeCm3 * materialUsageFactor);
  const materialCost = materialVolumeCm3 * (1 + supportPct + wastePct) * materialRate;

  const qualityTimeMultiplier = resolveQualityTimeMultiplier(quality, coefficients);
  const effectiveVolumeForTime =
    tech === "sla"
      ? Math.min(effectiveVolumeCm3, 450)
      : Math.min(effectiveVolumeCm3, 700);
  const baseHours =
    tech === "sla"
      ? 0.45 + heightMm / 70 + effectiveVolumeForTime / 500
      : 0.6 + effectiveVolumeForTime / 28 + heightMm / 90;
  const totalHours = baseHours * qualityTimeMultiplier * (1 + complexity * 0.35);
  const machineCost = totalHours * resolveMachineRate(tech, coefficients);

  const postProcessCost = (tech === "sla" ? 90 : 45) + (quality === "pro" ? 25 : 0);
  const riskPct = clamp(
    0.04 + complexity * 0.08 + (tech === "sla" ? 0.02 : 0.012),
    0.04,
    0.16
  );

  const subtotal = coefficients.baseFee + materialCost + machineCost + postProcessCost;
  const smartRaw = subtotal * (1 + riskPct) * queueMultiplier;
  const smartPrice = Math.max(coefficients.minPrice, Math.round(smartRaw));
  if (!Number.isFinite(smartPrice) || smartPrice > coefficients.maxSmartPrice) {
    return null;
  }

  const confidence: "high" | "medium" | "low" = volumeCm3 && dimensions
    ? "high"
    : dimensions
      ? "medium"
      : "low";

  return { smartPrice, confidence };
};

export const computePrintPrice = (
  input: ComputePrintPriceInput,
  coefficientOverrides?: Partial<PrintPricingCoefficients>
): ComputePrintPriceResult => {
  const coefficients = resolveCoefficients(coefficientOverrides);
  const tech = normalizePrintTech(input.technology);
  const quality = normalizePrintQuality(input.quality);
  const material = normalizePrintMaterial(input.material, tech);
  const queueMultiplier = resolveQueueMultiplier(input.queueMultiplier);
  const materialUsageFactor = resolveMaterialUsageFactor(
    tech,
    input.isHollow,
    input.infillPercent,
    coefficients
  );
  const legacyPrice = resolveLegacyPrice(tech, material, quality, coefficients);
  const legacyFinal = legacyPrice;

  const smartEnabled = input.enableSmart !== false;
  if (!smartEnabled) {
    return {
      price: legacyFinal,
      legacyPrice,
      smartPrice: null,
      model: "legacy",
      confidence: "low",
      queueMultiplier,
    };
  }

  const dimensions = normalizeDimensions(input.dimensions);
  const volumeCm3 = asPositive(input.volumeCm3);
  const smart = computeSmartPrice(
    tech,
    material,
    quality,
    dimensions,
    volumeCm3,
    queueMultiplier,
    materialUsageFactor,
    coefficients
  );
  if (!smart) {
    return {
      price: legacyFinal,
      legacyPrice,
      smartPrice: null,
      model: "legacy",
      confidence: "low",
      queueMultiplier,
    };
  }

  return {
    price: smart.smartPrice,
    legacyPrice,
    smartPrice: smart.smartPrice,
    model: "smart",
    confidence: smart.confidence,
    queueMultiplier,
  };
};

