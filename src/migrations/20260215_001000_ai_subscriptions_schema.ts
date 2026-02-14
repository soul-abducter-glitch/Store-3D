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
  const aiSubscriptionsTable = qualifiedTable(schema, "ai_subscriptions");
  const processedWebhooksTable = qualifiedTable(schema, "processed_webhooks");
  const lockRelsTable = qualifiedTable(schema, "payload_locked_documents_rels");

  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS ${aiSubscriptionsTable} (
      "id" serial PRIMARY KEY,
      "user_id" integer NOT NULL,
      "stripe_customer_id" varchar,
      "stripe_subscription_id" varchar,
      "stripe_price_id" varchar,
      "plan_code" varchar NOT NULL DEFAULT 's',
      "status" varchar NOT NULL DEFAULT 'incomplete',
      "current_period_start" timestamptz,
      "current_period_end" timestamptz,
      "cancel_at_period_end" boolean NOT NULL DEFAULT false,
      "last_invoice_id" varchar,
      "meta" jsonb,
      "updated_at" timestamptz DEFAULT now(),
      "created_at" timestamptz DEFAULT now()
    )
  `));

  await db.execute(sql.raw(`ALTER TABLE ${aiSubscriptionsTable} ADD COLUMN IF NOT EXISTS "user_id" integer`));
  await db.execute(
    sql.raw(`ALTER TABLE ${aiSubscriptionsTable} ADD COLUMN IF NOT EXISTS "stripe_customer_id" varchar`)
  );
  await db.execute(
    sql.raw(`ALTER TABLE ${aiSubscriptionsTable} ADD COLUMN IF NOT EXISTS "stripe_subscription_id" varchar`)
  );
  await db.execute(
    sql.raw(`ALTER TABLE ${aiSubscriptionsTable} ADD COLUMN IF NOT EXISTS "stripe_price_id" varchar`)
  );
  await db.execute(
    sql.raw(`ALTER TABLE ${aiSubscriptionsTable} ADD COLUMN IF NOT EXISTS "plan_code" varchar DEFAULT 's'`)
  );
  await db.execute(
    sql.raw(`ALTER TABLE ${aiSubscriptionsTable} ADD COLUMN IF NOT EXISTS "status" varchar DEFAULT 'incomplete'`)
  );
  await db.execute(
    sql.raw(`ALTER TABLE ${aiSubscriptionsTable} ADD COLUMN IF NOT EXISTS "current_period_start" timestamptz`)
  );
  await db.execute(
    sql.raw(`ALTER TABLE ${aiSubscriptionsTable} ADD COLUMN IF NOT EXISTS "current_period_end" timestamptz`)
  );
  await db.execute(
    sql.raw(`ALTER TABLE ${aiSubscriptionsTable} ADD COLUMN IF NOT EXISTS "cancel_at_period_end" boolean DEFAULT false`)
  );
  await db.execute(
    sql.raw(`ALTER TABLE ${aiSubscriptionsTable} ADD COLUMN IF NOT EXISTS "last_invoice_id" varchar`)
  );
  await db.execute(sql.raw(`ALTER TABLE ${aiSubscriptionsTable} ADD COLUMN IF NOT EXISTS "meta" jsonb`));
  await db.execute(
    sql.raw(`ALTER TABLE ${aiSubscriptionsTable} ADD COLUMN IF NOT EXISTS "updated_at" timestamptz DEFAULT now()`)
  );
  await db.execute(
    sql.raw(`ALTER TABLE ${aiSubscriptionsTable} ADD COLUMN IF NOT EXISTS "created_at" timestamptz DEFAULT now()`)
  );

  await db.execute(
    sql.raw(`CREATE INDEX IF NOT EXISTS "ai_subscriptions_user_idx" ON ${aiSubscriptionsTable} ("user_id")`)
  );
  await db.execute(
    sql.raw(
      `CREATE INDEX IF NOT EXISTS "ai_subscriptions_customer_idx" ON ${aiSubscriptionsTable} ("stripe_customer_id")`
    )
  );
  await db.execute(
    sql.raw(
      `CREATE INDEX IF NOT EXISTS "ai_subscriptions_subscription_idx" ON ${aiSubscriptionsTable} ("stripe_subscription_id")`
    )
  );
  await db.execute(
    sql.raw(`CREATE INDEX IF NOT EXISTS "ai_subscriptions_plan_idx" ON ${aiSubscriptionsTable} ("plan_code")`)
  );
  await db.execute(
    sql.raw(`CREATE INDEX IF NOT EXISTS "ai_subscriptions_status_idx" ON ${aiSubscriptionsTable} ("status")`)
  );
  await db.execute(
    sql.raw(
      `CREATE INDEX IF NOT EXISTS "ai_subscriptions_period_end_idx" ON ${aiSubscriptionsTable} ("current_period_end")`
    )
  );

  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS ${processedWebhooksTable} (
      "id" serial PRIMARY KEY,
      "provider" varchar NOT NULL DEFAULT 'stripe',
      "event_id" varchar NOT NULL,
      "event_type" varchar NOT NULL DEFAULT 'unknown',
      "status" varchar NOT NULL DEFAULT 'processing',
      "processed_at" timestamptz,
      "failure_reason" text,
      "meta" jsonb,
      "updated_at" timestamptz DEFAULT now(),
      "created_at" timestamptz DEFAULT now()
    )
  `));

  await db.execute(
    sql.raw(`ALTER TABLE ${processedWebhooksTable} ADD COLUMN IF NOT EXISTS "provider" varchar DEFAULT 'stripe'`)
  );
  await db.execute(sql.raw(`ALTER TABLE ${processedWebhooksTable} ADD COLUMN IF NOT EXISTS "event_id" varchar`));
  await db.execute(
    sql.raw(`ALTER TABLE ${processedWebhooksTable} ADD COLUMN IF NOT EXISTS "event_type" varchar DEFAULT 'unknown'`)
  );
  await db.execute(
    sql.raw(`ALTER TABLE ${processedWebhooksTable} ADD COLUMN IF NOT EXISTS "status" varchar DEFAULT 'processing'`)
  );
  await db.execute(
    sql.raw(`ALTER TABLE ${processedWebhooksTable} ADD COLUMN IF NOT EXISTS "processed_at" timestamptz`)
  );
  await db.execute(
    sql.raw(`ALTER TABLE ${processedWebhooksTable} ADD COLUMN IF NOT EXISTS "failure_reason" text`)
  );
  await db.execute(sql.raw(`ALTER TABLE ${processedWebhooksTable} ADD COLUMN IF NOT EXISTS "meta" jsonb`));
  await db.execute(
    sql.raw(`ALTER TABLE ${processedWebhooksTable} ADD COLUMN IF NOT EXISTS "updated_at" timestamptz DEFAULT now()`)
  );
  await db.execute(
    sql.raw(`ALTER TABLE ${processedWebhooksTable} ADD COLUMN IF NOT EXISTS "created_at" timestamptz DEFAULT now()`)
  );

  await db.execute(
    sql.raw(
      `CREATE INDEX IF NOT EXISTS "processed_webhooks_provider_idx" ON ${processedWebhooksTable} ("provider")`
    )
  );
  await db.execute(
    sql.raw(
      `CREATE UNIQUE INDEX IF NOT EXISTS "processed_webhooks_event_id_uidx" ON ${processedWebhooksTable} ("event_id")`
    )
  );
  await db.execute(
    sql.raw(
      `CREATE INDEX IF NOT EXISTS "processed_webhooks_event_type_idx" ON ${processedWebhooksTable} ("event_type")`
    )
  );
  await db.execute(
    sql.raw(
      `CREATE INDEX IF NOT EXISTS "processed_webhooks_status_idx" ON ${processedWebhooksTable} ("status")`
    )
  );
  await db.execute(
    sql.raw(
      `CREATE INDEX IF NOT EXISTS "processed_webhooks_created_at_idx" ON ${processedWebhooksTable} ("created_at")`
    )
  );

  await db.execute(sql.raw(`
    DO $$
    BEGIN
      IF to_regclass('${schema}.payload_locked_documents_rels') IS NOT NULL THEN
        ALTER TABLE ${lockRelsTable} ADD COLUMN IF NOT EXISTS "ai_subscriptions_id" integer;
        ALTER TABLE ${lockRelsTable} ADD COLUMN IF NOT EXISTS "processed_webhooks_id" integer;
      END IF;
    END $$;
  `));
}

export async function down({ payload }: MigrateDownArgs): Promise<void> {
  payload.logger.info({
    msg: "down migration for ai_subscriptions schema is intentionally a no-op to prevent data loss",
  });
}

