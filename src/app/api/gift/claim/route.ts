import { NextResponse, type NextRequest } from "next/server";
import { getPayload } from "payload";

import payloadConfig from "../../../../../payload.config";
import { normalizeEmail, verifyGiftToken } from "@/lib/giftLinks";
import {
  expireSingleGiftTransfer,
  normalizeEntitlementStatus,
  normalizeGiftTransferStatus,
  normalizeRelationshipId,
  normalizeString,
} from "@/lib/giftTransfers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const findRecipient = async (payload: any, request: NextRequest) => {
  const auth = await payload.auth({ headers: request.headers }).catch(() => null);
  const recipientId = normalizeRelationshipId(auth?.user?.id);
  const recipientEmail = normalizeEmail(auth?.user?.email);
  if (!recipientId || !recipientEmail) return null;
  return { recipientId, recipientEmail };
};

const mergeMeta = (meta: unknown, patch: Record<string, unknown>) => {
  const base =
    meta && typeof meta === "object" && !Array.isArray(meta) ? (meta as Record<string, unknown>) : {};
  return { ...base, ...patch };
};

export async function POST(request: NextRequest) {
  try {
    const payload = await getPayload({ config: payloadConfig });
    const recipient = await findRecipient(payload, request);
    if (!recipient) {
      return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const token = typeof body?.token === "string" ? body.token.trim() : "";
    if (!token) {
      return NextResponse.json(
        { success: false, error: "Gift token is required." },
        { status: 400 }
      );
    }

    const verified = verifyGiftToken(token);
    if (!verified.valid) {
      return NextResponse.json({ success: false, error: verified.error }, { status: 400 });
    }

    const transferId = normalizeRelationshipId(verified.payload.transferId);
    if (transferId === null) {
      return NextResponse.json(
        { success: false, error: "Gift token is invalid." },
        { status: 400 }
      );
    }

    const tokenRecipientEmail = normalizeEmail(verified.payload.recipientEmail);
    if (!tokenRecipientEmail || tokenRecipientEmail !== recipient.recipientEmail) {
      return NextResponse.json(
        { success: false, error: "Gift link is assigned to another email." },
        { status: 403 }
      );
    }

    const transfer = await payload
      .findByID({
        collection: "gift_transfers",
        id: transferId as any,
        depth: 0,
        overrideAccess: true,
      })
      .catch(() => null);
    if (!transfer) {
      return NextResponse.json(
        { success: false, error: "Gift transfer not found." },
        { status: 404 }
      );
    }

    const transferStatus = normalizeGiftTransferStatus(transfer?.status);
    const expiresAtRaw = normalizeString(transfer?.expiresAt);
    const expiresAtMs = expiresAtRaw ? new Date(expiresAtRaw).getTime() : NaN;
    const expired = Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now();

    if (expired && transferStatus === "PENDING") {
      await expireSingleGiftTransfer({ payload, transfer });
      return NextResponse.json(
        { success: false, error: "Gift transfer has expired." },
        { status: 409 }
      );
    }

    if (transferStatus === "EXPIRED") {
      return NextResponse.json(
        { success: false, error: "Gift transfer has expired." },
        { status: 409 }
      );
    }
    if (transferStatus === "CANCELED") {
      return NextResponse.json(
        { success: false, error: "Gift transfer has been canceled." },
        { status: 409 }
      );
    }
    if (transferStatus === "ACCEPTED") {
      return NextResponse.json(
        {
          success: true,
          alreadyAccepted: true,
          productName:
            normalizeString(transfer?.meta?.productName) ||
            normalizeString(verified.payload.productName) ||
            "Digital STL",
        },
        { status: 200 }
      );
    }

    const senderUserId = normalizeRelationshipId(transfer?.senderUser);
    if (senderUserId !== null && String(senderUserId) === String(recipient.recipientId)) {
      return NextResponse.json(
        { success: false, error: "Нельзя принять собственный подарок." },
        { status: 400 }
      );
    }

    const transferRecipientEmail = normalizeEmail(transfer?.recipientEmail);
    if (!transferRecipientEmail || transferRecipientEmail !== recipient.recipientEmail) {
      return NextResponse.json(
        { success: false, error: "Gift link is assigned to another email." },
        { status: 403 }
      );
    }

    const entitlementId = normalizeRelationshipId(transfer?.entitlement);
    if (entitlementId === null) {
      return NextResponse.json(
        { success: false, error: "Gift transfer is invalid." },
        { status: 409 }
      );
    }

    const senderEntitlement = await payload
      .findByID({
        collection: "digital_entitlements",
        id: entitlementId as any,
        depth: 0,
        overrideAccess: true,
      })
      .catch(() => null);
    if (!senderEntitlement) {
      return NextResponse.json(
        { success: false, error: "Source entitlement not found." },
        { status: 404 }
      );
    }

    const senderEntitlementStatus = normalizeEntitlementStatus(senderEntitlement?.status);
    if (senderEntitlementStatus !== "TRANSFER_PENDING") {
      if (senderEntitlementStatus === "TRANSFERRED") {
        return NextResponse.json(
          {
            success: true,
            alreadyAccepted: true,
            productName:
              normalizeString(transfer?.meta?.productName) ||
              normalizeString(verified.payload.productName) ||
              "Digital STL",
          },
          { status: 200 }
        );
      }
      return NextResponse.json(
        { success: false, error: "Gift transfer is no longer available." },
        { status: 409 }
      );
    }

    const productId = normalizeRelationshipId(senderEntitlement?.product);
    if (productId === null) {
      return NextResponse.json(
        { success: false, error: "Gift transfer is invalid." },
        { status: 409 }
      );
    }

    const existingRecipientEntitlement = await payload.find({
      collection: "digital_entitlements",
      depth: 0,
      limit: 1,
      overrideAccess: true,
      where: {
        and: [
          { ownerType: { equals: "USER" } },
          { ownerUser: { equals: recipient.recipientId as any } },
          { product: { equals: productId as any } },
          { status: { equals: "ACTIVE" } },
        ],
      },
    });
    const alreadyOwned =
      Array.isArray(existingRecipientEntitlement?.docs) &&
      existingRecipientEntitlement.docs.length > 0;

    const nowIso = new Date().toISOString();

    if (!alreadyOwned) {
      await payload.create({
        collection: "digital_entitlements",
        depth: 0,
        overrideAccess: true,
        data: {
          ownerType: "USER",
          ownerUser: recipient.recipientId as any,
          ownerEmail: recipient.recipientEmail,
          product: senderEntitlement.product as any,
          variantId: senderEntitlement.variantId || undefined,
          order: senderEntitlement.order as any,
          status: "ACTIVE",
          meta: {
            source: "gift_transfer",
            transferId: String(transfer.id),
            receivedAt: nowIso,
            fromUser: senderUserId as any,
          },
        },
      });
    }

    await payload.update({
      collection: "digital_entitlements",
      id: senderEntitlement.id,
      depth: 0,
      overrideAccess: true,
      data: {
        status: "TRANSFERRED",
        meta: mergeMeta(senderEntitlement?.meta, {
          transfer: {
            transferId: String(transfer.id),
            state: "accepted",
            recipientEmail: recipient.recipientEmail,
            recipientUserId: recipient.recipientId,
            acceptedAt: nowIso,
          },
        }),
      },
    });

    await payload.update({
      collection: "gift_transfers",
      id: transfer.id,
      depth: 0,
      overrideAccess: true,
      data: {
        status: "ACCEPTED",
        acceptedAt: nowIso,
        recipientUser: recipient.recipientId as any,
        meta: mergeMeta(transfer?.meta, {
          acceptedAt: nowIso,
          recipientUserId: String(recipient.recipientId),
        }),
      },
    });

    const productName =
      normalizeString(transfer?.meta?.productName) ||
      normalizeString(verified.payload.productName) ||
      "Digital STL";

    return NextResponse.json(
      {
        success: true,
        alreadyOwned,
        productName,
      },
      { status: 200 }
    );
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: error?.message || "Failed to claim gift transfer.",
      },
      { status: 500 }
    );
  }
}

