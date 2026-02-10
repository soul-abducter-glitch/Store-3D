export type PromoType = "percent" | "fixed";
export type PromoScope = "all" | "digital" | "physical";

export type PromoRule = {
  code: string;
  type: PromoType;
  value: number;
  scope: PromoScope;
  minSubtotal?: number;
  active?: boolean;
  startsAt?: string;
  endsAt?: string;
  maxDiscount?: number;
  description?: string;
};

export type PromoValidationInput = {
  code: string;
  subtotal: number;
  hasDigital: boolean;
  hasPhysical: boolean;
  now?: Date;
};

export type PromoValidationResult = {
  valid: boolean;
  code?: string;
  discountAmount: number;
  finalSubtotal: number;
  message?: string;
  description?: string;
};

type DiscountableItem = {
  quantity?: number;
  unitPrice?: number;
};

const DEFAULT_PROMO_RULES: PromoRule[] = [
  {
    code: "WELCOME10",
    type: "percent",
    value: 10,
    scope: "all",
    minSubtotal: 1000,
    active: true,
    description: "Скидка 10% на заказ от 1000 ₽",
  },
];

const normalizeCode = (value: string) => value.trim().toUpperCase();
const roundMoney = (value: number) => Math.round(value * 100) / 100;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const toPositiveNumber = (value: unknown): number | null => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
};

const toOptionalNonNegative = (value: unknown): number | undefined => {
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return parsed;
};

const toBoolean = (value: unknown, fallback = true): boolean => {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
};

const normalizeScope = (value: unknown): PromoScope => {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (normalized === "digital") return "digital";
  if (normalized === "physical") return "physical";
  return "all";
};

const normalizeType = (value: unknown): PromoType | null => {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (normalized === "percent") return "percent";
  if (normalized === "fixed") return "fixed";
  return null;
};

const normalizeDateString = (value: unknown): string | undefined => {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const trimmed = value.trim();
  const timestamp = Date.parse(trimmed);
  if (!Number.isFinite(timestamp)) return undefined;
  return trimmed;
};

const toPromoRule = (raw: any): PromoRule | null => {
  if (!raw || typeof raw !== "object") return null;
  const code = normalizeCode(String(raw.code || ""));
  const type = normalizeType(raw.type);
  const value = toPositiveNumber(raw.value);
  if (!code || !type || value === null) return null;

  return {
    code,
    type,
    value,
    scope: normalizeScope(raw.scope),
    minSubtotal: toOptionalNonNegative(raw.minSubtotal),
    active: toBoolean(raw.active, true),
    startsAt: normalizeDateString(raw.startsAt),
    endsAt: normalizeDateString(raw.endsAt),
    maxDiscount: toOptionalNonNegative(raw.maxDiscount),
    description:
      typeof raw.description === "string" && raw.description.trim()
        ? raw.description.trim()
        : undefined,
  };
};

const parsePromoRulesFromJsonEnv = (): PromoRule[] => {
  const raw = process.env.PROMO_RULES_JSON;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => toPromoRule(entry))
      .filter((entry): entry is PromoRule => Boolean(entry));
  } catch {
    return [];
  }
};

const parseSinglePromoFromEnv = (): PromoRule | null => {
  const code = normalizeCode(String(process.env.PROMO_CODE || ""));
  if (!code) return null;
  const type = normalizeType(process.env.PROMO_TYPE || "percent");
  const value = toPositiveNumber(process.env.PROMO_VALUE || "");
  if (!type || value === null) return null;

  return {
    code,
    type,
    value,
    scope: normalizeScope(process.env.PROMO_SCOPE || "all"),
    minSubtotal: toOptionalNonNegative(process.env.PROMO_MIN_SUBTOTAL),
    active: toBoolean(process.env.PROMO_ACTIVE, true),
    startsAt: normalizeDateString(process.env.PROMO_STARTS_AT),
    endsAt: normalizeDateString(process.env.PROMO_ENDS_AT),
    maxDiscount: toOptionalNonNegative(process.env.PROMO_MAX_DISCOUNT),
    description:
      typeof process.env.PROMO_DESCRIPTION === "string" && process.env.PROMO_DESCRIPTION.trim()
        ? process.env.PROMO_DESCRIPTION.trim()
        : undefined,
  };
};

const getPromoRules = (): PromoRule[] => {
  const jsonRules = parsePromoRulesFromJsonEnv();
  if (jsonRules.length > 0) return jsonRules;
  const singleRule = parseSinglePromoFromEnv();
  if (singleRule) return [singleRule];
  return DEFAULT_PROMO_RULES;
};

