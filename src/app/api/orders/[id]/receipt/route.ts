import path from "path";
import { NextResponse, type NextRequest } from "next/server";
import { getPayload } from "payload";

import payloadConfig from "../../../../../../payload.config";
import { getOrderStatusLabel } from "@/lib/orderStatus";
import { getPaymentProviderLabel, getPaymentStatusLabel } from "@/lib/paymentStatus";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PdfPrinter = require("pdfmake");

const getPayloadClient = async () => getPayload({ config: payloadConfig });

const normalizeEmail = (value?: string) =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

const normalizeRelationshipId = (value: unknown): string | number | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") {
    const candidate =
      (value as { id?: unknown; value?: unknown; _id?: unknown }).id ??
      (value as { id?: unknown; value?: unknown; _id?: unknown }).value ??
      (value as { id?: unknown; value?: unknown; _id?: unknown })._id ??
      null;
    return normalizeRelationshipId(candidate);
  }
  const raw = String(value).trim();
  if (!raw) return null;
  const base = raw.split(":")[0].trim();
  if (!base || /\s/.test(base)) return null;
  if (/^\d+$/.test(base)) return Number(base);
  return base;
};

const escapeHtml = (value: unknown) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const formatDateTime = (value?: unknown) => {
  if (!value) return "";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "";
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${day}.${month}.${year} ${hours}:${minutes}`;
};

const formatMoney = (value: number) => {
  const safe = Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat("ru-RU").format(Math.round(safe * 100) / 100);
};

const getItemName = (item: any) => {
  const product = item?.product;
  if (product && typeof product === "object" && typeof product?.name === "string") {
    return product.name;
  }
  if (typeof product === "string" && product.trim()) return product.trim();
  return "Товар";
};

const getItemFormat = (format?: unknown) => {
  const raw = String(format || "").trim();
  if (raw === "Digital") return "Цифровой STL";
  if (raw === "Physical") return "Печатная модель";
  return raw || "Не указано";
};

const deliveryCostMap: Record<string, number> = {
  cdek: 200,
  yandex: 150,
  ozon: 100,
  pochta: 250,
  pickup: 0,
};

const resolveDeliveryCost = (order: any) => {
  const shippingMethod =
    typeof order?.shipping?.method === "string" ? order.shipping.method : "";
  return deliveryCostMap[shippingMethod] ?? 0;
};

const renderReceiptHtml = (args: {
  order: any;
  items: any[];
  subtotal: number;
  deliveryCost: number;
  total: number;
  autoPrint: boolean;
}) => {
  const { order, items, subtotal, deliveryCost, total, autoPrint } = args;
  const createdAt = formatDateTime(order?.createdAt || order?.updatedAt);
  const customerName = order?.customer?.name || "Покупатель";
  const customerEmail = order?.customer?.email || "—";
  const paymentStatusRaw =
    typeof order?.paymentStatus === "string" ? order.paymentStatus : "pending";
  const orderStatusRaw = typeof order?.status === "string" ? order.status : "accepted";
  const paymentProviderRaw =
    typeof order?.paymentProvider === "string" ? order.paymentProvider : "unknown";
  const paymentStatus = getPaymentStatusLabel(paymentStatusRaw);
  const orderStatus = getOrderStatusLabel(orderStatusRaw);
  const paymentProvider = getPaymentProviderLabel(paymentProviderRaw);
  const paymentIntentId = order?.paymentIntentId || "—";
  const isInternalCheckoutMarker =
    typeof paymentIntentId === "string" && paymentIntentId.startsWith("checkout:req:");

  const rows = items
    .map((item) => {
      const quantity =
        typeof item?.quantity === "number" && Number.isFinite(item.quantity) && item.quantity > 0
          ? item.quantity
          : 1;
      const unitPrice =
        typeof item?.unitPrice === "number" && Number.isFinite(item.unitPrice) && item.unitPrice >= 0
          ? item.unitPrice
          : 0;
      const lineTotal = quantity * unitPrice;
      return `
        <tr>
          <td>${escapeHtml(getItemName(item))}</td>
          <td>${escapeHtml(getItemFormat(item?.format))}</td>
          <td class="num">${quantity}</td>
          <td class="num">${formatMoney(unitPrice)} ₽</td>
          <td class="num">${formatMoney(lineTotal)} ₽</td>
        </tr>
      `;
    })
    .join("");

  return `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Чек заказа #${escapeHtml(order?.id)}</title>
    <style>
      :root { color-scheme: light; }
      body {
        margin: 0;
        padding: 24px;
        font-family: "Segoe UI", Arial, sans-serif;
        color: #111827;
        background: #f3f4f6;
      }
      .sheet {
        max-width: 860px;
        margin: 0 auto;
        background: #fff;
        border: 1px solid #e5e7eb;
        border-radius: 14px;
        padding: 24px;
      }
      h1 {
        margin: 0;
        font-size: 22px;
      }
      .meta {
        margin-top: 10px;
        color: #4b5563;
        font-size: 13px;
        line-height: 1.5;
      }
      .badges {
        margin-top: 14px;
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
      .badge {
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        border: 1px solid #d1d5db;
        border-radius: 999px;
        padding: 5px 10px;
        color: #374151;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 16px;
        font-size: 14px;
      }
      th, td {
        border-bottom: 1px solid #e5e7eb;
        padding: 10px 8px;
        text-align: left;
      }
      th {
        font-size: 12px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #6b7280;
      }
      .num {
        text-align: right;
        white-space: nowrap;
      }
      .totals {
        margin-top: 14px;
        margin-left: auto;
        width: 280px;
        font-size: 14px;
      }
      .totals-row {
        display: flex;
        justify-content: space-between;
        padding: 6px 0;
        border-bottom: 1px dashed #e5e7eb;
      }
      .totals-row:last-child {
        border-bottom: none;
        font-size: 18px;
        font-weight: 700;
        padding-top: 10px;
      }
      .hint {
        margin-top: 18px;
        color: #6b7280;
        font-size: 12px;
      }
      @media print {
        body {
          background: #fff;
          padding: 0;
        }
        .sheet {
          border: none;
          border-radius: 0;
          max-width: none;
          margin: 0;
          padding: 16mm;
        }
      }
    </style>
  </head>
  <body>
    <div class="sheet">
      <h1>Чек заказа #${escapeHtml(order?.id)}</h1>
      <div class="meta">
        <div>Дата: ${escapeHtml(createdAt || "—")}</div>
        <div>Покупатель: ${escapeHtml(customerName)} (${escapeHtml(customerEmail)})</div>
        <div>${
          isInternalCheckoutMarker ? "Идентификатор запроса" : "Payment intent"
        }: ${escapeHtml(paymentIntentId)}</div>
      </div>
      <div class="badges">
        <span class="badge">Статус заказа: ${escapeHtml(String(orderStatus))}</span>
        <span class="badge">Статус оплаты: ${escapeHtml(String(paymentStatus))}</span>
        <span class="badge">Провайдер: ${escapeHtml(String(paymentProvider))}</span>
      </div>
      <table>
        <thead>
          <tr>
            <th>Позиция</th>
            <th>Формат</th>
            <th class="num">Кол-во</th>
            <th class="num">Цена</th>
            <th class="num">Сумма</th>
          </tr>
        </thead>
        <tbody>
          ${rows || `<tr><td colspan="5">Нет позиций</td></tr>`}
        </tbody>
      </table>
      <div class="totals">
        <div class="totals-row"><span>Подытог</span><span>${formatMoney(subtotal)} ₽</span></div>
        <div class="totals-row"><span>Доставка</span><span>${formatMoney(deliveryCost)} ₽</span></div>
        <div class="totals-row"><span>Итого</span><span>${formatMoney(total)} ₽</span></div>
      </div>
      <div class="hint">Для сохранения в PDF: Печать → Сохранить как PDF.</div>
    </div>
    ${
      autoPrint
        ? `<script>window.addEventListener('load',()=>setTimeout(()=>window.print(),200));</script>`
        : ""
    }
  </body>
</html>`;
};

const createReceiptPdf = async (args: {
  order: any;
  items: any[];
  subtotal: number;
  deliveryCost: number;
  total: number;
}) => {
  const { order, items, subtotal, deliveryCost, total } = args;

  const fonts = {
    Roboto: {
      normal: path.join(process.cwd(), "node_modules", "pdfmake", "fonts", "Roboto", "Roboto-Regular.ttf"),
      bold: path.join(process.cwd(), "node_modules", "pdfmake", "fonts", "Roboto", "Roboto-Medium.ttf"),
      italics: path.join(process.cwd(), "node_modules", "pdfmake", "fonts", "Roboto", "Roboto-Italic.ttf"),
      bolditalics: path.join(
        process.cwd(),
        "node_modules",
        "pdfmake",
        "fonts",
        "Roboto",
        "Roboto-MediumItalic.ttf"
      ),
    },
  };

  const paymentStatusRaw =
    typeof order?.paymentStatus === "string" ? order.paymentStatus : "pending";
  const orderStatusRaw = typeof order?.status === "string" ? order.status : "accepted";
  const paymentProviderRaw =
    typeof order?.paymentProvider === "string" ? order.paymentProvider : "unknown";

  const paymentStatus = getPaymentStatusLabel(paymentStatusRaw);
  const orderStatus = getOrderStatusLabel(orderStatusRaw);
  const paymentProvider = getPaymentProviderLabel(paymentProviderRaw);

  const tableBody = [
    [
      { text: "Позиция", style: "tableHeader" },
      { text: "Формат", style: "tableHeader" },
      { text: "Кол-во", style: "tableHeader", alignment: "right" },
      { text: "Цена", style: "tableHeader", alignment: "right" },
      { text: "Сумма", style: "tableHeader", alignment: "right" },
    ],
    ...items.map((item) => {
      const quantity =
        typeof item?.quantity === "number" && Number.isFinite(item.quantity) && item.quantity > 0
          ? item.quantity
          : 1;
      const unitPrice =
        typeof item?.unitPrice === "number" && Number.isFinite(item.unitPrice) && item.unitPrice >= 0
          ? item.unitPrice
          : 0;
      const lineTotal = unitPrice * quantity;

      return [
        { text: getItemName(item) },
        { text: getItemFormat(item?.format) },
        { text: String(quantity), alignment: "right" },
        { text: `${formatMoney(unitPrice)} ₽`, alignment: "right" },
        { text: `${formatMoney(lineTotal)} ₽`, alignment: "right" },
      ];
    }),
  ];

  const docDefinition: any = {
    pageSize: "A4",
    pageMargins: [36, 36, 36, 36],
    defaultStyle: {
      font: "Roboto",
      fontSize: 10,
    },
    content: [
      { text: `Чек заказа #${String(order?.id || "")}`, style: "title" },
      {
        text: [
          `Дата: ${formatDateTime(order?.createdAt || order?.updatedAt) || "—"}\n`,
          `Покупатель: ${String(order?.customer?.name || "Покупатель")} (${String(
            order?.customer?.email || "—"
          )})\n`,
          `Статус заказа: ${orderStatus}\n`,
          `Статус оплаты: ${paymentStatus}\n`,
          `Провайдер: ${paymentProvider}\n`,
          `Payment intent: ${String(order?.paymentIntentId || "—")}`,
        ],
        margin: [0, 8, 0, 12],
      },
      {
        table: {
          headerRows: 1,
          widths: ["*", "auto", "auto", "auto", "auto"],
          body: tableBody,
        },
        layout: "lightHorizontalLines",
      },
      {
        margin: [0, 14, 0, 0],
        table: {
          widths: ["*", "auto"],
          body: [
            ["Подытог", `${formatMoney(subtotal)} ₽`],
            ["Доставка", `${formatMoney(deliveryCost)} ₽`],
            [{ text: "Итого", bold: true }, { text: `${formatMoney(total)} ₽`, bold: true }],
          ],
        },
        layout: "noBorders",
      },
    ],
    styles: {
      title: {
        fontSize: 18,
        bold: true,
      },
      tableHeader: {
        bold: true,
      },
    },
  };

  const printer = new PdfPrinter(fonts);
  const pdfDoc = printer.createPdfKitDocument(docDefinition);

  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    pdfDoc.on("data", (chunk: Buffer) => chunks.push(chunk));
    pdfDoc.on("end", () => resolve());
    pdfDoc.on("error", (error: unknown) => reject(error));
    pdfDoc.end();
  });

  return Buffer.concat(chunks);
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const resolvedParams = await params;
  const orderId = resolvedParams?.id ? String(resolvedParams.id).trim() : "";
  if (!orderId) {
    return NextResponse.json(
      { success: false, error: "Order id is required." },
      { status: 400 }
    );
  }

  const payload = await getPayloadClient();
  let authUser: any = null;
  try {
    const authResult = await payload.auth({ headers: request.headers });
    authUser = authResult?.user ?? null;
  } catch {
    authUser = null;
  }
  if (!authUser) {
    return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
  }

  let order: any = null;
  try {
    order = await payload.findByID({
      collection: "orders",
      id: orderId,
      depth: 2,
      overrideAccess: true,
    });
  } catch {
    return NextResponse.json({ success: false, error: "Order not found." }, { status: 404 });
  }

  const userEmail = normalizeEmail(authUser?.email);
  const orderEmail = normalizeEmail(order?.customer?.email);
  const orderUserId = normalizeRelationshipId(order?.user);
  const isOwner =
    (orderUserId !== null && String(orderUserId) === String(authUser?.id)) ||
    (userEmail && orderEmail && userEmail === orderEmail);
  if (!isOwner) {
    return NextResponse.json({ success: false, error: "Forbidden." }, { status: 403 });
  }

  const items: any[] = Array.isArray(order?.items) ? order.items : [];
  const subtotal = items.reduce((sum: number, item: any) => {
    const quantity =
      typeof item?.quantity === "number" && Number.isFinite(item.quantity) && item.quantity > 0
        ? item.quantity
        : 1;
    const unitPrice =
      typeof item?.unitPrice === "number" && Number.isFinite(item.unitPrice) && item.unitPrice >= 0
        ? item.unitPrice
        : 0;
    return sum + quantity * unitPrice;
  }, 0);
  const deliveryCost = resolveDeliveryCost(order);
  const total = subtotal + deliveryCost;

  const format = (request.nextUrl.searchParams.get("format") || "").trim().toLowerCase();
  if (format === "pdf") {
    const pdfBuffer = await createReceiptPdf({
      order,
      items,
      subtotal,
      deliveryCost,
      total,
    });

    const fileSafeOrderId = String(order?.id || orderId).replace(/[^a-zA-Z0-9_-]/g, "_");
    const fileName = `receipt-${fileSafeOrderId}.pdf`;

    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename=\"${fileName}\"`,
        "Cache-Control": "private, no-store",
      },
    });
  }

  const autoPrint = request.nextUrl.searchParams.get("print") === "1";
  const html = renderReceiptHtml({
    order,
    items,
    subtotal,
    deliveryCost,
    total,
    autoPrint,
  });

  return new NextResponse(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-store",
    },
  });
}
