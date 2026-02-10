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

const PROMO_RULES: PromoRule[] = [
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

  const rule = PROMO_RULES.find((entry) => normalizeCode(entry.code) === code);
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
