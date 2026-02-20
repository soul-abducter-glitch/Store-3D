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
  const entitlementsTable = qualifiedTable(schema, "digital_entitlements");
  const linkEventsTable = qualifiedTable(schema, "download_link_events");
  const downloadEventsTable = qualifiedTable(schema, "download_events");
  const lockRelsTable = qualifiedTable(schema, "payload_locked_documents_rels");

  await db.execute(sql.raw(`
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
  `));

  await db.execute(sql.raw(`
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
  `));

  await db.execute(sql.raw(`
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
  `));

  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS "digital_entitlements_owner_user_idx" ON ${entitlementsTable} ("owner_user_id")`));
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS "digital_entitlements_owner_email_idx" ON ${entitlementsTable} ("owner_email")`));
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS "digital_entitlements_order_idx" ON ${entitlementsTable} ("order_id")`));
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS "digital_entitlements_product_idx" ON ${entitlementsTable} ("product_id")`));
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS "digital_entitlements_status_idx" ON ${entitlementsTable} ("status")`));

  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS "download_link_events_entitlement_idx" ON ${linkEventsTable} ("entitlement_id")`));
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS "download_link_events_created_at_idx" ON ${linkEventsTable} ("created_at")`));

  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS "download_events_entitlement_idx" ON ${downloadEventsTable} ("entitlement_id")`));
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS "download_events_created_at_idx" ON ${downloadEventsTable} ("created_at")`));

  await db.execute(sql.raw(`
    DO $$
    BEGIN
      IF to_regclass('${schema}.payload_locked_documents_rels') IS NOT NULL THEN
        ALTER TABLE ${lockRelsTable} ADD COLUMN IF NOT EXISTS "digital_entitlements_id" integer;
        ALTER TABLE ${lockRelsTable} ADD COLUMN IF NOT EXISTS "download_link_events_id" integer;
        ALTER TABLE ${lockRelsTable} ADD COLUMN IF NOT EXISTS "download_events_id" integer;
      END IF;
    END $$;
  `));
}

export async function down({ payload }: MigrateDownArgs): Promise<void> {
  payload.logger.info({
    msg: "down migration for digital downloads schema is intentionally a no-op to prevent data loss",
  });
}
