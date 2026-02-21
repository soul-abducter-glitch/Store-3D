import { NextResponse, type NextRequest } from "next/server";
import { getPayload } from "payload";

import payloadConfig from "../../../../../payload.config";
import { sendNotificationEmail } from "@/lib/orderNotifications";
import { createGiftToken, normalizeEmail } from "@/lib/giftLinks";
import {
  expirePendingGiftTransfers,
  normalizeEntitlementStatus,
  normalizeGiftMessage,
  normalizeRelationshipId,
  normalizeString,
  resolveGiftTransferExpiryIso,
  resolveGiftTransferHours,
} from "@/lib/giftTransfers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const normalizeId = (value: unknown) => String(value ?? "").trim();

const resolveSender = async (payload: any, request: NextRequest) => {
  const auth = await payload.auth({ headers: request.headers }).catch(() => null);
  const userId = normalizeRelationshipId(auth?.user?.id);
  const email = normalizeEmail(auth?.user?.email);
  if (!userId || !email) return null;
  const name = normalizeString(auth?.user?.name) || "Пользователь";
  return { userId, email, name };
};

const resolveEntitlementForSender = async (args: {
  payload: any;
  senderUserId: string | number;
  entitlementId?: unknown;
  productId?: unknown;
}) => {
  const { payload, senderUserId, entitlementId, productId } = args;
  const normalizedEntitlementId = normalizeRelationshipId(entitlementId);
  const normalizedProductId = normalizeRelationshipId(productId);

  if (normalizedEntitlementId !== null) {
    const byId = await payload
      .findByID({
        collection: "digital_entitlements",
        id: normalizedEntitlementId as any,
        depth: 0,
        overrideAccess: true,
      })
      .catch(() => null);
    if (!byId) return null;
    if (String(normalizeRelationshipId(byId?.ownerUser) ?? "") !== String(senderUserId)) return null;
    if (String(byId?.ownerType || "").toUpperCase() !== "USER") return null;
    return byId;
  }

  if (normalizedProductId === null) return null;

  const found = await payload.find({
    collection: "digital_entitlements",
    depth: 0,
    limit: 1,
    sort: "-createdAt",
    overrideAccess: true,
    where: {
      and: [
        { ownerType: { equals: "USER" } },
        { ownerUser: { equals: senderUserId as any } },
        { product: { equals: normalizedProductId as any } },
        { status: { equals: "ACTIVE" } },
      ],
    },
  });
  return found?.docs?.[0] || null;
};

const isEntitlementGiftable = (product: any) => {
  if (!product) return false;
  if (product?.giftable === false) return false;
  const format = normalizeString(product?.format).toLowerCase();
  return format.includes("digital") || format.includes("stl") || !format;
};

