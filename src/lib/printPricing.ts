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
  sourcePrice?: number | null;
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

const BASE_FEE = 350;

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
  "Tough Resin": 6.5,
  "Standard Resin": 5.2,
  "Standard PLA": 2.1,
  "ABS Pro": 2.8,
};

const QUALITY_TIME_MULTIPLIER: Record<PrintQuality, number> = {
  pro: 1.55,
  standard: 1,
};

const MACHINE_RATE_PER_HOUR: Record<PrintTech, number> = {
  sla: 95,
  fdm: 70,
};

const DEFAULT_MATERIAL_BY_TECH: Record<PrintTech, string> = {
  sla: "Standard Resin",
  fdm: "Standard PLA",
};

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

const resolveSourceFloorPrice = (value?: number | null) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.round(value);
};

const computeSmartPrice = (
  tech: PrintTech,
  material: string,
  quality: PrintQuality,
  dimensions: PrintDimensions | null,
  volumeCm3: number | null,
  queueMultiplier: number
) => {
  const boundsVolumeCm3 = dimensions ? (dimensions.x * dimensions.y * dimensions.z) / 1000 : null;
  const estimatedInfill = tech === "fdm" ? 0.24 : 0.34;
  const effectiveVolumeCm3 = volumeCm3 ?? (boundsVolumeCm3 ? boundsVolumeCm3 * estimatedInfill : null);
  if (!effectiveVolumeCm3 || effectiveVolumeCm3 <= 0) {
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
  const wastePct = tech === "sla" ? 0.18 : 0.12;
  const materialRate = MATERIAL_RATE_PER_CM3[material] ?? MATERIAL_RATE_PER_CM3[DEFAULT_MATERIAL_BY_TECH[tech]];
  const materialCost = effectiveVolumeCm3 * (1 + supportPct + wastePct) * materialRate;

  const qualityTimeMultiplier = QUALITY_TIME_MULTIPLIER[quality] ?? 1;
  const baseHours =
    tech === "sla"
      ? 0.55 + heightMm / 48 + effectiveVolumeCm3 / 180
      : 0.7 + effectiveVolumeCm3 / 16 + heightMm / 62;
  const totalHours = baseHours * qualityTimeMultiplier * (1 + complexity * 0.35);
  const machineCost = totalHours * (MACHINE_RATE_PER_HOUR[tech] ?? 70);

  const postProcessCost = (tech === "sla" ? 120 : 60) + (quality === "pro" ? 35 : 0);
  const riskPct = clamp(
    0.06 + complexity * 0.1 + (tech === "sla" ? 0.025 : 0.015),
    0.06,
    0.2
  );

  const subtotal = BASE_FEE + materialCost + machineCost + postProcessCost;
  const smartRaw = subtotal * (1 + riskPct) * queueMultiplier;
  const smartPrice = Math.max(0, Math.round(smartRaw));

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
  const sourceFloorPrice = resolveSourceFloorPrice(input.sourcePrice);
  const legacyPrice = resolveLegacyPrice(tech, material, quality);
  const legacyFinal = Math.max(sourceFloorPrice, legacyPrice);

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
  const smart = computeSmartPrice(tech, material, quality, dimensions, volumeCm3, queueMultiplier);
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

  const smartFinal = Math.max(sourceFloorPrice, smart.smartPrice);
  return {
    price: smartFinal,
    legacyPrice,
    smartPrice: smart.smartPrice,
    model: "smart",
    confidence: smart.confidence,
    queueMultiplier,
  };
};

