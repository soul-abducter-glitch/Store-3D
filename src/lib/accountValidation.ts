export const ACCOUNT_NAME_MIN = 2;
export const ACCOUNT_NAME_MAX = 40;
export const DEFAULT_SHIPPING_ADDRESS_MAX = 300;
export const ACCOUNT_PASSWORD_MIN = 8;
export const ACCOUNT_PASSWORD_MAX = 128;

const ACCOUNT_NAME_ALLOWED_REGEX = /^[\p{L}\p{N}\s_-]+$/u;
const ACCOUNT_PASSWORD_LETTER_REGEX = /[\p{L}]/u;
const ACCOUNT_PASSWORD_DIGIT_REGEX = /\d/u;

export const normalizeTrimmedText = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

export const validateAccountName = (value: unknown): string | null => {
  const name = normalizeTrimmedText(value);
  if (name.length < ACCOUNT_NAME_MIN) {
    return "\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u0438\u043c\u044f (\u043c\u0438\u043d\u0438\u043c\u0443\u043c 2 \u0441\u0438\u043c\u0432\u043e\u043b\u0430)";
  }
  if (name.length > ACCOUNT_NAME_MAX) {
    return "\u0418\u043c\u044f \u0441\u043b\u0438\u0448\u043a\u043e\u043c \u0434\u043b\u0438\u043d\u043d\u043e\u0435 (\u043c\u0430\u043a\u0441\u0438\u043c\u0443\u043c 40 \u0441\u0438\u043c\u0432\u043e\u043b\u043e\u0432)";
  }
  if (!ACCOUNT_NAME_ALLOWED_REGEX.test(name)) {
    return "\u0414\u043e\u043f\u0443\u0441\u0442\u0438\u043c\u044b \u0431\u0443\u043a\u0432\u044b, \u0446\u0438\u0444\u0440\u044b, \u043f\u0440\u043e\u0431\u0435\u043b, \u0434\u0435\u0444\u0438\u0441 \u0438 \u043f\u043e\u0434\u0447\u0435\u0440\u043a\u0438\u0432\u0430\u043d\u0438\u0435";
  }
  return null;
};

export const validateDefaultShippingAddress = (value: unknown): string | null => {
  const address = normalizeTrimmedText(value);
  if (address.length > DEFAULT_SHIPPING_ADDRESS_MAX) {
    return "\u0410\u0434\u0440\u0435\u0441 \u0441\u043b\u0438\u0448\u043a\u043e\u043c \u0434\u043b\u0438\u043d\u043d\u044b\u0439 (\u043c\u0430\u043a\u0441\u0438\u043c\u0443\u043c 300 \u0441\u0438\u043c\u0432\u043e\u043b\u043e\u0432)";
  }
  return null;
};

export const hasLetterAndDigit = (value: string) =>
  ACCOUNT_PASSWORD_LETTER_REGEX.test(value) && ACCOUNT_PASSWORD_DIGIT_REGEX.test(value);

export const validateNewAccountPassword = (value: unknown): string | null => {
  if (typeof value !== "string" || !value) {
    return "\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u043d\u043e\u0432\u044b\u0439 \u043f\u0430\u0440\u043e\u043b\u044c";
  }
  if (value.length < ACCOUNT_PASSWORD_MIN) {
    return "\u041d\u043e\u0432\u044b\u0439 \u043f\u0430\u0440\u043e\u043b\u044c \u0434\u043e\u043b\u0436\u0435\u043d \u0441\u043e\u0434\u0435\u0440\u0436\u0430\u0442\u044c \u043c\u0438\u043d\u0438\u043c\u0443\u043c 8 \u0441\u0438\u043c\u0432\u043e\u043b\u043e\u0432";
  }
  if (value.length > ACCOUNT_PASSWORD_MAX) {
    return "\u041d\u043e\u0432\u044b\u0439 \u043f\u0430\u0440\u043e\u043b\u044c \u0441\u043b\u0438\u0448\u043a\u043e\u043c \u0434\u043b\u0438\u043d\u043d\u044b\u0439 (\u043c\u0430\u043a\u0441\u0438\u043c\u0443\u043c 128 \u0441\u0438\u043c\u0432\u043e\u043b\u043e\u0432)";
  }
  if (!hasLetterAndDigit(value)) {
    return "\u0414\u043e\u0431\u0430\u0432\u044c\u0442\u0435 \u0445\u043e\u0442\u044f \u0431\u044b \u043e\u0434\u043d\u0443 \u0431\u0443\u043a\u0432\u0443 \u0438 \u043e\u0434\u043d\u0443 \u0446\u0438\u0444\u0440\u0443";
  }
  return null;
};
