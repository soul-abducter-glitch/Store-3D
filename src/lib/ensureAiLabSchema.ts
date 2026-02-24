type PayloadLike = {
  db?: {
    execute?: (args: { raw?: string }) => Promise<{ rows?: Array<Record<string, unknown>> }>;
    schemaName?: string;
  };
  logger?: {
    info?: (args: unknown) => void;
    warn?: (args: unknown) => void;
    error?: (args: unknown) => void;
  };
};

const normalizeSchemaName = (value: unknown) => {
  if (typeof value !== "string") return "public";
  const trimmed = value.trim();
  if (!trimmed) return "public";
  return /^[A-Za-z0-9_]+$/.test(trimmed) ? trimmed : "public";
};

const quoteIdentifier = (value: string) => `"${value.replace(/"/g, "\"\"")}"`;

const qualifiedTable = (schema: string, table: string) =>
  `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;

const toRegclassLiteral = (schema: string, table: string) => `${schema}.${table}`;

const executeRaw = async (payload: PayloadLike, raw: string) => {
  const db = payload?.db as
    | {
        execute?: (args: { raw?: string }) => Promise<{ rows?: Array<Record<string, unknown>> }>;
        pool?: { query?: (query: string) => Promise<{ rows?: Array<Record<string, unknown>> }> };
      }
    | undefined;
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

const ensureLockedDocsColumns = async (payload: PayloadLike, schema: string) => {
  const lockRelsTable = qualifiedTable(schema, "payload_locked_documents_rels");
  const lockRelsRegclass = toRegclassLiteral(schema, "payload_locked_documents_rels");

  const existingLockTable = await executeRaw(
    payload,
    `SELECT to_regclass('${lockRelsRegclass}') AS rel`
  );
  if (!existingLockTable?.rows?.[0]?.rel) {
    return;
  }

  await executeRaw(
    payload,
    `ALTER TABLE ${lockRelsTable} ADD COLUMN IF NOT EXISTS "ai_jobs_id" integer`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${lockRelsTable} ADD COLUMN IF NOT EXISTS "ai_assets_id" integer`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${lockRelsTable} ADD COLUMN IF NOT EXISTS "ai_token_events_id" integer`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${lockRelsTable} ADD COLUMN IF NOT EXISTS "ai_job_events_id" integer`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${lockRelsTable} ADD COLUMN IF NOT EXISTS "ai_subscriptions_id" integer`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${lockRelsTable} ADD COLUMN IF NOT EXISTS "processed_webhooks_id" integer`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${lockRelsTable} ADD COLUMN IF NOT EXISTS "support_tickets_id" integer`
  );
};

export const ensureAiLabSchema = async (payload: PayloadLike) => {
  const schema = normalizeSchemaName(payload?.db?.schemaName);
  const aiJobsTable = qualifiedTable(schema, "ai_jobs");
  const aiAssetsTable = qualifiedTable(schema, "ai_assets");
  const aiTokenEventsTable = qualifiedTable(schema, "ai_token_events");
  const aiJobEventsTable = qualifiedTable(schema, "ai_job_events");
  const aiSubscriptionsTable = qualifiedTable(schema, "ai_subscriptions");
  const processedWebhooksTable = qualifiedTable(schema, "processed_webhooks");
  const supportTicketsTable = qualifiedTable(schema, "support_tickets");
  const usersTable = qualifiedTable(schema, "users");
  const defaultAiCredits = (() => {
    const parsed = Number.parseInt(process.env.AI_TOKENS_DEFAULT || "", 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return 120;
    return parsed;
  })();

  await executeRaw(
    payload,
    `
      CREATE TABLE IF NOT EXISTS ${aiJobsTable} (
        "id" serial PRIMARY KEY,
        "user_id" integer NOT NULL,
        "guest_token" varchar,
        "status" varchar NOT NULL DEFAULT 'queued',
        "mode" varchar NOT NULL DEFAULT 'image',
        "provider" varchar DEFAULT 'mock',
        "provider_job_id" varchar,
        "idempotency_key" varchar,
        "request_hash" varchar,
        "parent_job_id" integer,
        "parent_asset_id" integer,
        "progress" numeric NOT NULL DEFAULT 0,
        "prompt" text NOT NULL DEFAULT '',
        "source_type" varchar DEFAULT 'none',
        "source_url" text,
        "input_refs" jsonb,
        "error_code" varchar,
        "error_message" text,
        "error_details" jsonb,
        "retry_count" integer NOT NULL DEFAULT 0,
        "eta_seconds" integer,
        "result_asset_id" integer,
        "result_asset_id_id" integer,
        "reserved_tokens" integer NOT NULL DEFAULT 0,
        "result_model_url" text,
        "result_preview_url" text,
        "result_format" varchar DEFAULT 'unknown',
        "started_at" timestamptz,
        "completed_at" timestamptz,
        "failed_at" timestamptz,
        "updated_at" timestamptz DEFAULT now(),
        "created_at" timestamptz DEFAULT now()
      )
    `
  );

  await executeRaw(
    payload,
    `ALTER TABLE ${aiJobsTable} ADD COLUMN IF NOT EXISTS "user_id" integer`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${aiJobsTable} ADD COLUMN IF NOT EXISTS "status" varchar DEFAULT 'queued'`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${aiJobsTable} ADD COLUMN IF NOT EXISTS "guest_token" varchar`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${aiJobsTable} ADD COLUMN IF NOT EXISTS "mode" varchar DEFAULT 'image'`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${aiJobsTable} ADD COLUMN IF NOT EXISTS "provider" varchar DEFAULT 'mock'`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${aiJobsTable} ADD COLUMN IF NOT EXISTS "provider_job_id" varchar`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${aiJobsTable} ADD COLUMN IF NOT EXISTS "idempotency_key" varchar`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${aiJobsTable} ADD COLUMN IF NOT EXISTS "request_hash" varchar`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${aiJobsTable} ADD COLUMN IF NOT EXISTS "parent_job_id" integer`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${aiJobsTable} ADD COLUMN IF NOT EXISTS "parent_asset_id" integer`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${aiJobsTable} ADD COLUMN IF NOT EXISTS "progress" numeric DEFAULT 0`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${aiJobsTable} ADD COLUMN IF NOT EXISTS "prompt" text DEFAULT ''`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${aiJobsTable} ADD COLUMN IF NOT EXISTS "source_type" varchar DEFAULT 'none'`
  );
  await executeRaw(payload, `ALTER TABLE ${aiJobsTable} ADD COLUMN IF NOT EXISTS "source_url" text`);
  await executeRaw(payload, `ALTER TABLE ${aiJobsTable} ADD COLUMN IF NOT EXISTS "input_refs" jsonb`);
  await executeRaw(
    payload,
    `ALTER TABLE ${aiJobsTable} ADD COLUMN IF NOT EXISTS "error_message" text`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${aiJobsTable} ADD COLUMN IF NOT EXISTS "error_code" varchar`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${aiJobsTable} ADD COLUMN IF NOT EXISTS "error_details" jsonb`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${aiJobsTable} ADD COLUMN IF NOT EXISTS "retry_count" integer DEFAULT 0`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${aiJobsTable} ADD COLUMN IF NOT EXISTS "eta_seconds" integer`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${aiJobsTable} ADD COLUMN IF NOT EXISTS "result_asset_id" integer`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${aiJobsTable} ADD COLUMN IF NOT EXISTS "result_asset_id_id" integer`
  );
  await executeRaw(
    payload,
    `UPDATE ${aiJobsTable} SET "result_asset_id_id" = "result_asset_id" WHERE "result_asset_id_id" IS NULL AND "result_asset_id" IS NOT NULL`
  );
  await executeRaw(
    payload,
    `UPDATE ${aiJobsTable} SET "result_asset_id" = "result_asset_id_id" WHERE "result_asset_id" IS NULL AND "result_asset_id_id" IS NOT NULL`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${aiJobsTable} ADD COLUMN IF NOT EXISTS "reserved_tokens" integer DEFAULT 0`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${aiJobsTable} ADD COLUMN IF NOT EXISTS "result_model_url" text`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${aiJobsTable} ADD COLUMN IF NOT EXISTS "result_preview_url" text`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${aiJobsTable} ADD COLUMN IF NOT EXISTS "result_format" varchar DEFAULT 'unknown'`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${aiJobsTable} ADD COLUMN IF NOT EXISTS "started_at" timestamptz`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${aiJobsTable} ADD COLUMN IF NOT EXISTS "completed_at" timestamptz`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${aiJobsTable} ADD COLUMN IF NOT EXISTS "failed_at" timestamptz`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${aiJobsTable} ADD COLUMN IF NOT EXISTS "updated_at" timestamptz DEFAULT now()`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${aiJobsTable} ADD COLUMN IF NOT EXISTS "created_at" timestamptz DEFAULT now()`
  );

  await executeRaw(
    payload,
    `CREATE INDEX IF NOT EXISTS "ai_jobs_user_idx" ON ${aiJobsTable} ("user_id")`
  );
  await executeRaw(
    payload,
    `CREATE INDEX IF NOT EXISTS "ai_jobs_guest_token_idx" ON ${aiJobsTable} ("guest_token")`
  );
  await executeRaw(
    payload,
    `CREATE INDEX IF NOT EXISTS "ai_jobs_status_idx" ON ${aiJobsTable} ("status")`
  );
  await executeRaw(
    payload,
    `CREATE INDEX IF NOT EXISTS "ai_jobs_provider_job_id_idx" ON ${aiJobsTable} ("provider_job_id")`
  );
  await executeRaw(
    payload,
    `CREATE INDEX IF NOT EXISTS "ai_jobs_parent_job_idx" ON ${aiJobsTable} ("parent_job_id")`
  );
  await executeRaw(
    payload,
    `CREATE INDEX IF NOT EXISTS "ai_jobs_parent_asset_idx" ON ${aiJobsTable} ("parent_asset_id")`
  );
  await executeRaw(
    payload,
    `CREATE INDEX IF NOT EXISTS "ai_jobs_created_at_idx" ON ${aiJobsTable} ("created_at")`
  );
  await executeRaw(
    payload,
    `CREATE INDEX IF NOT EXISTS "ai_jobs_idempotency_key_idx" ON ${aiJobsTable} ("idempotency_key")`
  );
  await executeRaw(
    payload,
    `CREATE INDEX IF NOT EXISTS "ai_jobs_request_hash_idx" ON ${aiJobsTable} ("request_hash")`
  );
  await executeRaw(
    payload,
    `
      WITH ranked AS (
        SELECT
          "id",
          "user_id",
          "idempotency_key",
          ROW_NUMBER() OVER (
            PARTITION BY "user_id", "idempotency_key"
            ORDER BY "created_at" DESC, "id" DESC
          ) AS rn
        FROM ${aiJobsTable}
        WHERE "user_id" IS NOT NULL AND "idempotency_key" IS NOT NULL
      )
      UPDATE ${aiJobsTable} AS t
      SET "idempotency_key" = NULL
      WHERE t."id" IN (SELECT "id" FROM ranked WHERE rn > 1)
    `
  );
  await executeRaw(
    payload,
    `
      WITH ranked AS (
        SELECT
          "id",
          "guest_token",
          "idempotency_key",
          ROW_NUMBER() OVER (
            PARTITION BY "guest_token", "idempotency_key"
            ORDER BY "created_at" DESC, "id" DESC
          ) AS rn
        FROM ${aiJobsTable}
        WHERE "guest_token" IS NOT NULL AND "idempotency_key" IS NOT NULL
      )
      UPDATE ${aiJobsTable} AS t
      SET "idempotency_key" = NULL
      WHERE t."id" IN (SELECT "id" FROM ranked WHERE rn > 1)
    `
  );
  await executeRaw(
    payload,
    `CREATE UNIQUE INDEX IF NOT EXISTS "ai_jobs_user_idem_uidx" ON ${aiJobsTable} ("user_id", "idempotency_key") WHERE "user_id" IS NOT NULL AND "idempotency_key" IS NOT NULL`
  );
  await executeRaw(
    payload,
    `CREATE UNIQUE INDEX IF NOT EXISTS "ai_jobs_guest_idem_uidx" ON ${aiJobsTable} ("guest_token", "idempotency_key") WHERE "guest_token" IS NOT NULL AND "idempotency_key" IS NOT NULL`
  );

  await executeRaw(
    payload,
    `
      CREATE TABLE IF NOT EXISTS ${aiAssetsTable} (
        "id" serial PRIMARY KEY,
        "user_id" integer NOT NULL,
        "job_id" integer,
        "previous_asset_id" integer,
        "family_id" varchar,
        "version" integer NOT NULL DEFAULT 1,
        "version_label" varchar NOT NULL DEFAULT 'original',
        "status" varchar NOT NULL DEFAULT 'ready',
        "provider" varchar DEFAULT 'mock',
        "title" varchar NOT NULL DEFAULT '',
        "prompt" text,
        "source_type" varchar DEFAULT 'none',
        "source_url" text,
        "preview_url" text,
        "model_url" text NOT NULL DEFAULT '',
        "format" varchar NOT NULL DEFAULT 'unknown',
        "precheck_logs" jsonb,
        "checks" jsonb,
        "repair_logs" jsonb,
        "split_part_set" jsonb,
        "pipeline_jobs" jsonb,
        "updated_at" timestamptz DEFAULT now(),
        "created_at" timestamptz DEFAULT now()
      )
    `
  );

  await executeRaw(
    payload,
    `ALTER TABLE ${aiAssetsTable} ADD COLUMN IF NOT EXISTS "user_id" integer`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${aiAssetsTable} ADD COLUMN IF NOT EXISTS "job_id" integer`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${aiAssetsTable} ADD COLUMN IF NOT EXISTS "previous_asset_id" integer`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${aiAssetsTable} ADD COLUMN IF NOT EXISTS "family_id" varchar`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${aiAssetsTable} ADD COLUMN IF NOT EXISTS "version" integer DEFAULT 1`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${aiAssetsTable} ADD COLUMN IF NOT EXISTS "version_label" varchar DEFAULT 'original'`
  );
  await executeRaw(
    payload,
    `UPDATE ${aiAssetsTable} SET "version_label" = 'original' WHERE "version_label" IS NULL`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${aiAssetsTable} ADD COLUMN IF NOT EXISTS "status" varchar DEFAULT 'ready'`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${aiAssetsTable} ADD COLUMN IF NOT EXISTS "provider" varchar DEFAULT 'mock'`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${aiAssetsTable} ADD COLUMN IF NOT EXISTS "title" varchar DEFAULT ''`
  );
  await executeRaw(payload, `ALTER TABLE ${aiAssetsTable} ADD COLUMN IF NOT EXISTS "prompt" text`);
  await executeRaw(
    payload,
    `ALTER TABLE ${aiAssetsTable} ADD COLUMN IF NOT EXISTS "source_type" varchar DEFAULT 'none'`
  );
  await executeRaw(payload, `ALTER TABLE ${aiAssetsTable} ADD COLUMN IF NOT EXISTS "source_url" text`);
  await executeRaw(payload, `ALTER TABLE ${aiAssetsTable} ADD COLUMN IF NOT EXISTS "preview_url" text`);
  await executeRaw(
    payload,
    `ALTER TABLE ${aiAssetsTable} ADD COLUMN IF NOT EXISTS "model_url" text DEFAULT ''`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${aiAssetsTable} ADD COLUMN IF NOT EXISTS "format" varchar DEFAULT 'unknown'`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${aiAssetsTable} ADD COLUMN IF NOT EXISTS "precheck_logs" jsonb`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${aiAssetsTable} ADD COLUMN IF NOT EXISTS "checks" jsonb`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${aiAssetsTable} ADD COLUMN IF NOT EXISTS "repair_logs" jsonb`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${aiAssetsTable} ADD COLUMN IF NOT EXISTS "split_part_set" jsonb`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${aiAssetsTable} ADD COLUMN IF NOT EXISTS "pipeline_jobs" jsonb`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${aiAssetsTable} ADD COLUMN IF NOT EXISTS "updated_at" timestamptz DEFAULT now()`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${aiAssetsTable} ADD COLUMN IF NOT EXISTS "created_at" timestamptz DEFAULT now()`
  );

  await executeRaw(
    payload,
    `CREATE INDEX IF NOT EXISTS "ai_assets_user_idx" ON ${aiAssetsTable} ("user_id")`
  );
  await executeRaw(
    payload,
    `CREATE INDEX IF NOT EXISTS "ai_assets_job_idx" ON ${aiAssetsTable} ("job_id")`
  );
  await executeRaw(
    payload,
    `CREATE INDEX IF NOT EXISTS "ai_assets_previous_asset_idx" ON ${aiAssetsTable} ("previous_asset_id")`
  );
  await executeRaw(
    payload,
    `CREATE INDEX IF NOT EXISTS "ai_assets_family_id_idx" ON ${aiAssetsTable} ("family_id")`
  );
  await executeRaw(
    payload,
    `CREATE INDEX IF NOT EXISTS "ai_assets_version_label_idx" ON ${aiAssetsTable} ("version_label")`
  );
  await executeRaw(
    payload,
    `CREATE INDEX IF NOT EXISTS "ai_assets_created_at_idx" ON ${aiAssetsTable} ("created_at")`
  );

  await executeRaw(
    payload,
    `
      CREATE TABLE IF NOT EXISTS ${aiTokenEventsTable} (
        "id" serial PRIMARY KEY,
        "job_id" integer,
        "user_id" integer NOT NULL,
        "reason" varchar NOT NULL DEFAULT 'adjust',
        "type" varchar NOT NULL DEFAULT 'adjust',
        "amount" integer NOT NULL DEFAULT 0,
        "delta" integer NOT NULL DEFAULT 0,
        "balance_after" integer NOT NULL DEFAULT 0,
        "source" varchar NOT NULL DEFAULT 'system',
        "reference_id" varchar,
        "idempotency_key" varchar,
        "meta" jsonb,
        "updated_at" timestamptz DEFAULT now(),
        "created_at" timestamptz DEFAULT now()
      )
    `
  );

  await executeRaw(
    payload,
    `ALTER TABLE ${aiTokenEventsTable} ADD COLUMN IF NOT EXISTS "user_id" integer`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${aiTokenEventsTable} ADD COLUMN IF NOT EXISTS "job_id" integer`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${aiTokenEventsTable} ADD COLUMN IF NOT EXISTS "reason" varchar DEFAULT 'adjust'`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${aiTokenEventsTable} ADD COLUMN IF NOT EXISTS "type" varchar DEFAULT 'adjust'`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${aiTokenEventsTable} ADD COLUMN IF NOT EXISTS "amount" integer DEFAULT 0`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${aiTokenEventsTable} ADD COLUMN IF NOT EXISTS "delta" integer DEFAULT 0`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${aiTokenEventsTable} ADD COLUMN IF NOT EXISTS "balance_after" integer DEFAULT 0`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${aiTokenEventsTable} ADD COLUMN IF NOT EXISTS "source" varchar DEFAULT 'system'`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${aiTokenEventsTable} ADD COLUMN IF NOT EXISTS "reference_id" varchar`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${aiTokenEventsTable} ADD COLUMN IF NOT EXISTS "idempotency_key" varchar`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${aiTokenEventsTable} ADD COLUMN IF NOT EXISTS "meta" jsonb`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${aiTokenEventsTable} ADD COLUMN IF NOT EXISTS "updated_at" timestamptz DEFAULT now()`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${aiTokenEventsTable} ADD COLUMN IF NOT EXISTS "created_at" timestamptz DEFAULT now()`
  );

  await executeRaw(
    payload,
    `CREATE INDEX IF NOT EXISTS "ai_token_events_user_idx" ON ${aiTokenEventsTable} ("user_id")`
  );
  await executeRaw(
    payload,
    `CREATE INDEX IF NOT EXISTS "ai_token_events_job_idx" ON ${aiTokenEventsTable} ("job_id")`
  );
  await executeRaw(
    payload,
    `CREATE INDEX IF NOT EXISTS "ai_token_events_reason_idx" ON ${aiTokenEventsTable} ("reason")`
  );
  await executeRaw(
    payload,
    `CREATE INDEX IF NOT EXISTS "ai_token_events_type_idx" ON ${aiTokenEventsTable} ("type")`
  );
  await executeRaw(
    payload,
    `CREATE INDEX IF NOT EXISTS "ai_token_events_source_idx" ON ${aiTokenEventsTable} ("source")`
  );
  await executeRaw(
    payload,
    `CREATE INDEX IF NOT EXISTS "ai_token_events_idempotency_idx" ON ${aiTokenEventsTable} ("idempotency_key")`
  );
  await executeRaw(
    payload,
    `CREATE INDEX IF NOT EXISTS "ai_token_events_created_at_idx" ON ${aiTokenEventsTable} ("created_at")`
  );
  await executeRaw(
    payload,
    `
      WITH ranked AS (
        SELECT
          "id",
          "idempotency_key",
          ROW_NUMBER() OVER (
            PARTITION BY "idempotency_key"
            ORDER BY "created_at" DESC, "id" DESC
          ) AS rn
        FROM ${aiTokenEventsTable}
        WHERE "idempotency_key" IS NOT NULL
      )
      UPDATE ${aiTokenEventsTable} AS t
      SET "idempotency_key" = NULL
      WHERE t."id" IN (SELECT "id" FROM ranked WHERE rn > 1)
    `
  );
  await executeRaw(
    payload,
    `CREATE UNIQUE INDEX IF NOT EXISTS "ai_token_events_idempotency_uidx" ON ${aiTokenEventsTable} ("idempotency_key") WHERE "idempotency_key" IS NOT NULL`
  );

  await executeRaw(
    payload,
    `
      CREATE TABLE IF NOT EXISTS ${aiJobEventsTable} (
        "id" serial PRIMARY KEY,
        "job_id" integer NOT NULL,
        "user_id" integer NOT NULL,
        "event_type" varchar NOT NULL,
        "status_before" varchar,
        "status_after" varchar,
        "provider" varchar,
        "trace_id" varchar,
        "request_id" varchar,
        "payload" jsonb,
        "updated_at" timestamptz DEFAULT now(),
        "created_at" timestamptz DEFAULT now()
      )
    `
  );

  await executeRaw(
    payload,
    `ALTER TABLE ${aiJobEventsTable} ADD COLUMN IF NOT EXISTS "job_id" integer`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${aiJobEventsTable} ADD COLUMN IF NOT EXISTS "user_id" integer`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${aiJobEventsTable} ADD COLUMN IF NOT EXISTS "event_type" varchar`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${aiJobEventsTable} ADD COLUMN IF NOT EXISTS "status_before" varchar`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${aiJobEventsTable} ADD COLUMN IF NOT EXISTS "status_after" varchar`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${aiJobEventsTable} ADD COLUMN IF NOT EXISTS "provider" varchar`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${aiJobEventsTable} ADD COLUMN IF NOT EXISTS "trace_id" varchar`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${aiJobEventsTable} ADD COLUMN IF NOT EXISTS "request_id" varchar`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${aiJobEventsTable} ADD COLUMN IF NOT EXISTS "payload" jsonb`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${aiJobEventsTable} ADD COLUMN IF NOT EXISTS "updated_at" timestamptz DEFAULT now()`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${aiJobEventsTable} ADD COLUMN IF NOT EXISTS "created_at" timestamptz DEFAULT now()`
  );

  await executeRaw(
    payload,
    `CREATE INDEX IF NOT EXISTS "ai_job_events_job_idx" ON ${aiJobEventsTable} ("job_id")`
  );
  await executeRaw(
    payload,
    `CREATE INDEX IF NOT EXISTS "ai_job_events_user_idx" ON ${aiJobEventsTable} ("user_id")`
  );
  await executeRaw(
    payload,
    `CREATE INDEX IF NOT EXISTS "ai_job_events_event_type_idx" ON ${aiJobEventsTable} ("event_type")`
  );
  await executeRaw(
    payload,
    `CREATE INDEX IF NOT EXISTS "ai_job_events_status_after_idx" ON ${aiJobEventsTable} ("status_after")`
  );
  await executeRaw(
    payload,
    `CREATE INDEX IF NOT EXISTS "ai_job_events_created_at_idx" ON ${aiJobEventsTable} ("created_at")`
  );

  await executeRaw(
    payload,
    `
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
    `
  );

  await executeRaw(
    payload,
    `ALTER TABLE ${aiSubscriptionsTable} ADD COLUMN IF NOT EXISTS "user_id" integer`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${aiSubscriptionsTable} ADD COLUMN IF NOT EXISTS "stripe_customer_id" varchar`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${aiSubscriptionsTable} ADD COLUMN IF NOT EXISTS "stripe_subscription_id" varchar`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${aiSubscriptionsTable} ADD COLUMN IF NOT EXISTS "stripe_price_id" varchar`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${aiSubscriptionsTable} ADD COLUMN IF NOT EXISTS "plan_code" varchar DEFAULT 's'`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${aiSubscriptionsTable} ADD COLUMN IF NOT EXISTS "status" varchar DEFAULT 'incomplete'`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${aiSubscriptionsTable} ADD COLUMN IF NOT EXISTS "current_period_start" timestamptz`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${aiSubscriptionsTable} ADD COLUMN IF NOT EXISTS "current_period_end" timestamptz`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${aiSubscriptionsTable} ADD COLUMN IF NOT EXISTS "cancel_at_period_end" boolean DEFAULT false`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${aiSubscriptionsTable} ADD COLUMN IF NOT EXISTS "last_invoice_id" varchar`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${aiSubscriptionsTable} ADD COLUMN IF NOT EXISTS "meta" jsonb`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${aiSubscriptionsTable} ADD COLUMN IF NOT EXISTS "updated_at" timestamptz DEFAULT now()`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${aiSubscriptionsTable} ADD COLUMN IF NOT EXISTS "created_at" timestamptz DEFAULT now()`
  );

  await executeRaw(
    payload,
    `CREATE INDEX IF NOT EXISTS "ai_subscriptions_user_idx" ON ${aiSubscriptionsTable} ("user_id")`
  );
  await executeRaw(
    payload,
    `CREATE INDEX IF NOT EXISTS "ai_subscriptions_customer_idx" ON ${aiSubscriptionsTable} ("stripe_customer_id")`
  );
  await executeRaw(
    payload,
    `CREATE INDEX IF NOT EXISTS "ai_subscriptions_subscription_idx" ON ${aiSubscriptionsTable} ("stripe_subscription_id")`
  );
  await executeRaw(
    payload,
    `CREATE INDEX IF NOT EXISTS "ai_subscriptions_plan_idx" ON ${aiSubscriptionsTable} ("plan_code")`
  );
  await executeRaw(
    payload,
    `CREATE INDEX IF NOT EXISTS "ai_subscriptions_status_idx" ON ${aiSubscriptionsTable} ("status")`
  );
  await executeRaw(
    payload,
    `CREATE INDEX IF NOT EXISTS "ai_subscriptions_period_end_idx" ON ${aiSubscriptionsTable} ("current_period_end")`
  );

  await executeRaw(
    payload,
    `
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
    `
  );

  await executeRaw(
    payload,
    `ALTER TABLE ${processedWebhooksTable} ADD COLUMN IF NOT EXISTS "provider" varchar DEFAULT 'stripe'`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${processedWebhooksTable} ADD COLUMN IF NOT EXISTS "event_id" varchar`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${processedWebhooksTable} ADD COLUMN IF NOT EXISTS "event_type" varchar DEFAULT 'unknown'`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${processedWebhooksTable} ADD COLUMN IF NOT EXISTS "status" varchar DEFAULT 'processing'`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${processedWebhooksTable} ADD COLUMN IF NOT EXISTS "processed_at" timestamptz`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${processedWebhooksTable} ADD COLUMN IF NOT EXISTS "failure_reason" text`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${processedWebhooksTable} ADD COLUMN IF NOT EXISTS "meta" jsonb`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${processedWebhooksTable} ADD COLUMN IF NOT EXISTS "updated_at" timestamptz DEFAULT now()`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${processedWebhooksTable} ADD COLUMN IF NOT EXISTS "created_at" timestamptz DEFAULT now()`
  );

  await executeRaw(
    payload,
    `CREATE INDEX IF NOT EXISTS "processed_webhooks_provider_idx" ON ${processedWebhooksTable} ("provider")`
  );
  await executeRaw(
    payload,
    `CREATE UNIQUE INDEX IF NOT EXISTS "processed_webhooks_event_id_uidx" ON ${processedWebhooksTable} ("event_id")`
  );
  await executeRaw(
    payload,
    `CREATE INDEX IF NOT EXISTS "processed_webhooks_event_type_idx" ON ${processedWebhooksTable} ("event_type")`
  );
  await executeRaw(
    payload,
    `CREATE INDEX IF NOT EXISTS "processed_webhooks_status_idx" ON ${processedWebhooksTable} ("status")`
  );
  await executeRaw(
    payload,
    `CREATE INDEX IF NOT EXISTS "processed_webhooks_created_at_idx" ON ${processedWebhooksTable} ("created_at")`
  );

  await executeRaw(
    payload,
    `
      CREATE TABLE IF NOT EXISTS ${supportTicketsTable} (
        "id" serial PRIMARY KEY,
        "user_id" integer NOT NULL,
        "status" varchar NOT NULL DEFAULT 'open',
        "priority" varchar NOT NULL DEFAULT 'normal',
        "category" varchar NOT NULL DEFAULT 'other',
        "email" varchar NOT NULL DEFAULT '',
        "name" varchar,
        "title" varchar NOT NULL DEFAULT '',
        "message" text NOT NULL DEFAULT '',
        "admin_reply" text,
        "last_user_message_at" timestamptz,
        "last_admin_reply_at" timestamptz,
        "meta" jsonb,
        "updated_at" timestamptz DEFAULT now(),
        "created_at" timestamptz DEFAULT now()
      )
    `
  );

  await executeRaw(
    payload,
    `ALTER TABLE ${supportTicketsTable} ADD COLUMN IF NOT EXISTS "user_id" integer`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${supportTicketsTable} ADD COLUMN IF NOT EXISTS "status" varchar DEFAULT 'open'`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${supportTicketsTable} ADD COLUMN IF NOT EXISTS "priority" varchar DEFAULT 'normal'`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${supportTicketsTable} ADD COLUMN IF NOT EXISTS "category" varchar DEFAULT 'other'`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${supportTicketsTable} ADD COLUMN IF NOT EXISTS "email" varchar DEFAULT ''`
  );
  await executeRaw(payload, `ALTER TABLE ${supportTicketsTable} ADD COLUMN IF NOT EXISTS "name" varchar`);
  await executeRaw(
    payload,
    `ALTER TABLE ${supportTicketsTable} ADD COLUMN IF NOT EXISTS "title" varchar DEFAULT ''`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${supportTicketsTable} ADD COLUMN IF NOT EXISTS "message" text DEFAULT ''`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${supportTicketsTable} ADD COLUMN IF NOT EXISTS "admin_reply" text`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${supportTicketsTable} ADD COLUMN IF NOT EXISTS "last_user_message_at" timestamptz`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${supportTicketsTable} ADD COLUMN IF NOT EXISTS "last_admin_reply_at" timestamptz`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${supportTicketsTable} ADD COLUMN IF NOT EXISTS "meta" jsonb`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${supportTicketsTable} ADD COLUMN IF NOT EXISTS "updated_at" timestamptz DEFAULT now()`
  );
  await executeRaw(
    payload,
    `ALTER TABLE ${supportTicketsTable} ADD COLUMN IF NOT EXISTS "created_at" timestamptz DEFAULT now()`
  );

  await executeRaw(
    payload,
    `CREATE INDEX IF NOT EXISTS "support_tickets_user_idx" ON ${supportTicketsTable} ("user_id")`
  );
  await executeRaw(
    payload,
    `CREATE INDEX IF NOT EXISTS "support_tickets_status_idx" ON ${supportTicketsTable} ("status")`
  );
  await executeRaw(
    payload,
    `CREATE INDEX IF NOT EXISTS "support_tickets_created_at_idx" ON ${supportTicketsTable} ("created_at")`
  );

  await executeRaw(
    payload,
    `ALTER TABLE ${usersTable} ADD COLUMN IF NOT EXISTS "ai_credits" integer`
  );
  await executeRaw(
    payload,
    `UPDATE ${usersTable} SET "ai_credits" = ${defaultAiCredits} WHERE "ai_credits" IS NULL`
  );

  await ensureLockedDocsColumns(payload, schema);
};
