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
import { Loader2, Save, ShieldCheck } from "lucide-react";
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
import {
  clearCheckoutSelection,
  getCartStorageKey,
  readCartStorage,
  readCheckoutSelection,
  removeCartStorage,
  writeCartStorage,
} from "@/lib/cartStorage";
import { getCheckoutDraftKey, saveCheckoutDraftRecord } from "@/lib/checkoutDrafts";
import { normalizePaymentsMode } from "@/lib/paymentsMode";

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
  color?: string;
  quality?: string;
  note?: string;
  packaging?: string;
  isHollow?: boolean;
  dimensions?: { x: number; y: number; z: number };
  volumeCm3?: number;
};

type AppliedPromo = {
  code: string;
  discountAmount: number;
  description?: string;
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
    color: typeof raw.color === "string" ? raw.color : undefined,
    quality: typeof raw.quality === "string" ? raw.quality : undefined,
    note: typeof raw.note === "string" ? raw.note : undefined,
    packaging: typeof raw.packaging === "string" ? raw.packaging : undefined,
    isHollow: typeof raw.isHollow === "boolean" ? raw.isHollow : undefined,
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
const shippingMethodSet = new Set(
  shippingMethodOptions.map((option) => option.value)
);
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

const CHECKOUT_LOG_KEY = "checkout:events:v1";
const CHECKOUT_LOG_MAX = 50;
const DRAFT_SAVE_DEBOUNCE_MS = 450;

const safeJsonParse = (value: string) => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};
const checkoutDebug =
  (process.env.NEXT_PUBLIC_CHECKOUT_DEBUG || "").toLowerCase() === "true";
const paymentOptions = [
  { value: "card", label: "Оплата картой" },
  { value: "sbp", label: "СБП" },
  { value: "cash", label: "Наличными при получении" },
];
const paymentMethodSet = new Set(paymentOptions.map((option) => option.value));

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
const PHONE_REGEX = /^[+0-9()\s-]{6,20}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const ZIP_CODE_REGEX = /^\d{4,10}$/;

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
const promoPlaceholderExample = (
  process.env.NEXT_PUBLIC_PROMO_PLACEHOLDER_EXAMPLE || "WELCOME10"
).trim();
const showAppliedPromoCode =
  (process.env.NEXT_PUBLIC_SHOW_APPLIED_PROMO_CODE || "true").trim().toLowerCase() !==
  "false";
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

