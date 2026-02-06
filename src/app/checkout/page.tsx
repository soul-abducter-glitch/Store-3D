"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, Loader2, ShieldCheck } from "lucide-react";
import { CardElement, Elements, useElements, useStripe } from "@stripe/react-stripe-js";
import type { StripeCardElement, StripeCardElementChangeEvent } from "@stripe/stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import QRCode from "qrcode";
import CheckoutStepper from "@/components/CheckoutStepper";
import DeliveryCard, { deliveryOptions } from "@/components/DeliveryCard";
import StickyOrderSummary from "@/components/StickyOrderSummary";
import {
  KNOWN_CITIES,
  KNOWN_CITY_SET,
  normalizeCityInput,
  normalizeNameInput,
} from "@/lib/cities";
import { getCartStorageKey, readCartStorage, removeCartStorage } from "@/lib/cartStorage";

type CartItem = {
  id: string;
  productId: string;
  name: string;
  formatKey: "digital" | "physical";
  formatLabel: string;
  priceLabel: string;
  priceValue: number;
  quantity: number;
  thumbnailUrl: string;
  customPrint?: CustomPrintMeta | null;
};

type CheckoutStep = "form" | "processing" | "payment";

type CustomPrintMeta = {
  uploadId: string;
  uploadUrl?: string;
  uploadName?: string;
  sourcePrice?: number;
  technology?: string;
  material?: string;
  quality?: string;
  dimensions?: { x: number; y: number; z: number };
  volumeCm3?: number;
};

const formatPrice = (value?: number) => {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "N/A";
  }
  return new Intl.NumberFormat("ru-RU").format(value);
};