export async function POST(request: NextRequest) {
  try {
    const payload = await getPayload({ config: payloadConfig });
    const sender = await resolveSender(payload, request);
    if (!sender) {
      return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const recipientEmail = normalizeEmail(body?.recipientEmail);
    const message = normalizeGiftMessage(body?.message);
    const expiresInHours = resolveGiftTransferHours(body?.expiresInHours);

    if (!recipientEmail || !EMAIL_REGEX.test(recipientEmail)) {
      return NextResponse.json(
        { success: false, error: "Recipient email is invalid." },
        { status: 400 }
      );
    }
    if (recipientEmail === sender.email) {
      return NextResponse.json(
        { success: false, error: "Нельзя отправить подарок самому себе." },
        { status: 400 }
      );
    }

    const existingRecipientUser = await payload
      .find({
        collection: "users",
        depth: 0,
        limit: 1,
        overrideAccess: true,
        where: { email: { equals: recipientEmail } },
      })
      .catch(() => null);
    const recipientUserId = normalizeRelationshipId(existingRecipientUser?.docs?.[0]?.id);
    if (recipientUserId !== null && String(recipientUserId) === String(sender.userId)) {
      return NextResponse.json(
        { success: false, error: "Нельзя отправить подарок самому себе." },
        { status: 400 }
      );
    }

    await expirePendingGiftTransfers({
      payload,
      scopeWhere: { senderUser: { equals: sender.userId as any } },
      limit: 200,
    }).catch(() => null);

    const entitlement = await resolveEntitlementForSender({
      payload,
      senderUserId: sender.userId,
      entitlementId: body?.entitlementId,
      productId: body?.productId,
    });
    if (!entitlement) {
      return NextResponse.json(
        { success: false, error: "Файл не найден в вашей цифровой библиотеке." },
        { status: 404 }
      );
    }

    const entitlementStatus = normalizeEntitlementStatus(entitlement?.status);
    if (entitlementStatus !== "ACTIVE") {
      const statusError =
        entitlementStatus === "TRANSFER_PENDING"
          ? "По этому файлу уже ожидается передача."
          : entitlementStatus === "TRANSFERRED"
            ? "Это право уже передано другому пользователю."
            : "Этот файл недоступен для передачи.";
      return NextResponse.json({ success: false, error: statusError }, { status: 409 });
    }

    const productId = normalizeRelationshipId(entitlement?.product);
    if (productId === null) {
      return NextResponse.json(
        { success: false, error: "Не удалось определить модель для подарка." },
        { status: 400 }
      );
    }

    const product = await payload
      .findByID({
        collection: "products",
        id: productId as any,
        depth: 0,
        overrideAccess: true,
      })
      .catch(() => null);
    if (!product) {
      return NextResponse.json({ success: false, error: "Product not found." }, { status: 404 });
    }
    if (!isEntitlementGiftable(product)) {
      return NextResponse.json(
        { success: false, error: "Эту модель нельзя подарить." },
        { status: 400 }
      );
    }

    await expirePendingGiftTransfers({
      payload,
      scopeWhere: { entitlement: { equals: entitlement.id as any } },
      limit: 50,
    }).catch(() => null);

    const pendingTransferFound = await payload.find({
      collection: "gift_transfers",
      depth: 0,
      limit: 1,
      sort: "-createdAt",
      overrideAccess: true,
      where: {
        and: [
          { entitlement: { equals: entitlement.id as any } },
          { status: { equals: "PENDING" } },
        ],
      },
    });
    if (Array.isArray(pendingTransferFound?.docs) && pendingTransferFound.docs.length > 0) {
      return NextResponse.json(
        { success: false, error: "По этому файлу уже есть активная передача." },
        { status: 409 }
      );
    }

    const recipientAlreadyOwned = await payload.find({
      collection: "digital_entitlements",
      depth: 0,
      limit: 1,
      overrideAccess: true,
      where: {
        and: [
          { status: { equals: "ACTIVE" } },
          { ownerEmail: { equals: recipientEmail } },
          { product: { equals: productId as any } },
        ],
      },
    });
    if (Array.isArray(recipientAlreadyOwned?.docs) && recipientAlreadyOwned.docs.length > 0) {
      return NextResponse.json(
        { success: false, error: "У получателя уже есть доступ к этой модели." },
        { status: 409 }
      );
    }

    const expiresAt = resolveGiftTransferExpiryIso(expiresInHours);
    const transfer = await payload.create({
      collection: "gift_transfers",
      depth: 0,
      overrideAccess: true,
      data: {
        entitlement: entitlement.id,
        product: productId as any,
        senderUser: sender.userId as any,
        recipientUser: recipientUserId as any,
        recipientEmail,
        message: message || undefined,
        status: "PENDING",
        expiresAt,
        meta: {
          senderEmail: sender.email,
          senderName: sender.name,
          productName: normalizeString(product?.name) || "Digital STL",
        },
      },
    });

    await payload.update({
      collection: "digital_entitlements",
      id: entitlement.id,
      depth: 0,
      overrideAccess: true,
      data: {
        status: "TRANSFER_PENDING",
        meta: {
          ...(entitlement?.meta && typeof entitlement.meta === "object" && !Array.isArray(entitlement.meta)
            ? entitlement.meta
            : {}),
          transfer: {
            transferId: String(transfer.id),
            state: "pending",
            recipientEmail,
            createdAt: new Date().toISOString(),
            expiresAt,
          },
        },
      },
    });

    const productName = normalizeString(product?.name) || "Digital STL";
    const token = createGiftToken(
      {
        transferId: String(transfer.id),
        recipientEmail,
        productName,
      },
      expiresInHours
    );
    const giftUrl = `${request.nextUrl.origin}/gift/claim?token=${encodeURIComponent(token)}`;

    const mailResult = await sendNotificationEmail({
      to: recipientEmail,
      subject: `Вам отправили подарок: ${productName}`,
      text: [
        `Здравствуйте!`,
        `${sender.name} отправил вам доступ к модели "${productName}".`,
        "",
        message ? `Сообщение: ${message}` : "",
        `Принять подарок: ${giftUrl}`,
        `Срок принятия: до ${new Date(expiresAt).toLocaleString("ru-RU")}`,
      ]
        .filter(Boolean)
        .join("\n"),
    }).catch(() => ({ ok: false as const }));

    return NextResponse.json(
      {
        success: true,
        transferId: String(transfer.id),
        entitlementId: String(entitlement.id),
        giftUrl,
        expiresAt,
        emailSent: Boolean((mailResult as any)?.ok),
      },
      { status: 200 }
    );
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: error?.message || "Failed to create gift transfer.",
      },
      { status: 500 }
    );
  }
}