const createCheckoutRequestId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `chk_${crypto.randomUUID().replace(/-/g, "")}`;
  }
  return `chk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
};

const buildCheckoutPayloadSignature = (payload: Record<string, any>) => {
  const items = Array.isArray(payload?.items)
    ? payload.items
        .map((item: any) =>
          [
            String(item?.product ?? ""),
            String(item?.format ?? ""),
            String(item?.quantity ?? 1),
            String(item?.customerUpload ?? ""),
            String(item?.unitPrice ?? 0),
          ].join(":")
        )
        .sort()
        .join("|")
    : "";

  const customerName =
    typeof payload?.customer?.name === "string" ? payload.customer.name.trim() : "";
  const customerEmail =
    typeof payload?.customer?.email === "string"
      ? payload.customer.email.trim().toLowerCase()
      : "";
  const customerPhone =
    typeof payload?.customer?.phone === "string"
      ? payload.customer.phone.trim()
      : "";
  const shippingMethod =
    typeof payload?.shipping?.method === "string" ? payload.shipping.method : "";
  const shippingCity =
    typeof payload?.shipping?.city === "string"
      ? payload.shipping.city.trim().toLowerCase()
      : "";
  const shippingAddress =
    typeof payload?.shipping?.address === "string"
      ? payload.shipping.address.trim().toLowerCase()
      : "";
  const promoCode =
    typeof payload?.promoCode === "string" ? payload.promoCode.trim().toUpperCase() : "";
  const total =
    typeof payload?.total === "number" && Number.isFinite(payload.total) ? payload.total : 0;
  const paymentMethod =
    typeof payload?.paymentMethod === "string" ? payload.paymentMethod : "";

  return [
    customerName,
    customerEmail,
    customerPhone,
    shippingMethod,
    shippingCity,
    shippingAddress,
    promoCode,
    String(total),
    paymentMethod,
    items,
  ].join("||");
};

const mapQualityToPrintParam = (quality?: string) => {
  const normalized = (quality || "").trim().toLowerCase();
  if (!normalized) return "";
  if (normalized.includes("чернов")) return "draft";
  if (normalized.includes("0.05") || normalized.includes("pro")) return "pro";
  return "standard";
};

const buildPrintEditUrl = (item: CartItem) => {
  const custom = item.customPrint;
  if (!custom?.uploadUrl) return null;
  const params = new URLSearchParams();
  params.set("model", custom.uploadUrl);

  if (custom.uploadId) params.set("mediaId", custom.uploadId);
  if (custom.uploadName) params.set("name", custom.uploadName);
  if (custom.technology) params.set("tech", custom.technology);
  if (custom.material) params.set("material", custom.material);
  if (custom.color) params.set("color", custom.color);
  if (custom.note) params.set("note", custom.note);
  if (custom.packaging) params.set("packaging", custom.packaging);
  if (typeof custom.isHollow === "boolean") params.set("hollow", custom.isHollow ? "1" : "0");

  const quality = mapQualityToPrintParam(custom.quality);
  if (quality) params.set("quality", quality);
  if (item.quantity > 0) params.set("quantity", String(item.quantity));
  if (typeof custom.dimensions?.y === "number" && custom.dimensions.y > 0) {
    params.set("height", String(custom.dimensions.y));
  }

  if (
    typeof item.thumbnailUrl === "string" &&
    (item.thumbnailUrl.startsWith("/") ||
      item.thumbnailUrl.startsWith("http://") ||
      item.thumbnailUrl.startsWith("https://") ||
      item.thumbnailUrl.startsWith("data:") ||
      item.thumbnailUrl.startsWith("blob:"))
  ) {
    params.set("thumb", item.thumbnailUrl);
  }

  return `/services/print?${params.toString()}`;
};

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

type BankKey = "sber" | "tinkoff" | "alfa" | "vtb" | "gpb";

const BankLogo = ({ bankKey }: { bankKey: BankKey }) => {
  if (bankKey === "sber") {
    return (
      <svg viewBox="0 0 56 24" className="h-6 w-auto" aria-hidden="true">
        <rect width="56" height="24" rx="6" fill="#E7F8F1" />
        <circle cx="12" cy="12" r="6" fill="#16A34A" />
        <path
          d="M9 12.2l2 2.2 4.8-4.8"
          fill="none"
          stroke="#ffffff"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <text
          x="33"
          y="16"
          textAnchor="middle"
          fontSize="9"
          fontFamily="Arial Black, Arial, sans-serif"
          fill="#0F766E"
        >
          СБЕР
        </text>
      </svg>
    );
  }
  if (bankKey === "tinkoff") {
    return (
      <svg viewBox="0 0 56 24" className="h-6 w-auto" aria-hidden="true">
        <rect width="56" height="24" rx="6" fill="#FCD34D" />
        <rect x="6" y="5" width="12" height="14" rx="3" fill="#111827" />
        <text
          x="36"
          y="16"
          textAnchor="middle"
          fontSize="9"
          fontFamily="Arial Black, Arial, sans-serif"
          fill="#111827"
        >
          TINK
        </text>
      </svg>
    );
  }
  if (bankKey === "alfa") {
    return (
      <svg viewBox="0 0 56 24" className="h-6 w-auto" aria-hidden="true">
        <rect width="56" height="24" rx="6" fill="#DC2626" />
        <text
          x="28"
          y="16"
          textAnchor="middle"
          fontSize="9"
          fontFamily="Arial Black, Arial, sans-serif"
          fill="#ffffff"
        >
          АЛЬФА
        </text>
      </svg>
    );
  }
  if (bankKey === "vtb") {
    return (
      <svg viewBox="0 0 56 24" className="h-6 w-auto" aria-hidden="true">
        <rect width="56" height="24" rx="6" fill="#1D4ED8" />
        <text
          x="28"
          y="16"
          textAnchor="middle"
          fontSize="10"
          fontFamily="Arial Black, Arial, sans-serif"
          fill="#ffffff"
        >
          ВТБ
        </text>
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 56 24" className="h-6 w-auto" aria-hidden="true">
      <rect width="56" height="24" rx="6" fill="#0EA5E9" />
      <path
        d="M16 6c2.4 2.5 3.7 4.7 3.7 7a3.7 3.7 0 11-7.4 0c0-2.3 1.3-4.5 3.7-7z"
        fill="#ffffff"
      />
      <text
        x="36"
        y="16"
        textAnchor="middle"
        fontSize="9"
        fontFamily="Arial Black, Arial, sans-serif"
        fill="#ffffff"
      >
        ГПБ
      </text>
    </svg>
  );
};

const BankBadge = ({
  label,
  bankKey,
}: {
  label: string;
  bankKey: BankKey;
}) => (
  <span className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-medium text-white/80">
    <BankLogo bankKey={bankKey} />
    <span className="whitespace-nowrap">{label}</span>
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
  const [paymentConfirmationUrl, setPaymentConfirmationUrl] = useState<string | null>(null);
  const [paymentStageError, setPaymentStageError] = useState<string | null>(null);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [sbpQrSvg, setSbpQrSvg] = useState<string | null>(null);
  const [sbpQrError, setSbpQrError] = useState<string | null>(null);
  const [submitLock, setSubmitLock] = useState(false);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [lastManualDraftAt, setLastManualDraftAt] = useState<string | null>(null);
  const [promoCodeInput, setPromoCodeInput] = useState("");
  const [promoApplied, setPromoApplied] = useState<AppliedPromo | null>(null);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [promoLoading, setPromoLoading] = useState(false);
  const promoValidationRef = useRef("");
  const checkoutRequestIdRef = useRef<string | null>(null);
  const checkoutRequestSignatureRef = useRef<string>("");
  const paymentsMode = normalizePaymentsMode(process.env.NEXT_PUBLIC_PAYMENTS_MODE || "mock");
  const isPaymentsMock = paymentsMode === "mock";
  const isStripeMode = paymentsMode === "stripe";
  const isYookassaMode = paymentsMode === "yookassa";
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    city: "",
    address: "",
    shippingMethod: shippingMethodOptions[0].value,
    zipCode: "",
  });
  const [legalConsent, setLegalConsent] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{
    name?: string;
    email?: string;
    phone?: string;
    city?: string;
    address?: string;
    zipCode?: string;
    shippingMethod?: string;
    paymentMethod?: string;
    consent?: string;
  }>({});
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const shippingMethodRef = useRef<HTMLDivElement>(null);
  const cityRef = useRef<HTMLInputElement>(null);
  const addressRef = useRef<HTMLTextAreaElement>(null);
  const zipCodeRef = useRef<HTMLInputElement>(null);
  const paymentMethodRef = useRef<HTMLDivElement>(null);
  const consentRef = useRef<HTMLInputElement>(null);
  const apiBase = "";
  const cartStorageKey = useMemo(
    () => getCartStorageKey(userReady ? userId : null),
    [userId, userReady]
  );
  const checkoutDraftKey = useMemo(
    () => getCheckoutDraftKey(userReady ? userId : null),
    [userId, userReady]
  );

  const clearPurchasedFromCartStorage = useCallback(
    (purchasedItems: CartItem[]) => {
      if (typeof window === "undefined") {
        return;
      }

      const purchasedIds = new Set(purchasedItems.map((item) => item.id));
      const parsed = readCartStorage(cartStorageKey, { migrateLegacy: true });
      const normalized = parsed
        .map((item) => normalizeStoredItem(item))
        .filter((item): item is CartItem => Boolean(item));
      const remaining = normalized.filter((item) => !purchasedIds.has(item.id));

      if (remaining.length > 0) {
        writeCartStorage(cartStorageKey, remaining);
      } else {
        removeCartStorage(cartStorageKey);
      }

      clearCheckoutSelection(cartStorageKey);
    },
    [cartStorageKey]
  );

  const logCheckoutEvent = useCallback(
    (event: string, data?: Record<string, unknown>) => {
      if (typeof window === "undefined") {
        return;
      }
      const entry = {
        ts: new Date().toISOString(),
        event,
        data: data ?? {},
      };
      const existing = safeJsonParse(localStorage.getItem(CHECKOUT_LOG_KEY) || "");
      const list = Array.isArray(existing) ? existing : [];
      list.push(entry);
      const trimmed = list.slice(-CHECKOUT_LOG_MAX);
      localStorage.setItem(CHECKOUT_LOG_KEY, JSON.stringify(trimmed));
      if (checkoutDebug) {
        console.debug("[checkout]", entry);
      }
    },
    []
  );

  const clearCheckoutDraft = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }
    localStorage.removeItem(checkoutDraftKey);
    logCheckoutEvent("draft:clear");
  }, [checkoutDraftKey, logCheckoutEvent]);

  const ensureCheckoutRequestId = useCallback((payload: Record<string, any>) => {
    const signature = buildCheckoutPayloadSignature(payload);
    if (
      checkoutRequestIdRef.current &&
      checkoutRequestSignatureRef.current === signature
    ) {
      return checkoutRequestIdRef.current;
    }
    const nextId = createCheckoutRequestId();
    checkoutRequestIdRef.current = nextId;
    checkoutRequestSignatureRef.current = signature;
    return nextId;
  }, []);

  const resetCheckoutRequestId = useCallback(() => {
    checkoutRequestIdRef.current = null;
    checkoutRequestSignatureRef.current = "";
  }, []);
  
  // Always use the Next.js API route, not direct backend URL
  const ordersApiUrl = "/api/create-order";
  const promoValidateUrl = "/api/promocodes/validate";
  const paymentsIntentUrl = "/api/payments/create-intent";
  const paymentsConfirmUrl = "/api/payments/confirm";
  const isProcessing = step === "processing";
  const checkoutCtaLabel = "Подтвердить и оплатить";

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

    const selectedIds = readCheckoutSelection(cartStorageKey);
    if (selectedIds.length > 0) {
      const selectedSet = new Set(selectedIds);
      const filtered = normalized.filter((item) => selectedSet.has(item.id));
      if (filtered.length > 0) {
        setCartItems(filtered);
      } else {
        clearCheckoutSelection(cartStorageKey);
        setCartItems(normalized);
      }
    } else {
      setCartItems(normalized);
    }
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
              name: prev.name || user.name || prev.name,
              email: prev.email || user.email || prev.email,
              phone:
                prev.phone ||
                (typeof user.phone === "string" ? user.phone : prev.phone),
              address: prev.address || user.shippingAddress || prev.address,
            }));
          }
        })
        .catch(() => {});
    }
  }, [apiBase, userId]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (!userReady || !cartReady || draftLoaded) {
      return;
    }
    const stored = safeJsonParse(localStorage.getItem(checkoutDraftKey) || "");
    if (!stored || typeof stored !== "object") {
      setDraftLoaded(true);
      return;
    }
    const draftForm =
      stored.form && typeof stored.form === "object" ? stored.form : stored;

    setForm((prev) => ({
      ...prev,
      name: typeof draftForm.name === "string" ? draftForm.name : prev.name,
      email: typeof draftForm.email === "string" ? draftForm.email : prev.email,
      phone: typeof draftForm.phone === "string" ? draftForm.phone : prev.phone,
      city: typeof draftForm.city === "string" ? draftForm.city : prev.city,
      address: typeof draftForm.address === "string" ? draftForm.address : prev.address,
      shippingMethod: shippingMethodSet.has(draftForm.shippingMethod)
        ? draftForm.shippingMethod
        : prev.shippingMethod,
      zipCode: typeof draftForm.zipCode === "string" ? draftForm.zipCode : prev.zipCode,
    }));
    if (typeof stored.legalConsent === "boolean") {
      setLegalConsent(stored.legalConsent);
    }

    if (typeof stored.paymentMethod === "string") {
      const nextMethod =
        paymentOptions.find((option) => option.value === stored.paymentMethod)?.value ??
        null;
      if (nextMethod) {
        setPaymentMethod(nextMethod);
      }
    }
    if (typeof stored.promoCodeInput === "string") {
      setPromoCodeInput(stored.promoCodeInput.toUpperCase());
    }

    logCheckoutEvent("draft:load", {
      hasForm: Boolean(draftForm),
      hasPaymentMethod: typeof stored.paymentMethod === "string",
      hasPromoCode: typeof stored.promoCodeInput === "string",
      hasLegalConsent: typeof stored.legalConsent === "boolean",
    });
    setDraftLoaded(true);
  }, [cartReady, checkoutDraftKey, draftLoaded, logCheckoutEvent, userReady]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (!draftLoaded || !cartReady || step !== "form") {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      const payload = {
        form,
        paymentMethod,
        promoCodeInput,
        legalConsent,
        savedAt: new Date().toISOString(),
      };
      localStorage.setItem(checkoutDraftKey, JSON.stringify(payload));
      logCheckoutEvent("draft:save", {
        paymentMethod,
        city: form.city,
        shippingMethod: form.shippingMethod,
        hasPromoCode: promoCodeInput.trim().length > 0,
        legalConsent,
      });
    }, DRAFT_SAVE_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    cartReady,
    checkoutDraftKey,
    draftLoaded,
    form,
    logCheckoutEvent,
    paymentMethod,
    promoCodeInput,
    legalConsent,
    step,
  ]);

  useEffect(() => {
    if (!cartReady) {
      return;
    }
    if (cartItems.length === 0) {
      clearCheckoutDraft();
    }
  }, [cartItems.length, cartReady, clearCheckoutDraft]);

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

  const cartPricingSignature = useMemo(
    () =>
      cartItems
        .map((item) => `${item.id}:${item.quantity}:${item.priceValue}:${item.formatKey}`)
        .join("|"),
    [cartItems]
  );

  const validateAndApplyPromo = useCallback(
    async (rawCode?: string) => {
      const nextCode = (rawCode ?? promoCodeInput).trim().toUpperCase();
      if (!nextCode) {
        setPromoError("Введите промокод.");
        setPromoApplied(null);
        promoValidationRef.current = "";
        return false;
      }

      setPromoLoading(true);
      setPromoError(null);

      try {
        const response = await fetch(promoValidateUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include",
          body: JSON.stringify({
            code: nextCode,
            items: cartItems.map((item) => ({
              formatKey: item.formatKey,
              quantity: item.quantity,
              priceValue: item.priceValue,
            })),
          }),
        });

        const result = await response.json().catch(() => null);
        if (!response.ok || !result?.valid) {
          const message = result?.error || result?.message || "Промокод не применен.";
          setPromoApplied(null);
          setPromoError(message);
          promoValidationRef.current = "";
          return false;
        }

        setPromoCodeInput(nextCode);
        setPromoApplied({
          code: result.code || nextCode,
          discountAmount:
            typeof result.discountAmount === "number" && result.discountAmount > 0
              ? result.discountAmount
              : 0,
          description: typeof result.description === "string" ? result.description : undefined,
        });
        promoValidationRef.current = `${nextCode}|${cartPricingSignature}`;
        setPromoError(null);
        return true;
      } catch {
        setPromoApplied(null);
        setPromoError("Не удалось проверить промокод. Попробуйте еще раз.");
        promoValidationRef.current = "";
        return false;
      } finally {
        setPromoLoading(false);
      }
    },
    [cartItems, cartPricingSignature, promoCodeInput, promoValidateUrl]
  );

  const clearPromo = useCallback(() => {
    setPromoApplied(null);
    setPromoError(null);
    setPromoCodeInput("");
    promoValidationRef.current = "";
  }, []);

  const handlePromoInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const nextValue = event.target.value.toUpperCase();
      setPromoCodeInput(nextValue);
      if (promoError) {
        setPromoError(null);
      }
      if (promoApplied && nextValue.trim() !== promoApplied.code) {
        setPromoApplied(null);
        promoValidationRef.current = "";
      }
    },
    [promoApplied, promoError]
  );

  const handleApplyPromo = useCallback(async () => {
    await validateAndApplyPromo();
  }, [validateAndApplyPromo]);

  useEffect(() => {
    if (!cartReady || !promoApplied?.code) {
      return;
    }

    const syncKey = `${promoApplied.code}|${cartPricingSignature}`;
    if (promoValidationRef.current === syncKey) {
      return;
    }

    void validateAndApplyPromo(promoApplied.code);
  }, [cartPricingSignature, cartReady, promoApplied?.code, validateAndApplyPromo]);

  useEffect(() => {
    if (!cartReady) {
      return;
    }
    if (cartItems.length === 0) {
      clearPromo();
    }
  }, [cartItems.length, cartReady, clearPromo]);

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
  const promoDiscount = useMemo(() => {
    const raw = typeof promoApplied?.discountAmount === "number" ? promoApplied.discountAmount : 0;
    const safe = Math.max(0, raw);
    return Math.min(safe, totalValue);
  }, [promoApplied?.discountAmount, totalValue]);
  const discountedSubtotal = useMemo(
    () => Math.max(0, totalValue - promoDiscount),
    [promoDiscount, totalValue]
  );
  const deliveryCost = useMemo(
    () => (hasPhysical ? resolveDeliveryCost(form.shippingMethod) : 0),
    [hasPhysical, form.shippingMethod]
  );
  const selectedDeliveryOption = useMemo(
    () => deliveryOptions.find((option) => option.id === form.shippingMethod) ?? null,
    [form.shippingMethod]
  );
  const grandTotal = useMemo(
    () => discountedSubtotal + deliveryCost,
    [deliveryCost, discountedSubtotal]
  );
  const lastManualDraftTimeLabel = useMemo(() => {
    if (!lastManualDraftAt) return null;
    const date = new Date(lastManualDraftAt);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleTimeString("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }, [lastManualDraftAt]);
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
  const isConfirmStep = step !== "form";
  const isAwaitingOrderCreation = isPaymentsMock && !pendingOrderId;
  const deliveryReady = useMemo(() => {
    if (!hasPhysical) return true;
    return Boolean(
      form.shippingMethod &&
        form.city.trim() &&
        normalizeAddressInput(form.address)
    );
  }, [form.address, form.city, form.shippingMethod, hasPhysical]);
  const stepperSteps = useMemo(
    () => [
      {
        id: 1,
        title: "Доставка",
        description: "Контакты и адрес",
        completed: deliveryReady,
        current: step === "form",
      },
      {
        id: 2,
        title: "Оплата",
        description: "Способ оплаты",
        completed: Boolean(paymentMethod) || isConfirmStep,
        current: false,
      },
      {
        id: 3,
        title: "Подтверждение",
        description: "Финальная проверка",
        completed: false,
        current: isConfirmStep,
      },
    ],
    [deliveryReady, isConfirmStep, paymentMethod, step]
  );

  const getFormErrors = useCallback(() => {
    const errors: typeof fieldErrors = {};
    let submitError: string | null = null;
    let firstErrorField: keyof typeof fieldErrors | null = null;

    const name = form.name.trim();
    const email = form.email.trim();
    const phone = form.phone.trim();
    const city = form.city.trim();
    const address = normalizeAddressInput(form.address);
    const zipCode = form.zipCode.trim();

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

    if (!EMAIL_REGEX.test(email.toLowerCase())) {
      submitError = "Проверьте email.";
      errors.email = "Некорректный email.";
      firstErrorField = "email";
      return { errors, submitError, firstErrorField, isValid: false };
    }

    if (phone && !PHONE_REGEX.test(phone)) {
      submitError = "Проверьте телефон. Допустимы цифры, +, пробел, скобки и дефис.";
      errors.phone = "Некорректный формат телефона.";
      firstErrorField = "phone";
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
      if (!shippingMethodSet.has(form.shippingMethod)) {
        submitError = "Выберите корректную службу доставки.";
        errors.shippingMethod = "Выберите службу доставки.";
        firstErrorField = "shippingMethod";
        return { errors, submitError, firstErrorField, isValid: false };
      }
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
      if (zipCode && !ZIP_CODE_REGEX.test(zipCode)) {
        submitError = "Почтовый индекс должен содержать только цифры (4-10).";
        errors.zipCode = "Используйте 4-10 цифр.";
        firstErrorField = "zipCode";
        return { errors, submitError, firstErrorField, isValid: false };
      }
    }

    if (hasDigital && !hasPhysical && paymentMethod !== "card") {
      submitError = "Для цифровых товаров доступна только оплата картой.";
      errors.paymentMethod = "Для цифровых товаров выберите оплату картой.";
      firstErrorField = "paymentMethod";
      return { errors, submitError, firstErrorField, isValid: false };
    }

    if (!paymentMethodSet.has(paymentMethod)) {
      submitError = "Выберите корректный способ оплаты.";
      errors.paymentMethod = "Выберите способ оплаты.";
      firstErrorField = "paymentMethod";
      return { errors, submitError, firstErrorField, isValid: false };
    }

    if (!legalConsent) {
      submitError = "Подтвердите согласие с условиями оформления заказа.";
      errors.consent = "Требуется согласие.";
      firstErrorField = "consent";
      return { errors, submitError, firstErrorField, isValid: false };
    }

    return { errors, submitError, firstErrorField, isValid: true };
  }, [form, hasDigital, hasPhysical, legalConsent, paymentMethod]);

  const canCheckout =
    cartItems.length > 0 &&
    step === "form" &&
    !submitLock &&
    !promoLoading &&
    legalConsent;

  const handleSaveDraftRecord = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }
    const savedAt = new Date().toISOString();
    const draftPayload = {
      form,
      paymentMethod,
      promoCodeInput,
      legalConsent,
      savedAt,
    };
    window.localStorage.setItem(checkoutDraftKey, JSON.stringify(draftPayload));
    saveCheckoutDraftRecord(userReady ? userId : null, {
      form,
      paymentMethod,
      promoCodeInput,
      legalConsent,
      selectedItemIds: cartItems.map((item) => item.id),
      itemCount: cartItems.reduce((sum, item) => sum + item.quantity, 0),
      subtotal: totalValue,
      itemNames: cartItems.map((item) => item.name),
    });
    setLastManualDraftAt(savedAt);
    logCheckoutEvent("draft:manual-save", {
      itemCount: cartItems.length,
      subtotal: totalValue,
      hasPromoCode: promoCodeInput.trim().length > 0,
      legalConsent,
    });
  }, [
    cartItems,
    checkoutDraftKey,
    form,
    logCheckoutEvent,
    paymentMethod,
    promoCodeInput,
    legalConsent,
    totalValue,
    userId,
    userReady,
  ]);

  const focusField = useCallback((field: keyof typeof fieldErrors) => {
    const ref =
      field === "name"
        ? nameRef
        : field === "email"
          ? emailRef
          : field === "phone"
            ? phoneRef
            : field === "shippingMethod"
              ? shippingMethodRef
              : field === "paymentMethod"
                ? paymentMethodRef
          : field === "city"
            ? cityRef
            : field === "zipCode"
              ? zipCodeRef
            : field === "consent"
              ? consentRef
            : addressRef;
    ref.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    ref.current?.focus?.();
  }, []);

  const handleInputChange = (field: keyof typeof form) => (
    event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const rawValue = event.target.value;
    const nextValue =
      field === "zipCode" ? rawValue.replace(/\D+/g, "").slice(0, 10) : rawValue;
    setForm((prev) => ({ ...prev, [field]: nextValue }));
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

  const handleShippingMethodSelect = useCallback(
    (id: string) => {
      setForm((prev) => ({
        ...prev,
        shippingMethod: id,
      }));
      if (submitError) {
        setSubmitError(null);
      }
      setFieldErrors((prev) =>
        prev.shippingMethod ? { ...prev, shippingMethod: undefined } : prev
      );
    },
    [submitError]
  );

  const handlePaymentMethodChange = useCallback(
    (value: string) => {
      setPaymentMethod(value);
      if (submitError) {
        setSubmitError(null);
      }
      setFieldErrors((prev) =>
        prev.paymentMethod ? { ...prev, paymentMethod: undefined } : prev
      );
    },
    [submitError]
  );

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
    if (paymentsMode !== "stripe" && paymentsMode !== "yookassa") return;
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
      if (typeof paymentData?.confirmationUrl === "string" && paymentData.confirmationUrl) {
        setPaymentConfirmationUrl(paymentData.confirmationUrl);
      }
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
      logCheckoutEvent("order:create:start", {
        items: Array.isArray(payload?.items) ? payload.items.length : 0,
        total: payload?.total,
      });
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error("Request timeout: Order creation took too long.")),
          120000
        );
      });

      const checkoutRequestId =
        typeof payload?.checkoutRequestId === "string"
          ? payload.checkoutRequestId.trim()
          : "";
      const requestHeaders: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (checkoutRequestId) {
        requestHeaders["x-idempotency-key"] = checkoutRequestId;
      }

      const response = (await Promise.race([
        fetch(ordersApiUrl, {
          method: "POST",
          headers: requestHeaders,
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
        logCheckoutEvent("order:create:error", {
          message: errorMessage,
        });
        throw new Error(errorMessage);
      }

      const responseData = await response.json();
      const createdOrderId = responseData?.doc?.id || responseData?.id || null;
      let paymentStatus = String(
        responseData?.doc?.paymentStatus || responseData?.paymentStatus || "paid"
      );
      let nextIntentId: string | null = null;
      let nextClientSecret: string | null = null;
      let nextConfirmationUrl: string | null = null;
      let paymentIntentError: string | null = null;
      const shouldRequestPayment =
        Boolean(createdOrderId) &&
        paymentMethod === "card" &&
        (paymentsMode === "stripe" || paymentsMode === "yookassa");
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
          nextConfirmationUrl =
            typeof paymentData?.confirmationUrl === "string"
              ? paymentData.confirmationUrl
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

      logCheckoutEvent("order:create:success", {
        orderId: createdOrderId,
        paymentStatus,
        paymentMode: paymentsMode,
      });

      return {
        createdOrderId,
        paymentStatus,
        nextIntentId,
        nextClientSecret,
        nextConfirmationUrl,
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
        logCheckoutEvent("payment:simulate:start", { status });
        let orderId = pendingOrderId;
        if (!orderId && pendingOrderPayload) {
          const { createdOrderId } = await createOrder(pendingOrderPayload);
          if (!createdOrderId) {
            throw new Error("Не удалось создать заказ.");
          }
          orderId = createdOrderId;
          setPendingOrderId(createdOrderId);
          resetCheckoutRequestId();
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
          clearPurchasedFromCartStorage(cartItems);
          clearCheckoutDraft();
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
        logCheckoutEvent("payment:simulate:error", {
          message: error instanceof Error ? error.message : "Не удалось обновить статус оплаты.",
        });
      } finally {
        setPaymentLoading(false);
      }
    },
    [
      cartItems,
      clearCheckoutDraft,
      clearPurchasedFromCartStorage,
      createOrder,
      logCheckoutEvent,
      pendingOrderId,
      pendingOrderPayload,
      paymentsConfirmUrl,
      resetCheckoutRequestId,
      router,
    ]
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
      logCheckoutEvent("form:invalid", { firstErrorField });
      return;
    }

    const name = form.name.trim();
    const email = form.email.trim();
    const phone = form.phone.trim();
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
    logCheckoutEvent("checkout:submit");

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
          color?: string;
          quality?: string;
          note?: string;
          packaging?: string;
          isHollow?: boolean;
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
              color: item.customPrint.color,
              quality: item.customPrint.quality,
              note: item.customPrint.note,
              packaging: item.customPrint.packaging,
              isHollow: item.customPrint.isHollow,
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
          phone: phone || undefined,
        },
      };
      if (promoApplied?.code) {
        payload.promoCode = promoApplied.code;
      }

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
      payload.checkoutRequestId = ensureCheckoutRequestId(payload);

      const isMockPayment = isPaymentsMock;
      if (isMockPayment) {
        setPendingOrderPayload(payload);
        setPendingOrderId(null);
        setPaymentIntentId(null);
        setPaymentClientSecret(null);
        setPaymentConfirmationUrl(null);
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
        nextConfirmationUrl,
        paymentIntentError,
      } = await createOrder(payload);

      if (!createdOrderId) {
        throw new Error("Не удалось создать заказ.");
      }
      resetCheckoutRequestId();

      clearPurchasedFromCartStorage(cartItems);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("orders-updated"));
      }
      clearCheckoutDraft();
      setCartItems([]);
      
      if (paymentStatus === "pending" && createdOrderId) {
        setPendingOrderId(createdOrderId);
        setPaymentIntentId(nextIntentId);
        setPaymentClientSecret(nextClientSecret);
        setPaymentConfirmationUrl(nextConfirmationUrl);
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
      logCheckoutEvent("checkout:error", { message });
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
      logCheckoutEvent("payment:mock:start");
      const { createdOrderId } = await createOrder(pendingOrderPayload);
      if (!createdOrderId) {
        throw new Error("Не удалось создать заказ.");
      }

      setPendingOrderId(createdOrderId);
      resetCheckoutRequestId();

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

      clearPurchasedFromCartStorage(cartItems);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("orders-updated"));
      }
      clearCheckoutDraft();
      setCartItems([]);
      setPendingOrderPayload(null);
      router.push(`/checkout/success?orderId=${encodeURIComponent(createdOrderId)}`);
    } catch (error) {
      setPaymentStageError(
        error instanceof Error ? error.message : "Не удалось завершить оплату."
      );
      logCheckoutEvent("payment:mock:error", {
        message: error instanceof Error ? error.message : "Не удалось завершить оплату.",
      });
    } finally {
      setPaymentLoading(false);
    }
  }, [
    cartItems,
    clearCheckoutDraft,
    clearPurchasedFromCartStorage,
    createOrder,
    logCheckoutEvent,
    pendingOrderPayload,
    paymentsConfirmUrl,
    resetCheckoutRequestId,
    router,
  ]);

  return (
    <div className="min-h-screen bg-[#050505] text-white">
      <div className="pointer-events-none fixed inset-0 cad-grid-pattern opacity-40" />
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute -left-40 top-[-20%] h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle,rgba(46,209,255,0.2),transparent_70%)] blur-2xl" />
        <div className="absolute right-[-15%] top-10 h-[420px] w-[420px] rounded-full bg-[radial-gradient(circle,rgba(212,175,55,0.16),transparent_70%)] blur-2xl" />
      </div>

      <header className="fixed inset-x-0 top-0 z-40 border-b border-white/10 bg-[#04080d]/90 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1280px] items-center justify-between px-4 sm:px-6">
          <p className="text-xs font-[var(--font-jetbrains-mono)] uppercase tracking-[0.28em] text-white/50">
            3D STORE | Checkout
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {step === "form" && (
              <button
                type="button"
                onClick={handleSaveDraftRecord}
                className="flex items-center gap-2 rounded-full border border-[#2ED1FF]/40 bg-[#2ED1FF]/10 px-3 py-1.5 text-[10px] uppercase tracking-[0.25em] text-[#BFF4FF] transition hover:border-[#2ED1FF]/70 hover:bg-[#2ED1FF]/20 hover:text-white"
              >
                <Save className="h-3.5 w-3.5" />
                {lastManualDraftTimeLabel
                  ? `Сохранено ${lastManualDraftTimeLabel}`
                  : "Сохранить черновик"}
              </button>
            )}
            <Link
              href="/store"
              className="rounded-full border border-white/10 px-3 py-1.5 text-[10px] uppercase tracking-[0.25em] text-white/70 transition hover:text-white"
            >
              Назад в магазин
            </Link>
          </div>
        </div>
      </header>

      <div className="relative z-10 mx-auto max-w-[1280px] px-4 pb-24 pt-20 sm:px-6">
        <div className="sticky top-16 z-30 -mx-4 border-b border-white/10 bg-[#04080d]/90 backdrop-blur-xl sm:-mx-6">
          <div className="mx-auto max-w-[1280px] px-4 py-3 sm:px-6">
            <CheckoutStepper steps={stepperSteps} variant="compact" />
          </div>
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
              className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]"
            >
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
                  <div className="space-y-2">
                    <label className="text-xs uppercase tracking-[0.3em] text-white/50">
                      Телефон
                    </label>
                    <input
                      type="tel"
                      ref={phoneRef}
                      value={form.phone}
                      onChange={handleInputChange("phone")}
                      placeholder="+7 (___) ___-__-__"
                      aria-invalid={Boolean(fieldErrors.phone)}
                      aria-describedby={fieldErrors.phone ? "checkout-phone-error" : undefined}
                      className={`w-full rounded-2xl border bg-white/5 px-4 py-3 text-sm text-white outline-none transition focus:border-[#2ED1FF]/60 ${
                        fieldErrors.phone
                          ? "border-rose-400/60 ring-1 ring-rose-400/40"
                          : "border-white/10"
                      }`}
                    />
                    {fieldErrors.phone && (
                      <p id="checkout-phone-error" className="text-xs text-rose-300">
                        {fieldErrors.phone}
                      </p>
                    )}
                  </div>
                </div>

                {hasPhysical && (
                  <div className="space-y-4 rounded-[22px] border border-white/10 bg-white/[0.03] p-5">
                    <p className="text-xs uppercase tracking-[0.3em] text-white/50">
                      {shippingLabels.sectionTitle}
                    </p>
                    <div ref={shippingMethodRef} tabIndex={-1} className="space-y-3 outline-none">
                      <p className="text-sm text-white/70">Выберите службу доставки</p>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {deliveryOptions.map((option) => (
                          <DeliveryCard
                            key={option.id}
                            option={option}
                            selected={form.shippingMethod === option.id}
                            onSelect={handleShippingMethodSelect}
                          />
                        ))}
                      </div>
                      {fieldErrors.shippingMethod && (
                        <p className="text-xs text-rose-300">{fieldErrors.shippingMethod}</p>
                      )}
                    </div>
                    {selectedDeliveryOption && (
                      <p className="rounded-2xl border border-[#2ED1FF]/30 bg-[#2ED1FF]/10 px-4 py-3 text-sm text-[#BFF4FF]">
                        {`Срок доставки: ${selectedDeliveryOption.estimatedTime} • Стоимость: ${formatPrice(deliveryCost)} ₽`}
                      </p>
                    )}
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
                        placeholder="Например, Омск"
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
                        placeholder="Например, Суханова 1, кв. 12"
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
                        <span>Почтовый индекс</span>
                        <span className="text-[10px] tracking-[0.25em] text-white/40">
                          {shippingLabels.zipHelper}
                        </span>
                      </label>
                      <input
                        ref={zipCodeRef}
                        type="text"
                        inputMode="numeric"
                        value={form.zipCode}
                        onChange={handleInputChange("zipCode")}
                        placeholder="Например, 644000"
                        aria-invalid={Boolean(fieldErrors.zipCode)}
                        aria-describedby={fieldErrors.zipCode ? "checkout-zip-error" : undefined}
                        className={`w-full rounded-2xl border bg-white/5 px-4 py-3 text-sm text-white outline-none transition focus:border-[#2ED1FF]/60 ${
                          fieldErrors.zipCode
                            ? "border-rose-400/60 ring-1 ring-rose-400/40"
                            : "border-white/10"
                        }`}
                      />
                      {fieldErrors.zipCode && (
                        <p id="checkout-zip-error" className="text-xs text-rose-300">
                          {fieldErrors.zipCode}
                        </p>
                      )}
                      <p className="text-xs text-white/45">
                        Необязательно, но помогает точнее рассчитать доставку.
                      </p>
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
                  <p className="text-xs uppercase tracking-[0.3em] text-white/50">Промокод</p>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      type="text"
                      value={promoCodeInput}
                      onChange={handlePromoInputChange}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void handleApplyPromo();
                        }
                      }}
                      placeholder={
                        promoPlaceholderExample
                          ? `Например, ${promoPlaceholderExample}`
                          : "Введите промокод"
                      }
                      className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm uppercase tracking-[0.08em] text-white outline-none transition focus:border-[#2ED1FF]/60"
                      maxLength={32}
                    />
                    <button
                      type="button"
                      onClick={handleApplyPromo}
                      disabled={promoLoading || cartItems.length === 0}
                      className="rounded-2xl border border-[#2ED1FF]/50 bg-[#0b1014] px-5 py-3 text-xs uppercase tracking-[0.3em] text-[#BFF4FF] transition hover:border-[#7FE7FF] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {promoLoading ? "Проверка..." : "Применить"}
                    </button>
                  </div>
                  {promoApplied && (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
                      <div>
                        <p className="text-xs uppercase tracking-[0.22em] text-emerald-200/80">
                          {showAppliedPromoCode
                            ? `Промокод активен: ${promoApplied.code}`
                            : "Промокод применен"}
                        </p>
                        <p className="mt-1 text-sm">
                          Скидка: -{formatPrice(promoDiscount)} ₽
                        </p>
                        {promoApplied.description && (
                          <p className="mt-1 text-xs text-emerald-100/70">
                            {promoApplied.description}
                          </p>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={clearPromo}
                        className="rounded-full border border-emerald-300/50 px-3 py-1 text-[10px] uppercase tracking-[0.28em] text-emerald-100 transition hover:border-emerald-100"
                      >
                        Убрать
                      </button>
                    </div>
                  )}
                  {promoError && <p className="text-xs text-rose-300">{promoError}</p>}
                </div>
                <div className="space-y-3 rounded-[22px] border border-white/10 bg-white/[0.03] p-5">
                  <p className="text-xs uppercase tracking-[0.3em] text-white/50">Оплата</p>
                  <div
                    ref={paymentMethodRef}
                    tabIndex={-1}
                    className="grid gap-2 outline-none sm:grid-cols-2"
                  >
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
                          onChange={() => handlePaymentMethodChange(option.value)}
                        />
                        {option.label}
                      </label>
                    ))}
                  </div>
                  {fieldErrors.paymentMethod && (
                    <p className="text-xs text-rose-300">{fieldErrors.paymentMethod}</p>
                  )}
                  {hasDigital && !hasPhysical && (
                    <p className="text-xs text-white/50">
                      Для цифровых файлов доступна только оплата картой.
                    </p>
                  )}
                </div>
                <div className="space-y-2 rounded-[22px] border border-white/10 bg-white/[0.03] p-5">
                  <label className="flex cursor-pointer items-start gap-3 text-sm text-white/75">
                    <input
                      ref={consentRef}
                      type="checkbox"
                      checked={legalConsent}
                      onChange={(event) => {
                        setLegalConsent(event.target.checked);
                        if (fieldErrors.consent) {
                          setFieldErrors((prev) => ({ ...prev, consent: undefined }));
                        }
                      }}
                      className="mt-0.5 h-4 w-4 rounded border-white/20 bg-white/5 accent-[#2ED1FF]"
                    />
                    <span>
                      Подтверждаю согласие с условиями покупки и обработкой персональных данных.
                    </span>
                  </label>
                  {fieldErrors.consent && (
                    <p className="text-xs text-rose-300">{fieldErrors.consent}</p>
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
                  items={cartItems.map((item) => {
                    const dims = item.customPrint?.dimensions;
                    const dimensionsLabel =
                      dims &&
                      typeof dims.x === "number" &&
                      typeof dims.y === "number" &&
                      typeof dims.z === "number"
                        ? `${dims.x.toFixed(1)} x ${dims.y.toFixed(1)} x ${dims.z.toFixed(1)} mm`
                        : undefined;
                    return {
                      id: item.id,
                      name: item.name,
                      formatLabel: item.formatLabel,
                      priceValue: item.priceValue,
                      quantity: item.quantity,
                      thumbnailUrl: item.thumbnailUrl,
                      printDetails: item.customPrint
                        ? {
                            technology: item.customPrint.technology,
                            material: item.customPrint.material,
                            color: item.customPrint.color,
                            quality: item.customPrint.quality,
                            dimensionsLabel,
                          }
                        : undefined,
                      editPrintUrl: item.customPrint ? buildPrintEditUrl(item) ?? undefined : undefined,
                    };
                  })}
                  subtotal={totalValue}
                  deliveryCost={deliveryCost}
                  discount={promoDiscount}
                  promoCode={showAppliedPromoCode ? promoApplied?.code : undefined}
                  total={grandTotal}
                  onCheckout={() => formRef.current?.requestSubmit()}
                  canCheckout={canCheckout}
                  isProcessing={isProcessing}
                  ctaLabel={checkoutCtaLabel}
                />
                <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-xs text-white/60">
                  <p className="font-semibold uppercase tracking-[0.24em] text-white/55">
                    Заметки
                  </p>
                  <p className="mt-2">Безопасная оплата и шифрование платежных данных.</p>
                  <p className="mt-1">Подтверждая заказ, вы принимаете условия сервиса.</p>
                </div>
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
                          clearPurchasedFromCartStorage(cartItems);
                          setCartItems([]);
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
                                  onClick={() => handlePaymentMethodChange(option.value)}
                                  disabled={paymentLoading}
                                >
                                  {option.label}
                                </button>
                              ))}
                          </div>
                        </div>
                      ) : (
                        <p className="text-xs text-white/50">
                          Для цифровых файлов доступна только оплата картой. Настройте платежный
                          провайдер, чтобы продолжить.
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
                ) : isYookassaMode && paymentMethod === "card" ? (
                  <div className="mx-auto mt-6 w-full max-w-[480px] space-y-4 text-left">
                    <div className="rounded-2xl border border-white/10 bg-black/40 px-4 py-4">
                      <p className="text-xs uppercase tracking-[0.3em] text-white/50">
                        Оплата через YooKassa
                      </p>
                      <p className="mt-2 text-sm text-white/70">
                        Для оплаты откроется защищенная страница кассы.
                      </p>
                      <p className="mt-2 text-[11px] text-white/50">
                        Работает в тестовом режиме, пока не включим боевые ключи.
                      </p>
                    </div>

                    {paymentConfirmationUrl ? (
                      <a
                        href={paymentConfirmationUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex w-full items-center justify-center rounded-full bg-white px-6 py-3 text-xs font-semibold uppercase tracking-[0.3em] text-black shadow-[0_0_18px_rgba(46,209,255,0.35)] transition hover:bg-white/95"
                      >
                        Перейти к оплате
                      </a>
                    ) : (
                      <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                        Не удалось получить ссылку оплаты. Нажмите «Проверить статус» или
                        повторите создание платежа.
                      </div>
                    )}

                    <button
                      type="button"
                      className="w-full rounded-full border border-white/20 bg-white/5 px-5 py-2 text-[10px] uppercase tracking-[0.3em] text-white/70 transition hover:border-white/40 hover:text-white sm:text-xs"
                      onClick={handleRefreshPaymentIntent}
                      disabled={paymentLoading}
                    >
                      Проверить статус
                    </button>
                  </div>
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
                                  <BankBadge label="Сбер" bankKey="sber" />
                                  <BankBadge label="Тинькофф" bankKey="tinkoff" />
                                  <BankBadge label="Альфа" bankKey="alfa" />
                                  <BankBadge label="ВТБ" bankKey="vtb" />
                                  <BankBadge label="Газпромбанк" bankKey="gpb" />
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
                    {(isStripeMode || isYookassaMode) && (
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