const buildCartThumbnail = (label: string) => {
  const shortLabel = label.trim().slice(0, 2).toUpperCase() || "3D";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120" viewBox="0 0 160 120"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop offset="0%" stop-color="#1f2937"/><stop offset="100%" stop-color="#0f172a"/></linearGradient></defs><rect width="160" height="120" rx="24" fill="url(#g)"/><circle cx="120" cy="24" r="28" fill="rgba(46,209,255,0.25)"/><text x="18" y="70" fill="#E2E8F0" font-family="Arial, sans-serif" font-size="28" font-weight="700">${shortLabel}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};

const formatLabelForKey = (formatKey: "digital" | "physical") =>
  formatKey === "physical" ? "Печатная модель" : "Цифровой STL";

const normalizeCustomPrint = (source: any): CustomPrintMeta | null => {
  if (!source || typeof source !== "object") {
    return null;
  }

  const raw = source.customPrint && typeof source.customPrint === "object" ? source.customPrint : source;
  const uploadId =
    typeof raw.uploadId === "string"
      ? raw.uploadId
      : typeof raw.customerUploadId === "string"
        ? raw.customerUploadId
        : null;

  if (!uploadId) {
    return null;
  }

  const dimensions =
    raw.dimensions && typeof raw.dimensions === "object"
      ? {
          x: Number(raw.dimensions.x) || 0,
          y: Number(raw.dimensions.y) || 0,
          z: Number(raw.dimensions.z) || 0,
        }
      : undefined;

  return {
    uploadId,
    uploadUrl: typeof raw.uploadUrl === "string" ? raw.uploadUrl : undefined,
    uploadName: typeof raw.uploadName === "string" ? raw.uploadName : undefined,
    sourcePrice: typeof raw.sourcePrice === "number" ? raw.sourcePrice : undefined,
    technology: typeof raw.technology === "string" ? raw.technology : undefined,
    material: typeof raw.material === "string" ? raw.material : undefined,
    quality: typeof raw.quality === "string" ? raw.quality : undefined,
    dimensions,
    volumeCm3: typeof raw.volumeCm3 === "number" ? raw.volumeCm3 : undefined,
  };
};

const normalizeStoredItem = (item: any): CartItem | null => {
  if (!item || typeof item !== "object") {
    return null;
  }

  const rawProduct =
    typeof item.productId !== "undefined" ? item.productId : typeof item.product !== "undefined" ? item.product : null;

  const resolvedProductId =
    typeof rawProduct === "string"
      ? rawProduct
      : typeof rawProduct === "number"
        ? String(rawProduct)
      : rawProduct && typeof rawProduct === "object"
        ? rawProduct.id || rawProduct.value || rawProduct._id || null
        : null;

  const productId =
    typeof resolvedProductId === "string"
      ? resolvedProductId
      : typeof item.id === "string"
        ? item.id
        : null;

  if (!productId) {
    return null;
  }

  const formatKey = item.formatKey === "physical" ? "physical" : "digital";
  const name = typeof item.name === "string" ? item.name : "Item";
  const priceValue = typeof item.priceValue === "number" ? item.priceValue : 0;
  const quantity =
    typeof item.quantity === "number" && item.quantity > 0 ? item.quantity : 1;
  const formatLabel =
    typeof item.formatLabel === "string" ? item.formatLabel : formatLabelForKey(formatKey);
  const priceLabel =
    typeof item.priceLabel === "string" ? item.priceLabel : formatPrice(priceValue);
  const thumbnailUrl =
    typeof item.thumbnailUrl === "string" ? item.thumbnailUrl : buildCartThumbnail(name);
  const id =
    typeof item.id === "string" && item.productId ? item.id : `${productId}:${formatKey}`;
  const customPrint = normalizeCustomPrint(item);

  return {
    id,
    productId,
    name,
    formatKey,
    formatLabel,
    priceLabel,
    priceValue,
    quantity,
    thumbnailUrl,
    customPrint,
  };
};

const resolveCartProductId = (item: CartItem) => {
  const source = typeof item.productId === "string" && item.productId ? item.productId : item.id;
  const candidate = String(source).split(":")[0].trim();
  if (!candidate || /\s/.test(candidate)) {
    return "";
  }
  return candidate;
};

const shippingMethodOptions = [
  { value: "cdek", label: "СДЭК" },
  { value: "yandex", label: "Яндекс.Доставка" },
  { value: "ozon", label: "OZON Rocket" },
  { value: "pochta", label: "Почта России" },
  { value: "pickup", label: "Самовывоз" },
];
const deliveryCostMap: Record<string, number> = {
  cdek: 200,
  yandex: 150,
  ozon: 100,
  pochta: 250,
  pickup: 0,
};

const resolveDeliveryCost = (method?: string) => {
  if (!method) return 0;
  return deliveryCostMap[method] ?? 0;
};
const paymentOptions = [
  { value: "card", label: "Оплата картой" },
  { value: "sbp", label: "СБП" },
  { value: "cash", label: "Наличными при получении" },
];

const citySuggestions = KNOWN_CITIES;
const streetSuggestionsByCity: Record<string, string[]> = {
  Москва: ["Арбат", "Тверская", "Покровка", "Мясницкая", "Никольская", "Садовое кольцо"],
  "Санкт-Петербург": ["Невский проспект", "Малая Конюшенная", "Литейный", "Гороховая"],
  Новосибирск: ["Красный проспект", "Гоголя", "Ленина", "Советская"],
  Екатеринбург: ["Ленина", "Малышева", "8 Марта", "Вайнера"],
  Казань: ["Баумана", "Пушкина", "Кремлевская", "Петербургская"],
};

const shippingLabels = {
  sectionTitle: "\u0414\u043e\u0441\u0442\u0430\u0432\u043a\u0430",
  method: "\u0421\u043f\u043e\u0441\u043e\u0431 \u0434\u043e\u0441\u0442\u0430\u0432\u043a\u0438",
  city: "\u0413\u043e\u0440\u043e\u0434",
  address: "\u0410\u0434\u0440\u0435\u0441 \u0434\u043e\u0441\u0442\u0430\u0432\u043a\u0438",
  zipHelper: "\u0420\u0435\u043a\u043e\u043c\u0435\u043d\u0434\u0443\u0435\u0442\u0441\u044f",
};

const digitalLabels = {
  title: "\u0426\u0438\u0444\u0440\u043e\u0432\u044b\u0435 \u0444\u0430\u0439\u043b\u044b",
  info: "\u0426\u0438\u0444\u0440\u043e\u0432\u044b\u0435 \u0444\u0430\u0439\u043b\u044b \u0431\u0443\u0434\u0443\u0442 \u0434\u043e\u0441\u0442\u0443\u043f\u043d\u044b \u0432 \u0432\u0430\u0448\u0435\u043c \u041b\u0438\u0447\u043d\u043e\u043c \u041a\u0430\u0431\u0438\u043d\u0435\u0442\u0435 \u0441\u0440\u0430\u0437\u0443 \u043f\u043e\u0441\u043b\u0435 \u043e\u043f\u043b\u0430\u0442\u044b.",
};

const NAME_REGEX = /^[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё\s'-]{1,49}$/;
const CITY_REGEX = /^[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё\s'.-]{1,49}$/;
const ADDRESS_REGEX = /^[A-Za-zА-Яа-яЁё0-9\s.,\\-\\/№]{3,120}$/;

const normalizeAddressInput = (value: string) =>
  value
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

const stripePublicKey = (process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || "").trim();
const stripePromise = stripePublicKey ? loadStripe(stripePublicKey) : null;
const sbpQrPayloadOverride = (process.env.NEXT_PUBLIC_SBP_QR_PAYLOAD || "").trim();
const sbpQrImageOverride = (process.env.NEXT_PUBLIC_SBP_QR_IMAGE_URL || "").trim();
const sbpMerchant = (process.env.NEXT_PUBLIC_SBP_MERCHANT || "3D-STORE").trim();
const STRIPE_TEST_CARDS = [
  { number: "4242 4242 4242 4242", label: "Успешная оплата" },
  { number: "4000 0000 0000 0002", label: "Карта отклонена" },
  { number: "4000 0000 0000 9995", label: "Недостаточно средств" },
];

const applySbpTemplate = (
  template: string,
  params: { order: string; amount: number; merchant: string }
) =>
  template
    .replace(/\{\{order\}\}/g, params.order)
    .replace(/\{\{amount\}\}/g, String(params.amount))
    .replace(/\{\{merchant\}\}/g, params.merchant);

type StripePaymentFormProps = {
  orderId: string;
  clientSecret: string;
  customerName: string;
  customerEmail: string;
  paymentLoading: boolean;
  onSetPaymentLoading: (value: boolean) => void;
  onConfirmPayment: (orderId: string, paymentIntentId: string) => Promise<unknown>;
  onPaid: (orderId: string) => void;
  onClearStageError?: () => void;
};

const StripePaymentForm = ({
  orderId,
  clientSecret,
  customerName,
  customerEmail,
  paymentLoading,
  onSetPaymentLoading,
  onConfirmPayment,
  onPaid,
  onClearStageError,
}: StripePaymentFormProps) => {
  const stripe = useStripe();
  const elements = useElements();
  const [localError, setLocalError] = useState<string | null>(null);
  const [cardReady, setCardReady] = useState(false);
  const [cardComplete, setCardComplete] = useState(false);
  const cardElementRef = useRef<StripeCardElement | null>(null);
  const [cardElementKey, setCardElementKey] = useState(0);
  const testCards = STRIPE_TEST_CARDS;

  const resetCardElement = useCallback(() => {
    cardElementRef.current = null;
    setCardReady(false);
    setCardComplete(false);
    setCardElementKey((prev) => prev + 1);
  }, []);

  const reportElementError = useCallback(
    (message?: string) => {
      const text = message || "Ошибка оплаты.";
      if (text.toLowerCase().includes("element")) {
        resetCardElement();
        setLocalError(
          "Форма карты перезапущена. Введите данные карты заново и повторите оплату."
        );
      } else {
        setLocalError(text);
      }
    },
    [resetCardElement]
  );

  const handleStripePay = async () => {
    if (!stripe || !elements || !cardReady) {
      setLocalError("Stripe еще загружается. Попробуйте снова.");
      return;
    }
    const card = elements.getElement(CardElement);
    if (!card) {
      setLocalError("Форма карты еще загружается. Попробуйте снова.");
      return;
    }
    if (!cardComplete) {
      setLocalError("Заполните данные карты полностью.");
      return;
    }
    onSetPaymentLoading(true);
    onClearStageError?.();
    setLocalError(null);
    try {
      const result = await stripe.confirmCardPayment(clientSecret, {
        payment_method: {
          card,
          billing_details: {
            name: customerName,
            email: customerEmail,
          },
        },
      });

      if (result.error) {
        reportElementError(result.error.message || "Ошибка оплаты.");
        onSetPaymentLoading(false);
        return;
      }

      const intentId = result.paymentIntent?.id;
      if (!intentId) {
        setLocalError("Не удалось получить данные платежа.");
        onSetPaymentLoading(false);
        return;
      }

      await onConfirmPayment(orderId, intentId);
      onPaid(orderId);
    } catch (error) {
      reportElementError(error instanceof Error ? error.message : "Не удалось подтвердить оплату.");
    } finally {
      onSetPaymentLoading(false);
    }
  };

  return (
    <div className="mx-auto mt-6 w-full max-w-[420px] space-y-4 text-left">
      <div className="rounded-2xl border border-white/10 bg-black/40 px-4 py-4">
        <label className="mb-2 block text-xs uppercase tracking-[0.3em] text-white/50">
          Данные карты
        </label>
        <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-3">
          <CardElement
            key={cardElementKey}
            options={{
              hidePostalCode: true,
              style: {
                base: {
                  color: "#E5E7EB",
                  fontSize: "14px",
                  fontFamily: "var(--font-jetbrains-mono), sans-serif",
                  letterSpacing: "0.02em",
                  "::placeholder": {
                    color: "rgba(226,232,240,0.5)",
                  },
                },
                invalid: { color: "#FDA4AF" },
              },
            }}
            onReady={(element) => {
              cardElementRef.current = element;
              setCardReady(true);
            }}
            onChange={(event: StripeCardElementChangeEvent) => {
              setCardComplete(event.complete);
              if (event.error?.message) {
                setLocalError(event.error.message);
              } else if (localError) {
                setLocalError(null);
              }
            }}
          />
        </div>
        <p className="mt-2 text-[10px] uppercase tracking-[0.3em] text-[#2ED1FF]/70">
          Тестовый режим Stripe
        </p>
        <p className="mt-1 text-[11px] text-white/50">
          Любой будущий срок, любой CVC.
        </p>
        <details className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/70">
          <summary className="cursor-pointer text-[11px] uppercase tracking-[0.3em] text-white/60">
            Тестовые карты
          </summary>
          <div className="mt-2 space-y-2">
            {testCards.map((card) => (
              <div key={card.number} className="flex items-center justify-between gap-3">
                <span className="font-mono text-[11px] text-white/80">{card.number}</span>
                <span className="text-[11px] text-white/50">{card.label}</span>
              </div>
            ))}
          </div>
        </details>
        <button
          type="button"
          className="mt-3 w-full rounded-full border border-white/15 bg-white/5 px-4 py-2 text-[10px] uppercase tracking-[0.3em] text-white/70 transition hover:border-white/30 hover:text-white"
          onClick={resetCardElement}
        >
          Перезагрузить форму карты
        </button>
      </div>

      {localError && (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {localError}
        </div>
      )}

      <button
        type="button"
        onClick={handleStripePay}
        disabled={paymentLoading || !stripe || !cardReady}
        className="w-full rounded-full bg-white px-6 py-3 text-xs font-semibold uppercase tracking-[0.3em] text-black shadow-[0_0_18px_rgba(46,209,255,0.35)] transition hover:bg-white/95 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {paymentLoading ? "Оплата..." : !cardReady ? "Загрузка формы..." : "Оплатить"}
      </button>
    </div>
  );
};

type MockCardFormProps = {
  paymentLoading: boolean;
  onPay: () => Promise<void> | void;
  onClearStageError?: () => void;
};

const CARD_BRANDS = [
  { key: "visa", label: "VISA", pattern: /^4/ },
  { key: "mastercard", label: "MASTERCARD", pattern: /^(5[1-5]|2[2-7])/ },
  { key: "mir", label: "МИР", pattern: /^220[0-4]|^220[5-8]|^2209/ },
];

const normalizeDigits = (value: string) => value.replace(/[^\d]/g, "");

const formatCardNumber = (digits: string) => {
  const trimmed = digits.slice(0, 16);
  const groups = trimmed.match(/.{1,4}/g);
  return groups ? groups.join(" ") : "";
};

const formatExpiry = (digits: string) => {
  const trimmed = digits.slice(0, 4);
  if (trimmed.length <= 2) return trimmed;
  return `${trimmed.slice(0, 2)} / ${trimmed.slice(2)}`;
};

const detectCardBrand = (digits: string) =>
  CARD_BRANDS.find((brand) => brand.pattern.test(digits)) ?? { key: "generic", label: "КАРТА" };

const CardBrandIcon = ({
  brandKey,
  className = "h-6 w-12",
}: {
  brandKey: string;
  className?: string;
}) => {
  if (brandKey === "visa") {
    return (
      <svg viewBox="0 0 72 40" className={`${className} rounded-md`} aria-hidden="true">
        <rect width="72" height="40" rx="8" fill="#FFFFFF" />
        <text
          x="36"
          y="24"
          textAnchor="middle"
          fontSize="15"
          fontFamily="Arial Black, Arial, sans-serif"
          fontWeight="700"
          fill="#1434CB"
        >
          VISA
        </text>
        <rect x="10" y="29" width="52" height="4" rx="2" fill="#F5B335" />
      </svg>
    );
  }
  if (brandKey === "mastercard") {
    return (
      <svg viewBox="0 0 72 40" className={`${className} rounded-md`} aria-hidden="true">
        <rect width="72" height="40" rx="8" fill="#FFFFFF" />
        <circle cx="30" cy="18" r="10" fill="#EB001B" />
        <circle cx="42" cy="18" r="10" fill="#F79E1B" />
        <text
          x="36"
          y="33"
          textAnchor="middle"
          fontSize="7"
          fontFamily="Arial, sans-serif"
          fontWeight="600"
          fill="#1F2937"
        >
          mastercard
        </text>
      </svg>
    );
  }
  if (brandKey === "mir") {
    return (
      <svg viewBox="0 0 72 40" className={`${className} rounded-md`} aria-hidden="true">
        <defs>
          <linearGradient id="mirGradient" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stopColor="#12B981" />
            <stop offset="55%" stopColor="#22D3EE" />
            <stop offset="100%" stopColor="#F59E0B" />
          </linearGradient>
        </defs>
        <rect width="72" height="40" rx="8" fill="#FFFFFF" />
        <rect x="6" y="10" width="60" height="20" rx="6" fill="#F8FAFC" stroke="#E2E8F0" />
        <text
          x="36"
          y="25"
          textAnchor="middle"
          fontSize="14"
          fontFamily="Arial Black, Arial, sans-serif"
          fontWeight="700"
          fill="url(#mirGradient)"
        >
          МИР
        </text>
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 72 40" className={`${className} rounded-md`} aria-hidden="true">
      <rect width="72" height="40" rx="8" fill="#FFFFFF" />
      <rect x="6" y="12" width="60" height="16" rx="6" fill="#E2E8F0" />
    </svg>
  );
};

const BankBadge = ({
  label,
  accent,
}: {
  label: string;
  accent: string;
}) => (
  <span className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] uppercase tracking-[0.25em] text-white/70">
    <span className="h-2 w-2 rounded-full" style={{ background: accent }} />
    {label}
  </span>
);

const validateExpiry = (digits: string) => {
  if (digits.length < 4) return "Введите срок действия.";
  const month = Number(digits.slice(0, 2));
  const year = Number(digits.slice(2, 4));
  if (!Number.isFinite(month) || month < 1 || month > 12) {
    return "Введите корректный месяц.";
  }
  const now = new Date();
  const currentYear = now.getFullYear() % 100;
  const currentMonth = now.getMonth() + 1;
  if (year < currentYear || (year === currentYear && month < currentMonth)) {
    return "Срок действия карты истёк.";
  }
  if (year > currentYear + 20) {
    return "Слишком далёкий срок действия.";
  }
  return null;
};

const MockCardForm = ({ paymentLoading, onPay, onClearStageError }: MockCardFormProps) => {
  const [cardNumberDigits, setCardNumberDigits] = useState("");
  const [expDigits, setExpDigits] = useState("");
  const [cvcDigits, setCvcDigits] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const cardNumberRef = useRef<HTMLInputElement>(null);
  const expiryRef = useRef<HTMLInputElement>(null);
  const cvcRef = useRef<HTMLInputElement>(null);

  const brandInfo = detectCardBrand(cardNumberDigits);
  const expiryError = validateExpiry(expDigits);
  const cardNumberValid = cardNumberDigits.length === 16;
  const cvcValid = cvcDigits.length >= 3;
  const cardNumberError = cardNumberDigits.length > 0 && !cardNumberValid;
  const expiryFieldError = expDigits.length === 4 && Boolean(expiryError);
  const cvcError = cvcDigits.length > 0 && !cvcValid;

  const handlePay = async () => {
    onClearStageError?.();
    if (!cardNumberValid) {
      setLocalError("Введите 16 цифр номера карты.");
      cardNumberRef.current?.focus();
      return;
    }
    if (expiryError) {
      setLocalError(expiryError);
      expiryRef.current?.focus();
      return;
    }
    if (!cvcValid) {
      setLocalError("Введите корректный CVC.");
      cvcRef.current?.focus();
      return;
    }
    setLocalError(null);
    await onPay();
  };

  return (
    <div className="mx-auto mt-6 w-full max-w-[420px] space-y-4 text-left">
      <div className="rounded-2xl border border-white/10 bg-black/40 px-4 py-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <label className="text-xs uppercase tracking-[0.3em] text-white/50">
            Данные карты
          </label>
          <div className="flex flex-wrap items-center gap-2">
            {CARD_BRANDS.map((brand) => {
              const isActive = brandInfo.key === brand.key;
              return (
                <span
                  key={brand.key}
                  className={`flex items-center justify-center rounded-[10px] border px-2 py-1.5 shadow-[0_0_10px_rgba(46,209,255,0.1)] transition ${
                    isActive
                      ? "border-[#2ED1FF]/70 bg-[#0b1014]"
                      : "border-white/10 bg-white/5 opacity-70"
                  }`}
                >
                  <CardBrandIcon brandKey={brand.key} className="h-6 w-12" />
                </span>
              );
            })}
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] uppercase tracking-[0.25em] text-white/70">
              КАРТА
            </span>
          </div>
        </div>
        <div className="space-y-3">
          <div className="relative">
            <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2">
              <CardBrandIcon brandKey={brandInfo.key} />
            </div>
            <input
              ref={cardNumberRef}
              type="text"
              value={formatCardNumber(cardNumberDigits)}
              onChange={(event) => {
                setLocalError(null);
                setCardNumberDigits(normalizeDigits(event.target.value).slice(0, 16));
              }}
              placeholder="Номер карты"
              inputMode="numeric"
              className={`w-full rounded-xl border bg-white/5 px-4 py-3 pl-16 text-sm text-white outline-none transition focus:border-[#2ED1FF]/60 ${
                cardNumberError || (localError && !cardNumberValid)
                  ? "border-rose-400/60 ring-1 ring-rose-400/40"
                  : "border-white/10"
              }`}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <input
              ref={expiryRef}
              type="text"
              value={formatExpiry(expDigits)}
              onChange={(event) => {
                setLocalError(null);
                setExpDigits(normalizeDigits(event.target.value).slice(0, 4));
              }}
              placeholder="MM / YY"
              inputMode="numeric"
              className={`rounded-xl border bg-white/5 px-4 py-3 text-sm text-white outline-none transition focus:border-[#2ED1FF]/60 ${
                expiryFieldError || (localError && Boolean(expiryError))
                  ? "border-rose-400/60 ring-1 ring-rose-400/40"
                  : "border-white/10"
              }`}
            />
            <input
              ref={cvcRef}
              type="text"
              value={cvcDigits}
              onChange={(event) => {
                setLocalError(null);
                setCvcDigits(normalizeDigits(event.target.value).slice(0, 3));
              }}
              placeholder="CVC"
              inputMode="numeric"
              className={`rounded-xl border bg-white/5 px-4 py-3 text-sm text-white outline-none transition focus:border-[#2ED1FF]/60 ${
                cvcError || (localError && !cvcValid)
                  ? "border-rose-400/60 ring-1 ring-rose-400/40"
                  : "border-white/10"
              }`}
            />
          </div>
          {expDigits.length === 4 && expiryError && (
            <p className="text-xs text-red-300">{expiryError}</p>
          )}
        </div>
        <p className="mt-2 text-[10px] uppercase tracking-[0.3em] text-[#2ED1FF]/70">
          Тестовый режим оплаты
        </p>
        <p className="mt-1 text-[11px] text-white/50">Можно вводить любые цифры.</p>
      </div>

      {localError && (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {localError}
        </div>
      )}

      <button
        type="button"
        onClick={handlePay}
        disabled={paymentLoading}
        className="w-full rounded-full bg-white px-6 py-3 text-xs font-semibold uppercase tracking-[0.3em] text-black shadow-[0_0_18px_rgba(46,209,255,0.35)] transition hover:bg-white/95 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {paymentLoading ? "Оплата..." : "Оплатить"}
      </button>
    </div>
  );
};

const CheckoutPage = () => {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement | null>(null);
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [cartReady, setCartReady] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [userReady, setUserReady] = useState(false);
  const [step, setStep] = useState<CheckoutStep>("form");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState("card");
  const [pendingOrderId, setPendingOrderId] = useState<string | null>(null);
  const [pendingOrderPayload, setPendingOrderPayload] = useState<Record<string, any> | null>(null);
  const [paymentIntentId, setPaymentIntentId] = useState<string | null>(null);
  const [paymentClientSecret, setPaymentClientSecret] = useState<string | null>(null);
  const [paymentStageError, setPaymentStageError] = useState<string | null>(null);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [sbpQrSvg, setSbpQrSvg] = useState<string | null>(null);
  const [sbpQrError, setSbpQrError] = useState<string | null>(null);
  const [submitLock, setSubmitLock] = useState(false);
  const paymentsMode = (process.env.NEXT_PUBLIC_PAYMENTS_MODE || "mock").toLowerCase();
  const isPaymentsMock = paymentsMode === "mock";
  const isStripeMode = paymentsMode === "stripe";
  const [form, setForm] = useState({
    name: "",
    email: "",
    city: "",
    address: "",
    shippingMethod: shippingMethodOptions[0].value,
    zipCode: "",
  });
  const [fieldErrors, setFieldErrors] = useState<{
    name?: string;
    email?: string;
    city?: string;
    address?: string;
    zipCode?: string;
    shippingMethod?: string;
  }>({});
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const cityRef = useRef<HTMLInputElement>(null);
  const addressRef = useRef<HTMLTextAreaElement>(null);
  const apiBase = "";
  const cartStorageKey = useMemo(
    () => getCartStorageKey(userReady ? userId : null),
    [userId, userReady]
  );
  
  // Always use the Next.js API route, not direct backend URL
  const ordersApiUrl = "/api/create-order";
  const paymentsIntentUrl = "/api/payments/create-intent";
  const paymentsConfirmUrl = "/api/payments/confirm";
  const isProcessing = step === "processing";

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (!userReady) {
      return;
    }
    const parsed = readCartStorage(cartStorageKey, { migrateLegacy: true });
    const normalized = parsed
      .map((item) => normalizeStoredItem(item))
      .filter((item): item is CartItem => Boolean(item));
    setCartItems(normalized);
    setCartReady(true);
  }, [cartStorageKey, userReady]);

  useEffect(() => {
    if (!cartReady) {
      return;
    }
    if (cartItems.length === 0 && step === "form") {
      router.replace("/");
    }
  }, [cartItems, router, step]);

  useEffect(() => {
    fetch(`${apiBase}/api/users/me`, {
      credentials: "include",
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const id = data?.user?.id ?? data?.doc?.id ?? null;
        setUserId(id ? String(id) : null);
      })
      .catch(() => {
        setUserId(null);
      })
      .finally(() => {
        setUserReady(true);
      });
  }, [apiBase]);

  useEffect(() => {
    if (userId) {
      fetch(`${apiBase}/api/users/me`, {
        credentials: "include",
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          const user = data?.user ?? data?.doc ?? null;
          if (user) {
            setForm((prev) => ({
              ...prev,
              name: user.name || prev.name,
              email: user.email || prev.email,
              address: user.shippingAddress || prev.address,
            }));
          }
        })
        .catch(() => {});
    }
  }, [apiBase, userId]);

  const streetSuggestions = useMemo(() => {
    const list = streetSuggestionsByCity[form.city] ?? [];
    const raw = form.address.trim();
    if (raw.length < 2) return [];
    const parts = raw.split(",").map((item) => item.trim()).filter(Boolean);
    const query = (parts[parts.length - 1] ?? raw).toLowerCase();
    if (query.length < 2) return [];
    return list
      .filter((street) => street.toLowerCase().includes(query))
      .slice(0, 6);
  }, [form.city, form.address]);

  const applyStreetSuggestion = (street: string) => {
    setForm((prev) => {
      const parts = prev.address
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      if (parts.length === 0) {
        return { ...prev, address: street };
      }
      parts[parts.length - 1] = street;
      return { ...prev, address: parts.join(", ") };
    });
  };

  const validateProducts = async (items: CartItem[]) => {
    if (items.length === 0) return { valid: true, invalidProducts: [] };

    try {
      const response = await fetch(`${apiBase}/api/products?depth=0&limit=1000`, {
        credentials: "include",
      });

      if (response.ok) {
        const data = await response.json();
        const products = data?.docs || [];
        const validIds = new Set(
          products
            .map((doc: any): string | null => (doc?.id ? String(doc.id) : null))
            .filter((id: string | null): id is string => Boolean(id))
        );
        
        const invalidProducts = items.filter(
          (item) => !validIds.has(resolveCartProductId(item))
        );
        return { valid: invalidProducts.length === 0, invalidProducts };
      }
    } catch (error) {
    }

    return { valid: false, invalidProducts: items };
  };

  const hasPhysical = useMemo(
    () => cartItems.some((item) => item.formatKey === "physical"),
    [cartItems]
  );

  const hasDigital = useMemo(
    () => cartItems.some((item) => item.formatKey === "digital"),
    [cartItems]
  );

  const availablePaymentOptions = useMemo(() => {
    if (hasDigital && !hasPhysical) {
      return paymentOptions.filter((option) => option.value === "card");
    }
    return paymentOptions;
  }, [hasDigital, hasPhysical]);
  const hasAlternativePayment = useMemo(
    () => availablePaymentOptions.some((option) => option.value !== "card"),
    [availablePaymentOptions]
  );

  useEffect(() => {
    if (hasDigital && !hasPhysical && paymentMethod !== "card") {
      setPaymentMethod("card");
    }
  }, [hasDigital, hasPhysical, paymentMethod]);

  const totalValue = useMemo(
    () => cartItems.reduce((sum, item) => sum + item.priceValue * item.quantity, 0),
    [cartItems]
  );
  const totalLabel = formatPrice(totalValue);
  const deliveryCost = useMemo(
    () => (hasPhysical ? resolveDeliveryCost(form.shippingMethod) : 0),
    [hasPhysical, form.shippingMethod]
  );
  const grandTotal = useMemo(() => totalValue + deliveryCost, [totalValue, deliveryCost]);
  const sbpQrPayload = useMemo(() => {
    const orderRef = pendingOrderId ? String(pendingOrderId) : "pending";
    const amount = Math.max(0, grandTotal);
    if (sbpQrPayloadOverride) {
      return applySbpTemplate(sbpQrPayloadOverride, {
        order: orderRef,
        amount,
        merchant: sbpMerchant,
      });
    }
    const params = new URLSearchParams({
      order: orderRef,
      amount: String(amount),
      merchant: sbpMerchant,
      test: "1",
    });
    return `sbp://pay?${params.toString()}`;
  }, [pendingOrderId, grandTotal, sbpQrPayloadOverride, sbpMerchant]);

  useEffect(() => {
    if (!isPaymentsMock || paymentMethod !== "sbp") {
      setSbpQrSvg(null);
      setSbpQrError(null);
      return;
    }
    if (sbpQrImageOverride) {
      setSbpQrSvg(null);
      setSbpQrError(null);
      return;
    }
    let isActive = true;
    setSbpQrError(null);
    QRCode.toString(sbpQrPayload, {
      type: "svg",
      width: 160,
      margin: 1,
      color: {
        dark: "#BFF4FF",
        light: "#00000000",
      },
    })
      .then((svg) => {
        if (isActive) {
          setSbpQrSvg(svg);
        }
      })
      .catch(() => {
        if (isActive) {
          setSbpQrSvg(null);
          setSbpQrError("Не удалось сгенерировать QR-код.");
        }
      });
    return () => {
      isActive = false;
    };
  }, [isPaymentsMock, paymentMethod, sbpQrPayload, sbpQrImageOverride]);
  const isPaymentStep = step === "payment";
  const isAwaitingOrderCreation = isPaymentsMock && !pendingOrderId;
  const stepperSteps = useMemo(
    () => [
      {
        id: 1,
        title: "Доставка",
        description: "Выберите службу",
        completed: !hasPhysical || Boolean(form.shippingMethod),
        current: hasPhysical && !isPaymentStep,
      },
      {
        id: 2,
        title: "Оплата",
        description: "Метод оплаты",
        completed: Boolean(paymentMethod) || isPaymentStep,
        current: !hasPhysical || isPaymentStep || Boolean(paymentMethod),
      },
    ],
    [hasPhysical, form.shippingMethod, paymentMethod, isPaymentStep]
  );

  const getFormErrors = useCallback(() => {
    const errors: typeof fieldErrors = {};
    let submitError: string | null = null;
    let firstErrorField: keyof typeof fieldErrors | null = null;

    const name = form.name.trim();
    const email = form.email.trim();
    const city = form.city.trim();
    const address = normalizeAddressInput(form.address);

    if (!name || !email) {
      submitError = "Заполните имя и email.";
      if (!name) {
        errors.name = "Укажите имя.";
      }
      if (!email) {
        errors.email = "Укажите email.";
      }
      firstErrorField = !name ? "name" : "email";
      return { errors, submitError, firstErrorField, isValid: false };
    }

    if (!NAME_REGEX.test(name)) {
      submitError = "Имя может содержать только буквы, пробелы, дефис и апостроф.";
      errors.name = "Разрешены только буквы, пробел, дефис и апостроф.";
      firstErrorField = "name";
      return { errors, submitError, firstErrorField, isValid: false };
    }

    const normalizedName = normalizeNameInput(name);
    if (KNOWN_CITY_SET.has(normalizedName)) {
      submitError = "Имя не должно быть названием города.";
      errors.name = "Укажите имя, а не город.";
      firstErrorField = "name";
      return { errors, submitError, firstErrorField, isValid: false };
    }

    if (hasPhysical && (!city || !address)) {
      submitError = "Укажите город и адрес доставки.";
      if (!city) {
        errors.city = "Укажите город.";
      }
      if (!address) {
        errors.address = "Укажите адрес.";
      }
      firstErrorField = !city ? "city" : "address";
      return { errors, submitError, firstErrorField, isValid: false };
    }

    if (hasPhysical) {
      if (!CITY_REGEX.test(city)) {
        submitError = "Город может содержать только буквы, пробелы, точку и дефис.";
        errors.city = "Разрешены только буквы, пробел, точка и дефис.";
        firstErrorField = "city";
        return { errors, submitError, firstErrorField, isValid: false };
      }
      const normalizedCity = normalizeCityInput(city);
      if (!KNOWN_CITY_SET.has(normalizedCity)) {
        submitError = "Город должен быть реальным. Выберите из списка.";
        errors.city = "Выберите город из списка.";
        firstErrorField = "city";
        return { errors, submitError, firstErrorField, isValid: false };
      }
      if (normalizedName === normalizedCity) {
        submitError = "Имя и город не должны совпадать.";
        errors.city = "Город не должен совпадать с именем.";
        firstErrorField = "city";
        return { errors, submitError, firstErrorField, isValid: false };
      }
      if (!ADDRESS_REGEX.test(address)) {
        submitError =
          "Адрес может содержать только буквы, цифры, пробел, запятую, точку, дефис, слэш и №.";
        errors.address =
          "Разрешены буквы, цифры, пробел, запятая, точка, дефис, слэш и №.";
        firstErrorField = "address";
        return { errors, submitError, firstErrorField, isValid: false };
      }
    }

    return { errors, submitError, firstErrorField, isValid: true };
  }, [form, hasPhysical]);

  const canCheckout =
    cartItems.length > 0 &&
    step === "form" &&
    !submitLock;

  const focusField = useCallback((field: keyof typeof fieldErrors) => {
    const ref =
      field === "name"
        ? nameRef
        : field === "email"
          ? emailRef
          : field === "city"
            ? cityRef
            : addressRef;
    ref.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    ref.current?.focus?.();
  }, []);

  const handleInputChange = (field: keyof typeof form) => (
    event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    setForm((prev) => ({ ...prev, [field]: event.target.value }));
    if (submitError) {
      setSubmitError(null);
    }
    if (field in fieldErrors) {
      const key = field as keyof typeof fieldErrors;
      setFieldErrors((prev) =>
        prev[key] ? { ...prev, [key]: undefined } : prev
      );
    }
  };

  const requestPaymentIntent = useCallback(
    async (orderId: string) => {
      const response = await fetch(paymentsIntentUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({ orderId }),
      });
      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        throw new Error(errorText || "Не удалось создать платеж.");
      }
      return response.json();
    },
    [paymentsIntentUrl]
  );

  const handleRefreshPaymentIntent = useCallback(async () => {
    if (paymentsMode !== "stripe") return;
    if (!pendingOrderId) return;
    setPaymentLoading(true);
    setPaymentStageError(null);
    try {
      const paymentData = await requestPaymentIntent(pendingOrderId);
      const nextStatus = String(paymentData?.paymentStatus || "pending");
      const nextIntent =
        typeof paymentData?.paymentIntentId === "string" ? paymentData.paymentIntentId : null;
      const nextClientSecret =
        typeof paymentData?.clientSecret === "string" ? paymentData.clientSecret : null;
      setPaymentIntentId(nextIntent);
      setPaymentClientSecret(nextClientSecret);
      if (nextStatus === "paid") {
        if (typeof window !== "undefined") {
          window.dispatchEvent(new Event("orders-updated"));
        }
        router.push(`/checkout/success?orderId=${encodeURIComponent(pendingOrderId)}`);
        return;
      }
      if (nextStatus === "failed") {
        setPaymentStageError("Оплата отклонена. Попробуйте снова.");
      }
    } catch (error) {
      setPaymentStageError(
        error instanceof Error ? error.message : "Не удалось обновить платеж."
      );
    } finally {
      setPaymentLoading(false);
    }
  }, [pendingOrderId, paymentsMode, requestPaymentIntent, router]);

  const confirmStripePayment = useCallback(
    async (orderId: string, paymentIntentId: string) => {
      const response = await fetch(paymentsConfirmUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({ orderId, paymentIntentId }),
      });
      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        throw new Error(errorText || "Не удалось подтвердить оплату.");
      }
      return response.json();
    },
    [paymentsConfirmUrl]
  );

  const createOrder = useCallback(
    async (payload: Record<string, any>) => {
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error("Request timeout: Order creation took too long.")),
          120000
        );
      });

      const response = (await Promise.race([
        fetch(ordersApiUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include",
          body: JSON.stringify(payload),
        }),
        timeoutPromise,
      ])) as Response;

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        let errorMessage = errorText || "Order creation failed.";
        try {
          const errorJson = JSON.parse(errorText);
          if (errorJson.message) {
            errorMessage = errorJson.message;
          } else if (errorJson.errors && Array.isArray(errorJson.errors)) {
            errorMessage = errorJson.errors.map((e: any) => e.message || e.error).join(", ");
          } else if (errorJson.error) {
            errorMessage = errorJson.error;
          }
        } catch {
          // Keep original error text if not JSON
        }
        throw new Error(errorMessage);
      }

      const responseData = await response.json();
      const createdOrderId = responseData?.doc?.id || responseData?.id || null;
      let paymentStatus = String(
        responseData?.doc?.paymentStatus || responseData?.paymentStatus || "paid"
      );
      let nextIntentId: string | null = null;
      let nextClientSecret: string | null = null;
      let paymentIntentError: string | null = null;
      const shouldRequestPayment =
        Boolean(createdOrderId) && paymentMethod === "card" && paymentsMode === "stripe";
      if (shouldRequestPayment && createdOrderId) {
        try {
          const paymentData = await requestPaymentIntent(createdOrderId);
          paymentStatus = String(paymentData?.paymentStatus || paymentStatus);
          nextIntentId =
            typeof paymentData?.paymentIntentId === "string"
              ? paymentData.paymentIntentId
              : null;
          nextClientSecret =
            typeof paymentData?.clientSecret === "string"
              ? paymentData.clientSecret
              : null;
        } catch (error) {
          paymentIntentError =
            error instanceof Error ? error.message : "Не удалось создать платеж.";
          paymentStatus = "pending";
        }
      }

      if (paymentsMode === "mock" && createdOrderId) {
        paymentStatus = "pending";
      }

      return {
        createdOrderId,
        paymentStatus,
        nextIntentId,
        nextClientSecret,
        paymentIntentError,
      };
    },
    [ordersApiUrl, paymentMethod, paymentsMode, requestPaymentIntent]
  );

  const handlePaymentSimulation = useCallback(
    async (status: "paid" | "failed") => {
      if (!pendingOrderId && !pendingOrderPayload) {
        setPaymentStageError(
          "Не удалось подготовить заказ. Обновите страницу и попробуйте снова."
        );
        return;
      }
      setPaymentLoading(true);
      setPaymentStageError(null);
      try {
        let orderId = pendingOrderId;
        if (!orderId && pendingOrderPayload) {
          const { createdOrderId } = await createOrder(pendingOrderPayload);
          if (!createdOrderId) {
            throw new Error("Не удалось создать заказ.");
          }
          orderId = createdOrderId;
          setPendingOrderId(createdOrderId);
        }
        if (!orderId) {
          throw new Error("Не удалось создать заказ.");
        }
        const response = await fetch(paymentsConfirmUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include",
          body: JSON.stringify({ orderId, status }),
        });
        if (!response.ok) {
          const errorText = await response.text().catch(() => "");
          throw new Error(errorText || "Не удалось обновить статус оплаты.");
        }
        if (status === "paid") {
          if (typeof window !== "undefined") {
            window.dispatchEvent(new Event("orders-updated"));
          }
          if (typeof window !== "undefined") {
            removeCartStorage(cartStorageKey);
          }
          setCartItems([]);
          setPendingOrderPayload(null);
          router.push(`/checkout/success?orderId=${encodeURIComponent(orderId)}`);
        } else {
          setPaymentStageError("Оплата отклонена. Попробуйте снова.");
        }
      } catch (error) {
        setPaymentStageError(
          error instanceof Error ? error.message : "Не удалось обновить статус оплаты."
        );
      } finally {
        setPaymentLoading(false);
      }
    },
    [cartStorageKey, createOrder, pendingOrderId, pendingOrderPayload, paymentsConfirmUrl, router]
  );

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (step === "processing" || cartItems.length === 0 || submitLock) {
      return;
    }

    const { errors, submitError: validationError, firstErrorField, isValid } = getFormErrors();
    setFieldErrors(errors);
    if (!isValid) {
      if (validationError) {
        setSubmitError(validationError);
      }
      if (firstErrorField) {
        focusField(firstErrorField);
      }
      return;
    }

    const name = form.name.trim();
    const email = form.email.trim();
    const city = form.city.trim();
    const address = normalizeAddressInput(form.address);
    const zipCode = form.zipCode.trim();
    const shippingMethod = form.shippingMethod;

    if (!userId) {
      setSubmitError("Войдите или зарегистрируйтесь, чтобы завершить заказ.");
      router.push("/profile?from=checkout");
      return;
    }

    setSubmitError(null);
    setSubmitLock(true);

    try {
      // Validate products before creating order
      const validation = await validateProducts(cartItems);
      if (validation.invalidProducts.length > 0) {
        const invalidNames = validation.invalidProducts.map((item) => item.name).join(", ");
        setSubmitError(
          `Следующие товары недоступны: ${invalidNames}. Пожалуйста, удалите их из корзины.`
        );
        setStep("form");
        setSubmitLock(false);
        return;
      }

      setStep("processing");
      const items: Array<{
        product: string;
        format: "Physical" | "Digital";
        quantity: number;
        unitPrice: number;
        customerUpload?: string;
        sourcePrice?: number;
        printSpecs?: {
          technology?: string;
          material?: string;
          quality?: string;
          dimensions?: { x: number; y: number; z: number };
          volumeCm3?: number;
        };
      }> = [];

      for (const item of cartItems) {
        const productId = resolveCartProductId(item);
        const productIdStr = typeof productId === "string" ? productId.trim() : "";
        if (!productIdStr) {
          setSubmitError("Ошибка: Товар не найден.");
          setStep("form");
          setSubmitLock(false);
          return;
        }

        const customerUpload = item.customPrint?.uploadId;
        const sourcePrice = item.customPrint?.sourcePrice;
        const printSpecs = item.customPrint
          ? {
              technology: item.customPrint.technology,
              material: item.customPrint.material,
              quality: item.customPrint.quality,
              dimensions: item.customPrint.dimensions,
              volumeCm3: item.customPrint.volumeCm3,
            }
          : undefined;

        items.push({
          product: productIdStr,
          format: item.formatKey === "physical" ? "Physical" : "Digital",
          quantity: item.quantity,
          unitPrice: item.priceValue,
          customerUpload,
          sourcePrice,
          printSpecs,
        });
      }
      

      const payload: Record<string, any> = {
        items,
        total: grandTotal,
        status: "paid",
        paymentMethod,
        customer: {
          name,
          email,
        },
      };

      if (hasPhysical) {
        const shippingPayload: Record<string, any> = {
          method: shippingMethod,
          city,
          address,
        };
        if (zipCode) {
          shippingPayload.zipCode = zipCode;
        }
        payload.shipping = shippingPayload;
      }

      const isMockPayment = isPaymentsMock;
      if (isMockPayment) {
        setPendingOrderPayload(payload);
        setPendingOrderId(null);
        setPaymentIntentId(null);
        setPaymentClientSecret(null);
        setPaymentStageError(null);
        setStep("payment");
        setSubmitLock(false);
        return;
      }

      const {
        createdOrderId,
        paymentStatus,
        nextIntentId,
        nextClientSecret,
        paymentIntentError,
      } = await createOrder(payload);

      if (!createdOrderId) {
        throw new Error("Не удалось создать заказ.");
      }

      if (typeof window !== "undefined") {
        removeCartStorage(cartStorageKey);
        window.dispatchEvent(new Event("orders-updated"));
      }
      setCartItems([]);
      
      if (paymentStatus === "pending" && createdOrderId) {
        setPendingOrderId(createdOrderId);
        setPaymentIntentId(nextIntentId);
        setPaymentClientSecret(nextClientSecret);
        setPaymentStageError(paymentIntentError);
        setStep("payment");
        setSubmitLock(false);
        return;
      }

      // Redirect to success page with order ID
      const successUrl = createdOrderId 
        ? `/checkout/success?orderId=${encodeURIComponent(createdOrderId)}`
        : "/checkout/success";
      
      router.push(successUrl);
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Не удалось оформить заказ. Попробуйте ещё раз.";
      setSubmitError(message);
      setStep("form");
      setSubmitLock(false);
    }
  };

  const handleMockCardPay = useCallback(async () => {
    if (!pendingOrderPayload) {
      setPaymentStageError(
        "Не удалось подготовить заказ. Обновите страницу и попробуйте снова."
      );
      return;
    }
    setPaymentLoading(true);
    setPaymentStageError(null);
    try {
      const { createdOrderId } = await createOrder(pendingOrderPayload);
      if (!createdOrderId) {
        throw new Error("Не удалось создать заказ.");
      }

      setPendingOrderId(createdOrderId);

      const response = await fetch(paymentsConfirmUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({ orderId: createdOrderId, status: "paid" }),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        throw new Error(errorText || "Не удалось завершить оплату.");
      }

      if (typeof window !== "undefined") {
        removeCartStorage(cartStorageKey);
        window.dispatchEvent(new Event("orders-updated"));
      }
      setCartItems([]);
      setPendingOrderPayload(null);
      router.push(`/checkout/success?orderId=${encodeURIComponent(createdOrderId)}`);
    } catch (error) {
      setPaymentStageError(
        error instanceof Error ? error.message : "Не удалось завершить оплату."
      );
    } finally {
      setPaymentLoading(false);
    }
  }, [cartStorageKey, createOrder, pendingOrderPayload, paymentsConfirmUrl, router]);

  return (
    <div className="min-h-screen bg-[#050505] text-white">
      <div className="pointer-events-none fixed inset-0 cad-grid-pattern opacity-40" />
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute -left-40 top-[-20%] h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle,rgba(46,209,255,0.2),transparent_70%)] blur-2xl" />
        <div className="absolute right-[-15%] top-10 h-[420px] w-[420px] rounded-full bg-[radial-gradient(circle,rgba(212,175,55,0.16),transparent_70%)] blur-2xl" />
      </div>

      <div className="relative z-10 mx-auto max-w-[1200px] px-6 pb-24 pt-10">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-[var(--font-jetbrains-mono)] uppercase tracking-[0.3em] text-white/50">
            Checkout
            </p>
            <h1 className="mt-3 text-3xl font-semibold text-white">Оформление заказа</h1>
          </div>
          <Link
            href="/store"
            className="flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-xs uppercase tracking-[0.3em] text-white/60 transition hover:text-white"
          >
            Назад в магазин
          </Link>
        </div>

        <AnimatePresence mode="wait">
          {step === "form" ? (
            <motion.form
              key="checkout-form"
              onSubmit={handleSubmit}
              ref={formRef}
              noValidate
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.35 }}
              className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]"
            >
              <div className="hidden lg:col-span-2 md:block">
                <CheckoutStepper steps={stepperSteps} variant="compact" />
              </div>
              <div className="min-w-0 space-y-6 rounded-[28px] border border-white/10 bg-white/[0.04] p-5 backdrop-blur-xl">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#2ED1FF]/15 text-[#2ED1FF]">
                    <ShieldCheck className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white">Контактные данные</p>
                    <p className="text-xs text-white/60">Используем для подтверждения заказа.</p>
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2 sm:col-span-2">
                    <label className="text-xs uppercase tracking-[0.3em] text-white/50">Имя</label>
                    <input
                      type="text"
                      ref={nameRef}
                      value={form.name}
                      onChange={handleInputChange("name")}
                      required
                      aria-invalid={Boolean(fieldErrors.name)}
                      aria-describedby={fieldErrors.name ? "checkout-name-error" : undefined}
                      className={`w-full rounded-2xl border bg-white/5 px-4 py-3 text-sm text-white outline-none transition focus:border-[#2ED1FF]/60 ${
                        fieldErrors.name
                          ? "border-rose-400/60 ring-1 ring-rose-400/40"
                          : "border-white/10"
                      }`}
                    />
                    {fieldErrors.name && (
                      <p id="checkout-name-error" className="text-xs text-rose-300">
                        {fieldErrors.name}
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs uppercase tracking-[0.3em] text-white/50">
                      Email
                    </label>
                    <input
                      type="email"
                      ref={emailRef}
                      value={form.email}
                      onChange={handleInputChange("email")}
                      required
                      aria-invalid={Boolean(fieldErrors.email)}
                      aria-describedby={fieldErrors.email ? "checkout-email-error" : undefined}
                      className={`w-full rounded-2xl border bg-white/5 px-4 py-3 text-sm text-white outline-none transition focus:border-[#2ED1FF]/60 ${
                        fieldErrors.email
                          ? "border-rose-400/60 ring-1 ring-rose-400/40"
                          : "border-white/10"
                      }`}
                    />
                    {fieldErrors.email && (
                      <p id="checkout-email-error" className="text-xs text-rose-300">
                        {fieldErrors.email}
                      </p>
                    )}
                  </div>
                </div>

                {hasPhysical && (
                  <div className="space-y-4 rounded-[22px] border border-white/10 bg-white/[0.03] p-5">
                    <p className="text-xs uppercase tracking-[0.3em] text-white/50">
                      {shippingLabels.sectionTitle}
                    </p>
                    <div className="space-y-3">
                      <p className="text-sm text-white/70">Выберите службу доставки</p>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {deliveryOptions.map((option) => (
                          <DeliveryCard
                            key={option.id}
                            option={option}
                            selected={form.shippingMethod === option.id}
                            onSelect={(id) =>
                              setForm((prev) => ({
                                ...prev,
                                shippingMethod: id,
                              }))
                            }
                          />
                        ))}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs uppercase tracking-[0.3em] text-white/50">
                        {shippingLabels.city}
                      </label>
                      <input
                        type="text"
                        list="checkout-city-suggestions"
                        ref={cityRef}
                        value={form.city}
                        onChange={handleInputChange("city")}
                        required={hasPhysical}
                        autoComplete="address-level2"
                        aria-invalid={Boolean(fieldErrors.city)}
                        aria-describedby={fieldErrors.city ? "checkout-city-error" : undefined}
                        className={`w-full rounded-2xl border bg-white/5 px-4 py-3 text-sm text-white outline-none transition focus:border-[#2ED1FF]/60 ${
                          fieldErrors.city
                            ? "border-rose-400/60 ring-1 ring-rose-400/40"
                            : "border-white/10"
                        }`}
                      />
                      {fieldErrors.city && (
                        <p id="checkout-city-error" className="text-xs text-rose-300">
                          {fieldErrors.city}
                        </p>
                      )}
                      <datalist id="checkout-city-suggestions">
                        {citySuggestions.map((city) => (
                          <option key={city} value={city} />
                        ))}
                      </datalist>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs uppercase tracking-[0.3em] text-white/50">
                        {shippingLabels.address}
                      </label>
                      <textarea
                        ref={addressRef}
                        value={form.address}
                        onChange={handleInputChange("address")}
                        required={hasPhysical}
                        rows={3}
                        placeholder="Улица, дом, квартира"
                        aria-invalid={Boolean(fieldErrors.address)}
                        aria-describedby={fieldErrors.address ? "checkout-address-error" : undefined}
                        className={`w-full rounded-2xl border bg-white/5 px-4 py-3 text-sm text-white outline-none transition focus:border-[#2ED1FF]/60 ${
                          fieldErrors.address
                            ? "border-rose-400/60 ring-1 ring-rose-400/40"
                            : "border-white/10"
                        }`}
                      />
                      {fieldErrors.address && (
                        <p id="checkout-address-error" className="text-xs text-rose-300">
                          {fieldErrors.address}
                        </p>
                      )}
                      {streetSuggestions.length > 0 && (
                        <div className="rounded-2xl border border-white/10 bg-[#0b0f12]/80 p-2 text-xs text-white/70 shadow-[0_0_18px_rgba(0,0,0,0.35)] backdrop-blur">
                          <p className="px-2 py-1 text-[10px] uppercase tracking-[0.3em] text-white/40">
                            Улицы
                          </p>
                          <div className="space-y-1">
                            {streetSuggestions.map((street) => (
                              <button
                                key={street}
                                type="button"
                                className="w-full rounded-xl px-3 py-2 text-left transition hover:bg-white/5 hover:text-white"
                                onClick={() => applyStreetSuggestion(street)}
                              >
                                {street}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="space-y-2">
                      <label className="flex items-center justify-between text-xs uppercase tracking-[0.2em] text-white/50">
                        <span>zip_code</span>
                        <span className="text-[10px] tracking-[0.25em] text-white/40">
                          {shippingLabels.zipHelper}
                        </span>
                      </label>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={form.zipCode}
                        onChange={handleInputChange("zipCode")}
                        className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none transition focus:border-[#2ED1FF]/60"
                      />
                    </div>
                  </div>
                )}

                {hasDigital && (
                  <div className="rounded-[22px] border border-white/10 bg-white/[0.03] p-5">
                    <p className="text-xs uppercase tracking-[0.3em] text-white/50">
                      {digitalLabels.title}
                    </p>
                    <p className="text-sm text-white/60">{digitalLabels.info}</p>
                  </div>
                )}
                <div className="space-y-3 rounded-[22px] border border-white/10 bg-white/[0.03] p-5">
                  <p className="text-xs uppercase tracking-[0.3em] text-white/50">Оплата</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {availablePaymentOptions.map((option) => (
                      <label
                        key={option.value}
                        className={`flex items-center gap-2 rounded-2xl border px-4 py-3 text-sm transition sm:gap-3 ${
                          paymentMethod === option.value
                            ? "border-[#2ED1FF]/80 bg-[#0b1014] text-[#BFF4FF] shadow-[0_0_16px_rgba(46,209,255,0.3)]"
                            : "border-white/15 bg-white/5 text-white/75 hover:border-white/25 hover:bg-white/10"
                        }`}
                      >
                        <input
                          type="radio"
                          className="hidden h-4 w-4 accent-[#2ED1FF] sm:inline-block"
                          checked={paymentMethod === option.value}
                          onChange={() => setPaymentMethod(option.value)}
                        />
                        {option.label}
                      </label>
                    ))}
                  </div>
                  {hasDigital && !hasPhysical && (
                    <p className="text-xs text-white/50">
                      Для цифровых файлов доступна только оплата картой.
                    </p>
                  )}
                </div>
                {submitError && (
                  <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                    {submitError}
                  </div>
                )}
              </div>

              <div className="min-w-0">
                <StickyOrderSummary
                  items={cartItems.map((item) => ({
                    id: item.id,
                    name: item.name,
                    formatLabel: item.formatLabel,
                    priceValue: item.priceValue,
                    quantity: item.quantity,
                    thumbnailUrl: item.thumbnailUrl,
                  }))}
                  subtotal={totalValue}
                  deliveryCost={deliveryCost}
                  total={grandTotal}
                  onCheckout={() => formRef.current?.requestSubmit()}
                  canCheckout={canCheckout}
                  isProcessing={isProcessing}
                />
                {!userId && (
                  <p className="mt-3 text-xs text-white/60">
                    Войдите, чтобы оплатить заказ.

                    <Link href="/profile" className="text-white underline underline-offset-4">
                      Перейти в профиль
                    </Link>
                  </p>
                )}
              </div>
            </motion.form>
          ) : step === "payment" ? (
            <motion.div
              key="checkout-payment"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.35 }}
              className="mt-12 space-y-6"
            >
              <div className="hidden md:block">
                <CheckoutStepper steps={stepperSteps} variant="compact" />
              </div>
              <div className="rounded-[32px] border border-white/10 bg-white/[0.04] px-4 py-8 text-center backdrop-blur-xl sm:px-6 sm:py-10">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#2ED1FF]/15 text-[#2ED1FF]">
                  <ShieldCheck className="h-6 w-6" />
                </div>
                <h2 className="mt-5 text-2xl font-semibold text-white">Ожидаем оплату</h2>
                <p className="mt-2 text-sm text-white/60">
                  {isAwaitingOrderCreation
                    ? "Заказ будет создан после оплаты."
                    : "Заказ создан. Проведите оплату, чтобы получить доступ к файлам."}
                </p>
                {isPaymentsMock && (
                  <p className="mt-2 text-[10px] uppercase tracking-[0.3em] text-[#2ED1FF]/70">
                    Тестовый режим оплаты
                  </p>
                )}
                <div className="mt-6 space-y-2 text-xs text-white/60">
                  {pendingOrderId && (
                    <p>{`Номер заказа: ${pendingOrderId}`}</p>
                  )}
                  {paymentIntentId && (
                    <p>{`Платеж: ${paymentIntentId}`}</p>
                  )}
                </div>
                {paymentStageError && (
                  <div className="mt-4 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                    {paymentStageError}
                  </div>
                )}
                {isPaymentsMock && paymentMethod === "card" ? (
                  <MockCardForm
                    paymentLoading={paymentLoading}
                    onPay={handleMockCardPay}
                    onClearStageError={() => setPaymentStageError(null)}
                  />
                ) : isStripeMode && paymentMethod === "card" ? (
                  stripePromise && paymentClientSecret && pendingOrderId ? (
                    <Elements stripe={stripePromise}>
                      <StripePaymentForm
                        orderId={pendingOrderId}
                        clientSecret={paymentClientSecret}
                        customerName={form.name.trim() || "Покупатель"}
                        customerEmail={form.email.trim()}
                        paymentLoading={paymentLoading}
                        onSetPaymentLoading={setPaymentLoading}
                        onConfirmPayment={confirmStripePayment}
                        onPaid={(orderId) => {
                          if (typeof window !== "undefined") {
                            window.dispatchEvent(new Event("orders-updated"));
                          }
                          router.push(`/checkout/success?orderId=${encodeURIComponent(orderId)}`);
                        }}
                        onClearStageError={() => setPaymentStageError(null)}
                      />
                    </Elements>
                  ) : (
                    <div className="mx-auto mt-6 w-full max-w-[480px] space-y-4 text-left">
                      <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                        {!stripePromise
                          ? "Stripe не настроен. Добавьте ключи в переменные окружения."
                          : "Не удалось создать платеж. Обновите страницу и попробуйте снова."}
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-black/40 px-4 py-4">
                        <p className="text-xs uppercase tracking-[0.3em] text-white/50">
                          Тестовые карты
                        </p>
                        <p className="mt-1 text-[11px] text-white/50">
                          Любой будущий срок, любой CVC.
                        </p>
                        <div className="mt-3 space-y-2 text-xs text-white/70">
                          {STRIPE_TEST_CARDS.map((card) => (
                            <div key={card.number} className="flex items-center justify-between gap-3">
                              <span className="font-mono text-[11px] text-white/80">
                                {card.number}
                              </span>
                              <span className="text-[11px] text-white/50">{card.label}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                      {hasAlternativePayment ? (
                        <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-xs text-white/60">
                          Можно выбрать другой способ оплаты:
                          <div className="mt-3 flex flex-wrap gap-2">
                            {availablePaymentOptions
                              .filter((option) => option.value !== "card")
                              .map((option) => (
                                <button
                                  key={option.value}
                                  type="button"
                                  className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-[10px] uppercase tracking-[0.3em] text-white/70 transition hover:border-white/30 hover:text-white"
                                  onClick={() => setPaymentMethod(option.value)}
                                  disabled={paymentLoading}
                                >
                                  {option.label}
                                </button>
                              ))}
                          </div>
                        </div>
                      ) : (
                        <p className="text-xs text-white/50">
                          Для цифровых файлов доступна только оплата картой. Настройте Stripe,
                          чтобы продолжить.
                        </p>
                      )}
                      <div className="flex flex-wrap justify-center gap-3">
                        <button
                          type="button"
                          className="w-full rounded-full border border-white/20 bg-white/5 px-5 py-2 text-[10px] uppercase tracking-[0.3em] text-white/70 transition hover:border-white/40 hover:text-white sm:w-auto sm:text-xs"
                          onClick={handleRefreshPaymentIntent}
                          disabled={paymentLoading}
                        >
                          Проверить статус
                        </button>
                      </div>
                    </div>
                  )
                ) : (
                  <div className="mt-6 flex flex-col items-center gap-4">
                    {isPaymentsMock && paymentMethod !== "card" && (
                      <div className="w-full max-w-[480px] rounded-3xl border border-white/10 bg-black/40 p-5 text-left">
                        {paymentMethod === "sbp" ? (
                          <>
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <p className="text-xs uppercase tracking-[0.3em] text-white/50">
                                Оплата по СБП
                              </p>
                              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] uppercase tracking-[0.3em] text-[#BFF4FF]">
                                QR
                              </span>
                            </div>
                            <div className="mt-4 flex flex-col items-center gap-4 md:flex-row">
                              <div className="flex h-40 w-40 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-[11px] text-white/60">
                                {sbpQrImageOverride ? (
                                  <img
                                    src={sbpQrImageOverride}
                                    alt="SBP QR"
                                    className="h-32 w-32 rounded-xl object-contain"
                                    loading="lazy"
                                  />
                                ) : sbpQrSvg ? (
                                  <div
                                    className="[&>svg]:h-32 [&>svg]:w-32"
                                    aria-label="SBP QR"
                                    dangerouslySetInnerHTML={{ __html: sbpQrSvg }}
                                  />
                                ) : sbpQrError ? (
                                  <span className="text-center text-[10px] uppercase tracking-[0.2em] text-red-300">
                                    QR недоступен
                                  </span>
                                ) : (
                                  <span className="text-center text-[10px] uppercase tracking-[0.2em] text-white/60">
                                    Генерируем QR...
                                  </span>
                                )}
                              </div>
                              <div className="flex-1 space-y-2 text-sm text-white/70">
                                <p>Отсканируйте QR-код в банковском приложении.</p>
                                <p className="text-xs text-white/50">
                                  Оплатите в течение 10 минут, затем вернитесь сюда.
                                </p>
                                {sbpQrImageOverride && (
                                  <p className="text-[11px] text-[#BFF4FF]/70">
                                    QR-код предоставлен банком.
                                  </p>
                                )}
                                <div className="flex flex-wrap gap-2">
                                  <BankBadge label="Сбер" accent="#21C25E" />
                                  <BankBadge label="Тинькофф" accent="#F59E0B" />
                                  <BankBadge label="Альфа" accent="#EF4444" />
                                  <BankBadge label="ВТБ" accent="#2563EB" />
                                  <BankBadge label="Газпромбанк" accent="#10B981" />
                                </div>
                              </div>
                            </div>
                          </>
                        ) : (
                          <>
                            <p className="text-xs uppercase tracking-[0.3em] text-white/50">
                              Оплата при получении
                            </p>
                            <p className="mt-3 text-sm text-white/70">
                              Мы подготовим заказ и свяжемся с вами для уточнения деталей.
                            </p>
                          </>
                        )}
                      </div>
                    )}
                    {isPaymentsMock && paymentMethod !== "card" && (
                      <button
                        type="button"
                        className="w-full rounded-full border border-[#2ED1FF]/70 bg-[#0b1014] px-5 py-2 text-[10px] uppercase tracking-[0.3em] text-[#BFF4FF] shadow-[0_0_16px_rgba(46,209,255,0.35)] transition hover:border-[#7FE7FF] sm:w-auto sm:text-xs"
                        onClick={() => handlePaymentSimulation("paid")}
                        disabled={paymentLoading}
                      >
                        {paymentLoading
                          ? "Оплата..."
                          : paymentMethod === "sbp"
                            ? "Оплатил(а)"
                            : "Подтвердить заказ"}
                      </button>
                    )}
                    {isStripeMode && (
                      <button
                        type="button"
                        className="w-full rounded-full border border-white/20 bg-white/5 px-5 py-2 text-[10px] uppercase tracking-[0.3em] text-white/70 transition hover:border-white/40 hover:text-white sm:w-auto sm:text-xs"
                        onClick={handleRefreshPaymentIntent}
                        disabled={paymentLoading}
                      >
                        Проверить статус
                      </button>
                    )}
                  </div>
                )}
                <div className="mt-6">
                  <Link
                    href="/profile"
                    className="text-xs uppercase tracking-[0.3em] text-white/60 underline underline-offset-4 transition hover:text-white"
                  >
                    Перейти в профиль
                  </Link>
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="checkout-processing"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.35 }}
              className="mt-12 flex flex-col items-center justify-center rounded-[32px] border border-white/10 bg-white/[0.04] px-6 py-16 text-center backdrop-blur-xl"
            >
              <Loader2 className="h-8 w-8 animate-spin text-[#2ED1FF]" />
              <h2 className="mt-6 text-2xl font-semibold text-white">Обрабатываем оплату</h2>
              <p className="mt-2 text-sm text-white/60">Пожалуйста, подождите...</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default CheckoutPage;
