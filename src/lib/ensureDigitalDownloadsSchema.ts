type PayloadLike = {
  db?: {
    execute?: (args: { raw?: string }) => Promise<{ rows?: Array<Record<string, unknown>> }>;
    pool?: { query?: (query: string) => Promise<{ rows?: Array<Record<string, unknown>> }> };
    schemaName?: unknown;
  };
  logger?: {
    warn?: (args: unknown) => void;
  };
};

const normalizeSchemaName = (value: unknown) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return /^[A-Za-z0-9_]+$/.test(trimmed) ? trimmed : null;
};

const quoteIdentifier = (value: string) => `"${value.replace(/"/g, "\"\"")}"`;

const qualifiedTable = (schema: string, table: string) =>
  `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;

const executeRaw = async (payload: PayloadLike, raw: string) => {
  const db = payload?.db;
  const execute = db?.execute;
  if (!db || typeof execute !== "function") {
    throw new Error("Payload DB adapter does not support raw SQL execution.");
  }
  try {
    return await execute.call(db, { raw });
  } catch (error) {
    const poolQuery = db.pool?.query;
    if (typeof poolQuery === "function") {
      return await poolQuery.call(db.pool, raw);
    }
    throw error;
  }
};

export const ensureDigitalDownloadsSchema = async (payload: PayloadLike) => {
  const schemaHint = normalizeSchemaName(payload?.db?.schemaName);
  const schemas = Array.from(new Set([...(schemaHint ? [schemaHint] : []), "public"]));

  for (const schema of schemas) {
    const entitlementsTable = qualifiedTable(schema, "digital_entitlements");
    const giftTransfersTable = qualifiedTable(schema, "gift_transfers");
    const linkEventsTable = qualifiedTable(schema, "download_link_events");
    const downloadEventsTable = qualifiedTable(schema, "download_events");
    const lockRelsTable = qualifiedTable(schema, "payload_locked_documents_rels");

    await executeRaw(
      payload,
      `
      CREATE TABLE IF NOT EXISTS ${entitlementsTable} (
        "id" serial PRIMARY KEY,
        "owner_type" varchar NOT NULL DEFAULT 'USER',
        "owner_user_id" integer,
        "owner_email" varchar,
        "product_id" integer NOT NULL,
        "variant_id" varchar,
        "order_id" integer NOT NULL,
        "status" varchar NOT NULL DEFAULT 'ACTIVE',
        "revoked_at" timestamptz,
        "meta" jsonb,
        "updated_at" timestamptz DEFAULT now(),
        "created_at" timestamptz DEFAULT now()
      )
      `
    );

    await executeRaw(
      payload,
      `
      CREATE TABLE IF NOT EXISTS ${giftTransfersTable} (
        "id" serial PRIMARY KEY,
        "entitlement_id" integer NOT NULL,
        "product_id" integer NOT NULL,
        "sender_user_id" integer NOT NULL,
        "recipient_user_id" integer,
        "recipient_email" varchar NOT NULL,
        "message" text,
        "status" varchar NOT NULL DEFAULT 'PENDING',
        "expires_at" timestamptz NOT NULL,
        "accepted_at" timestamptz,
        "expired_at" timestamptz,
        "canceled_at" timestamptz,
        "meta" jsonb,
        "updated_at" timestamptz DEFAULT now(),
        "created_at" timestamptz DEFAULT now()
      )
      `
    );

    await executeRaw(
      payload,
      `
      CREATE TABLE IF NOT EXISTS ${linkEventsTable} (
        "id" serial PRIMARY KEY,
        "entitlement_id" integer NOT NULL,
        "order_id" integer,
        "product_id" integer,
        "owner_type" varchar NOT NULL,
        "owner_ref" varchar NOT NULL,
        "ip" varchar,
        "user_agent" text,
        "expires_at" timestamptz NOT NULL,
        "updated_at" timestamptz DEFAULT now(),
        "created_at" timestamptz DEFAULT now()
      )
      `
    );

    await executeRaw(
      payload,
      `
      CREATE TABLE IF NOT EXISTS ${downloadEventsTable} (
        "id" serial PRIMARY KEY,
        "entitlement_id" integer NOT NULL,
        "order_id" integer,
        "product_id" integer,
        "status" varchar NOT NULL,
        "reason" varchar,
        "owner_type" varchar NOT NULL,
        "owner_ref" varchar NOT NULL,
        "ip" varchar,
        "user_agent" text,
        "updated_at" timestamptz DEFAULT now(),
        "created_at" timestamptz DEFAULT now()
      )
      `
    );

    await executeRaw(
      payload,
      `CREATE INDEX IF NOT EXISTS "digital_entitlements_owner_user_idx" ON ${entitlementsTable} ("owner_user_id")`
    );
    await executeRaw(
      payload,
      `CREATE INDEX IF NOT EXISTS "digital_entitlements_owner_email_idx" ON ${entitlementsTable} ("owner_email")`
    );
    await executeRaw(
      payload,
      `CREATE INDEX IF NOT EXISTS "digital_entitlements_order_idx" ON ${entitlementsTable} ("order_id")`
    );
    await executeRaw(
      payload,
      `CREATE INDEX IF NOT EXISTS "digital_entitlements_product_idx" ON ${entitlementsTable} ("product_id")`
    );
    await executeRaw(
      payload,
      `CREATE INDEX IF NOT EXISTS "digital_entitlements_status_idx" ON ${entitlementsTable} ("status")`
    );
    await executeRaw(
      payload,
      `CREATE INDEX IF NOT EXISTS "gift_transfers_entitlement_idx" ON ${giftTransfersTable} ("entitlement_id")`
    );
    await executeRaw(
      payload,
      `CREATE INDEX IF NOT EXISTS "gift_transfers_sender_user_idx" ON ${giftTransfersTable} ("sender_user_id")`
    );
    await executeRaw(
      payload,
      `CREATE INDEX IF NOT EXISTS "gift_transfers_recipient_email_idx" ON ${giftTransfersTable} ("recipient_email")`
    );
    await executeRaw(
      payload,
      `CREATE INDEX IF NOT EXISTS "gift_transfers_status_idx" ON ${giftTransfersTable} ("status")`
    );
    await executeRaw(
      payload,
      `CREATE INDEX IF NOT EXISTS "gift_transfers_expires_at_idx" ON ${giftTransfersTable} ("expires_at")`
    );

    await executeRaw(
      payload,
      `CREATE INDEX IF NOT EXISTS "download_link_events_entitlement_idx" ON ${linkEventsTable} ("entitlement_id")`
    );
    await executeRaw(
      payload,
      `CREATE INDEX IF NOT EXISTS "download_link_events_created_at_idx" ON ${linkEventsTable} ("created_at")`
    );

    await executeRaw(
      payload,
      `CREATE INDEX IF NOT EXISTS "download_events_entitlement_idx" ON ${downloadEventsTable} ("entitlement_id")`
    );
    await executeRaw(
      payload,
      `CREATE INDEX IF NOT EXISTS "download_events_created_at_idx" ON ${downloadEventsTable} ("created_at")`
    );

    try {
      await executeRaw(
        payload,
        `
        DO $$
        BEGIN
          IF to_regclass('${schema}.payload_locked_documents_rels') IS NOT NULL THEN
            ALTER TABLE ${lockRelsTable} ADD COLUMN IF NOT EXISTS "digital_entitlements_id" integer;
            ALTER TABLE ${lockRelsTable} ADD COLUMN IF NOT EXISTS "gift_transfers_id" integer;
            ALTER TABLE ${lockRelsTable} ADD COLUMN IF NOT EXISTS "download_link_events_id" integer;
            ALTER TABLE ${lockRelsTable} ADD COLUMN IF NOT EXISTS "download_events_id" integer;
          END IF;
        END $$;
        `
      );
    } catch (error) {
      payload?.logger?.warn?.({
        msg: "Failed to ensure payload_locked_documents_rels columns for digital downloads",
        schema,
        err: error,
      });
    }
  }
};
