import { sql, type MigrateDownArgs, type MigrateUpArgs } from "@payloadcms/db-postgres";

const normalizeSchemaName = (value: unknown) => {
  if (typeof value !== "string") return "public";
  const trimmed = value.trim();
  if (!trimmed) return "public";
  return /^[A-Za-z0-9_]+$/.test(trimmed) ? trimmed : "public";
};

const quoteIdentifier = (value: string) => `"${value.replace(/"/g, "\"\"")}"`;

const qualifiedTable = (schema: string, table: string) =>
  `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;

export async function up({ db, payload }: MigrateUpArgs): Promise<void> {
  const schema = normalizeSchemaName((payload as any)?.db?.schemaName);
  const giftTransfersTable = qualifiedTable(schema, "gift_transfers");
  const lockRelsTable = qualifiedTable(schema, "payload_locked_documents_rels");

  await db.execute(sql.raw(`
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
  `));

  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS "gift_transfers_entitlement_idx" ON ${giftTransfersTable} ("entitlement_id")`));
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS "gift_transfers_sender_user_idx" ON ${giftTransfersTable} ("sender_user_id")`));
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS "gift_transfers_recipient_email_idx" ON ${giftTransfersTable} ("recipient_email")`));
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS "gift_transfers_status_idx" ON ${giftTransfersTable} ("status")`));
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS "gift_transfers_expires_at_idx" ON ${giftTransfersTable} ("expires_at")`));

  await db.execute(sql.raw(`
    DO $$
    BEGIN
      IF to_regclass('${schema}.payload_locked_documents_rels') IS NOT NULL THEN
        ALTER TABLE ${lockRelsTable} ADD COLUMN IF NOT EXISTS "gift_transfers_id" integer;
      END IF;
    END $$;
  `));
}

export async function down({ payload }: MigrateDownArgs): Promise<void> {
  payload.logger.info({
    msg: "down migration for gift transfers schema is intentionally a no-op to prevent data loss",
  });
}

