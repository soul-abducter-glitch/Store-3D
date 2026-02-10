export type PrintTech = "sla" | "fdm";
export type PrintQuality = "pro" | "standard";

export type PrintDimensions = {
  x: number;
  y: number;
  z: number;
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

const BASE_FEE = 300;

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

const MATERIAL_RATE_PER_CM3: Record<string, number> = {
  "Tough Resin": 3.8,
  "Standard Resin": 2.9,
  "Standard PLA": 1.2,
  "ABS Pro": 1.6,
};

const QUALITY_TIME_MULTIPLIER: Record<PrintQuality, number> = {
  pro: 1.35,
  standard: 1,
};

const MACHINE_RATE_PER_HOUR: Record<PrintTech, number> = {
  sla: 55,
  fdm: 45,
};

const DEFAULT_MATERIAL_BY_TECH: Record<PrintTech, string> = {
  sla: "Standard Resin",
  fdm: "Standard PLA",
};

const MAX_EFFECTIVE_VOLUME_CM3 = 12_000;
const MAX_SMART_PRICE = 250_000;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const asPositive = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;

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

const resolveLegacyPrice = (tech: PrintTech, material: string, quality: PrintQuality) => {
  const techFee = LEGACY_TECH_SURCHARGE[tech] ?? 0;
  const materialFee = LEGACY_MATERIAL_SURCHARGE[material] ?? 0;
  const qualityFee = LEGACY_QUALITY_SURCHARGE[quality] ?? 0;
  return Math.max(0, Math.round(BASE_FEE + techFee + materialFee + qualityFee));
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

const resolveMaterialUsageFactor = (
  tech: PrintTech,
  isHollow?: boolean,
  infillPercent?: number
) => {
  if (tech === "sla") {
    // For figurines we assume hollow print by default.
    return isHollow === false ? 1 : 0.28;
  }

  const infill = asPositive(infillPercent) ?? 20;
  const clamped = clamp(infill, 8, 100) / 100;
  // FDM shell + infill simplified into a single material factor.
  return clamp(0.12 + clamped * 0.88, 0.12, 1);
};

const computeSmartPrice = (
  tech: PrintTech,
  material: string,
  quality: PrintQuality,
  dimensions: PrintDimensions | null,
  volumeCm3: number | null,
  queueMultiplier: number,
  materialUsageFactor: number
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
  const materialRate = MATERIAL_RATE_PER_CM3[material] ?? MATERIAL_RATE_PER_CM3[DEFAULT_MATERIAL_BY_TECH[tech]];
  const materialVolumeCm3 = Math.max(4, effectiveVolumeCm3 * materialUsageFactor);
  const materialCost = materialVolumeCm3 * (1 + supportPct + wastePct) * materialRate;

  const qualityTimeMultiplier = QUALITY_TIME_MULTIPLIER[quality] ?? 1;
  const effectiveVolumeForTime =
    tech === "sla"
      ? Math.min(effectiveVolumeCm3, 450)
      : Math.min(effectiveVolumeCm3, 700);
  const baseHours =
    tech === "sla"
      ? 0.45 + heightMm / 70 + effectiveVolumeForTime / 500
      : 0.6 + effectiveVolumeForTime / 28 + heightMm / 90;
  const totalHours = baseHours * qualityTimeMultiplier * (1 + complexity * 0.35);
  const machineCost = totalHours * (MACHINE_RATE_PER_HOUR[tech] ?? 70);

  const postProcessCost = (tech === "sla" ? 90 : 45) + (quality === "pro" ? 25 : 0);
  const riskPct = clamp(
    0.04 + complexity * 0.08 + (tech === "sla" ? 0.02 : 0.012),
    0.04,
    0.16
  );

  const subtotal = BASE_FEE + materialCost + machineCost + postProcessCost;
  const smartRaw = subtotal * (1 + riskPct) * queueMultiplier;
  const smartPrice = Math.max(450, Math.round(smartRaw));
  if (!Number.isFinite(smartPrice) || smartPrice > MAX_SMART_PRICE) {
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
  input: ComputePrintPriceInput
): ComputePrintPriceResult => {
  const tech = normalizePrintTech(input.technology);
  const quality = normalizePrintQuality(input.quality);
  const material = normalizePrintMaterial(input.material, tech);
  const queueMultiplier = resolveQueueMultiplier(input.queueMultiplier);
  const materialUsageFactor = resolveMaterialUsageFactor(
    tech,
    input.isHollow,
    input.infillPercent
  );
  const legacyPrice = resolveLegacyPrice(tech, material, quality);
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
    materialUsageFactor
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