const isRuleActiveByDate = (rule: PromoRule, now: Date) => {
  const startsAt = rule.startsAt ? new Date(rule.startsAt).getTime() : null;
  const endsAt = rule.endsAt ? new Date(rule.endsAt).getTime() : null;
  const nowMs = now.getTime();

  if (startsAt && Number.isFinite(startsAt) && nowMs < startsAt) {
    return false;
  }
  if (endsAt && Number.isFinite(endsAt) && nowMs > endsAt) {
    return false;
  }
  return true;
};

const isScopeEligible = (
  scope: PromoScope,
  flags: { hasDigital: boolean; hasPhysical: boolean }
) => {
  if (scope === "all") return true;
  if (scope === "digital") return flags.hasDigital;
  if (scope === "physical") return flags.hasPhysical;
  return false;
};

export const validatePromoCode = (input: PromoValidationInput): PromoValidationResult => {
  const code = normalizeCode(input.code || "");
  const subtotal = roundMoney(Math.max(0, Number(input.subtotal) || 0));
  const now = input.now ?? new Date();

  if (!code) {
    return {
      valid: false,
      discountAmount: 0,
      finalSubtotal: subtotal,
      message: "Введите промокод.",
    };
  }

  const rule = getPromoRules().find((entry) => normalizeCode(entry.code) === code);
  if (!rule || rule.active === false) {
    return {
      valid: false,
      discountAmount: 0,
      finalSubtotal: subtotal,
      message: "Промокод не найден или неактивен.",
    };
  }

  if (!isRuleActiveByDate(rule, now)) {
    return {
      valid: false,
      discountAmount: 0,
      finalSubtotal: subtotal,
      message: "Срок действия промокода истек.",
    };
  }

  if (!isScopeEligible(rule.scope, { hasDigital: input.hasDigital, hasPhysical: input.hasPhysical })) {
    return {
      valid: false,
      discountAmount: 0,
      finalSubtotal: subtotal,
      message: "Промокод не подходит для выбранных товаров.",
    };
  }

  if (rule.minSubtotal && subtotal < rule.minSubtotal) {
    return {
      valid: false,
      discountAmount: 0,
      finalSubtotal: subtotal,
      message: `Минимальная сумма заказа для этого промокода: ${Math.round(rule.minSubtotal)} ₽.`,
    };
  }

  if (subtotal <= 0) {
    return {
      valid: false,
      discountAmount: 0,
      finalSubtotal: 0,
      message: "Корзина пуста.",
    };
  }

  const rawDiscount =
    rule.type === "percent" ? (subtotal * rule.value) / 100 : Math.max(0, rule.value);
  const cappedByRule =
    typeof rule.maxDiscount === "number" && rule.maxDiscount > 0
      ? Math.min(rawDiscount, rule.maxDiscount)
      : rawDiscount;
  const discountAmount = roundMoney(clamp(cappedByRule, 0, subtotal));
  const finalSubtotal = roundMoney(Math.max(0, subtotal - discountAmount));

  if (discountAmount <= 0) {
    return {
      valid: false,
      discountAmount: 0,
      finalSubtotal: subtotal,
      message: "Промокод не дает скидку для текущего заказа.",
    };
  }

  return {
    valid: true,
    code,
    discountAmount,
    finalSubtotal,
    description: rule.description,
  };
};

export const applyPromoDiscountToItems = <T extends DiscountableItem>(
  items: T[],
  discountAmount: number
) => {
  if (!Array.isArray(items) || items.length === 0) {
    return items;
  }

  let remaining = roundMoney(Math.max(0, discountAmount));
  if (remaining <= 0) {
    return items;
  }

  const nextItems = items.map((item) => ({ ...item }));

  for (let index = 0; index < nextItems.length; index += 1) {
    if (remaining <= 0) break;

    const item = nextItems[index];
    const quantity = typeof item.quantity === "number" && item.quantity > 0 ? item.quantity : 1;
    const unitPrice = typeof item.unitPrice === "number" && item.unitPrice >= 0 ? item.unitPrice : 0;
    const lineTotal = roundMoney(unitPrice * quantity);
    if (lineTotal <= 0) continue;

    const lineDiscount = roundMoney(Math.min(lineTotal, remaining));
    const newLineTotal = roundMoney(lineTotal - lineDiscount);
    const newUnitPrice = roundMoney(newLineTotal / quantity);

    item.unitPrice = newUnitPrice;
    remaining = roundMoney(remaining - lineDiscount);
  }

  return nextItems;
};

