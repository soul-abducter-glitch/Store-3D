"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, Loader2, ShieldCheck } from "lucide-react";
import CheckoutStepper from "@/components/CheckoutStepper";
import DeliveryCard, { deliveryOptions } from "@/components/DeliveryCard";
import StickyOrderSummary from "@/components/StickyOrderSummary";

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

type CheckoutStep = "form" | "processing";

type CustomPrintMeta = {
  uploadId: string;
  uploadUrl?: string;
  uploadName?: string;
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

const citySuggestions = ["Москва", "Санкт-Петербург", "Новосибирск", "Екатеринбург", "Казань"];
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

const CheckoutPage = () => {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement | null>(null);
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [cartReady, setCartReady] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [step, setStep] = useState<CheckoutStep>("form");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState("card");
  const [submitLock, setSubmitLock] = useState(false);
  const [form, setForm] = useState({
    name: "",
    email: "",
    city: "",
    address: "",
    shippingMethod: shippingMethodOptions[0].value,
    zipCode: "",
  });
  const apiBase = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");
  
  // Always use the Next.js API route, not direct backend URL
  const ordersApiUrl = "/api/create-order";
  const isProcessing = step === "processing";

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const stored = window.localStorage.getItem("store3d_cart");
    if (!stored) {
      setCartReady(true);
      return;
    }

    try {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        const normalized = parsed
          .map((item) => normalizeStoredItem(item))
          .filter((item): item is CartItem => Boolean(item));
        setCartItems(normalized);
      }
    } catch {
      setCartItems([]);
    } finally {
      setCartReady(true);
    }
  }, []);

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
        
        console.log('=== Product Validation Debug ===');
        console.log('Cart items:', items.map(item => ({ id: item.id, productId: item.productId, name: item.name })));
        console.log('Valid product IDs from DB:', Array.from(validIds));
        
        const invalidProducts = items.filter(
          (item) => !validIds.has(resolveCartProductId(item))
        );
        console.log('Invalid products:', invalidProducts.map(item => ({ productId: item.productId, name: item.name })));
        console.log('=== End Debug ===');
        
        return { valid: invalidProducts.length === 0, invalidProducts };
      }
    } catch (error) {
      console.error("Product validation failed:", error);
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
  const stepperSteps = useMemo(
    () => [
      {
        id: 1,
        title: "Доставка",
        description: "Выберите службу",
        completed: !hasPhysical || Boolean(form.shippingMethod),
        current: hasPhysical,
      },
      {
        id: 2,
        title: "Оплата",
        description: "Метод оплаты",
        completed: Boolean(paymentMethod),
        current: !hasPhysical || Boolean(paymentMethod),
      },
    ],
    [hasPhysical, form.shippingMethod, paymentMethod]
  );

  const handleInputChange = (field: keyof typeof form) => (
    event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    setForm((prev) => ({ ...prev, [field]: event.target.value }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (step === "processing" || cartItems.length === 0 || submitLock) {
      return;
    }

    const name = form.name.trim();
    const email = form.email.trim();
    const city = form.city.trim();
    const address = form.address.trim();
    const zipCode = form.zipCode.trim();
    const shippingMethod = form.shippingMethod;

    if (!name || !email) {
      setSubmitError("Заполните имя и email.");
      return;
    }

    if (hasPhysical && (!city || !address)) {
      setSubmitError("Укажите город и адрес доставки.");
      return;
    }

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
        return;
      }

      setStep("processing");
      const items: Array<{
        product: string;
        format: "Physical" | "Digital";
        quantity: number;
        unitPrice: number;
        customerUpload?: string;
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
        console.log("Processing item:", item.name, "productId:", productId, "productIdStr:", productIdStr);
        
        if (!productIdStr) {
          setSubmitError("Ошибка: Товар не найден.");
          setStep("form");
          return;
        }

        const customerUpload = item.customPrint?.uploadId;
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
          printSpecs,
        });
      }
      
      console.log("Final items array for payload:", JSON.stringify(items, null, 2));

      const payload: Record<string, any> = {
        items,
        total: grandTotal,
        status: "paid",
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

      // Debug payload for validation
      console.log("=== Checkout Payload Debug ===");
      console.log("Payload structure:", JSON.stringify(payload, null, 2));
      console.log("Items array:", JSON.stringify(items, null, 2));
      console.log("Orders API URL:", ordersApiUrl);
      console.log("============================");

      // Add timeout to fetch request
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("Request timeout: Order creation took too long.")), 120000);
      });

      const response = await Promise.race([
        fetch(ordersApiUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include",
          body: JSON.stringify(payload),
        }),
        timeoutPromise,
      ]);

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        console.error("Order creation failed", response.status, errorText);
        
        // Try to parse as JSON for detailed error messages
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

      // Parse successful response
      const responseData = await response.json();
      const createdOrderId = responseData?.doc?.id || responseData?.id || null;
      
      if (typeof window !== "undefined") {
        window.localStorage.removeItem("store3d_cart");
        window.dispatchEvent(new CustomEvent("cart-updated"));
        window.dispatchEvent(new Event("orders-updated"));
      }
      setCartItems([]);
      
      // Redirect to success page with order ID
      const successUrl = createdOrderId 
        ? `/checkout/success?orderId=${encodeURIComponent(createdOrderId)}`
        : "/checkout/success";
      
      console.log("=== Redirecting to success page ===");
      console.log("Success URL:", successUrl);
      console.log("Created Order ID:", createdOrderId);
      
      router.push(successUrl);
    } catch (error) {
      console.error("=== Order submission error ===");
      console.error("Error details:", error);
      console.error("Error message:", error instanceof Error ? error.message : "Unknown error");
      console.error("==============================");
      
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Не удалось оформить заказ. Попробуйте ещё раз.";
      setSubmitError(message);
      setStep("form");
      setSubmitLock(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#050505] text-white">
      <div className="pointer-events-none fixed inset-0 cad-grid-pattern opacity-40" />
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute -left-40 top-[-20%] h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle,rgba(46,209,255,0.2),transparent_70%)] blur-2xl" />
        <div className="absolute right-[-15%] top-10 h-[420px] w-[420px] rounded-full bg-[radial-gradient(circle,rgba(212,175,55,0.16),transparent_70%)] blur-2xl" />
      </div>

      <div className="relative z-10 mx-auto max-w-[1200px] px-6 pb-24 pt-16">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-[var(--font-jetbrains-mono)] uppercase tracking-[0.3em] text-white/50">
            Checkout
            </p>
            <h1 className="mt-3 text-3xl font-semibold text-white">Оформление заказа</h1>
          </div>
          <Link
            href="/"
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
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.35 }}
              className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]"
            >
              <div className="lg:col-span-2">
                <CheckoutStepper steps={stepperSteps} />
              </div>
              <div className="space-y-6 rounded-[28px] border border-white/10 bg-white/[0.04] p-6 backdrop-blur-xl">
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
                      value={form.name}
                      onChange={handleInputChange("name")}
                      required
                      className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none transition focus:border-[#2ED1FF]/60"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs uppercase tracking-[0.3em] text-white/50">
                      Email
                    </label>
                    <input
                      type="email"
                      value={form.email}
                      onChange={handleInputChange("email")}
                      required
                      className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none transition focus:border-[#2ED1FF]/60"
                    />
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
                        value={form.city}
                        onChange={handleInputChange("city")}
                        required={hasPhysical}
                        autoComplete="address-level2"
                        className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none transition focus:border-[#2ED1FF]/60"
                      />
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
                        value={form.address}
                        onChange={handleInputChange("address")}
                        required={hasPhysical}
                        rows={3}
                        placeholder="Город, дом, квартира"
                        className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none transition focus:border-[#2ED1FF]/60"
                      />
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
                    {paymentOptions.map((option) => (
                      <label
                        key={option.value}
                        className={`flex items-center gap-3 rounded-2xl border px-4 py-3 text-sm transition ${
                          paymentMethod === option.value
                            ? "border-[#2ED1FF]/80 bg-[#0b1014] text-[#BFF4FF] shadow-[0_0_16px_rgba(46,209,255,0.3)]"
                            : "border-white/15 bg-white/5 text-white/75 hover:border-white/25 hover:bg-white/10"
                        }`}
                      >
                        <input
                          type="radio"
                          className="h-4 w-4 accent-[#2ED1FF]"
                          checked={paymentMethod === option.value}
                          onChange={() => setPaymentMethod(option.value)}
                        />
                        {option.label}
                      </label>
                    ))}
                  </div>
                </div>
                {submitError && (
                  <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                    {submitError}
                  </div>
                )}
              </div>

              <div>
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
                  isProcessing={isProcessing}
                />
                {!userId && (
                  <p className="mt-3 text-xs text-white/60">
                    Войдите, чтобы сохранить заказ.

                    <Link href="/profile" className="text-white underline underline-offset-4">
                      Перейти в профиль
                    </Link>
                  </p>
                )}
              </div>
            </motion.form>
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
