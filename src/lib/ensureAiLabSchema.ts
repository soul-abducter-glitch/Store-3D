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
};

export const ensureAiLabSchema = async (payload: PayloadLike) => {
  const schema = normalizeSchemaName(payload?.db?.schemaName);
  const aiJobsTable = qualifiedTable(schema, "ai_jobs");
  const aiAssetsTable = qualifiedTable(schema, "ai_assets");
  const aiTokenEventsTable = qualifiedTable(schema, "ai_token_events");
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
        "status" varchar NOT NULL DEFAULT 'queued',
        "mode" varchar NOT NULL DEFAULT 'image',
        "provider" varchar DEFAULT 'mock',
        "provider_job_id" varchar,
        "progress" numeric NOT NULL DEFAULT 0,
        "prompt" text NOT NULL DEFAULT '',
        "source_type" varchar DEFAULT 'none',
        "source_url" text,
        "error_message" text,
        "result_model_url" text,
        "result_preview_url" text,
        "result_format" varchar DEFAULT 'unknown',
        "started_at" timestamptz,
        "completed_at" timestamptz,
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
  await executeRaw(
    payload,
    `ALTER TABLE ${aiJobsTable} ADD COLUMN IF NOT EXISTS "error_message" text`
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
    `CREATE INDEX IF NOT EXISTS "ai_jobs_status_idx" ON ${aiJobsTable} ("status")`
  );
  await executeRaw(
    payload,
    `CREATE INDEX IF NOT EXISTS "ai_jobs_provider_job_id_idx" ON ${aiJobsTable} ("provider_job_id")`
  );
  await executeRaw(
    payload,
    `CREATE INDEX IF NOT EXISTS "ai_jobs_created_at_idx" ON ${aiJobsTable} ("created_at")`
  );

  await executeRaw(
    payload,
    `
      CREATE TABLE IF NOT EXISTS ${aiAssetsTable} (
        "id" serial PRIMARY KEY,
        "user_id" integer NOT NULL,
        "job_id" integer,
        "status" varchar NOT NULL DEFAULT 'ready',
        "provider" varchar DEFAULT 'mock',
        "title" varchar NOT NULL DEFAULT '',
        "prompt" text,
        "source_type" varchar DEFAULT 'none',
        "source_url" text,
        "preview_url" text,
        "model_url" text NOT NULL DEFAULT '',
        "format" varchar NOT NULL DEFAULT 'unknown',
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
    `CREATE INDEX IF NOT EXISTS "ai_assets_created_at_idx" ON ${aiAssetsTable} ("created_at")`
  );

  await executeRaw(
    payload,
    `
      CREATE TABLE IF NOT EXISTS ${aiTokenEventsTable} (
        "id" serial PRIMARY KEY,
        "user_id" integer NOT NULL,
        "reason" varchar NOT NULL DEFAULT 'adjust',
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
    `ALTER TABLE ${aiTokenEventsTable} ADD COLUMN IF NOT EXISTS "reason" varchar DEFAULT 'adjust'`
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
    `CREATE INDEX IF NOT EXISTS "ai_token_events_reason_idx" ON ${aiTokenEventsTable} ("reason")`
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
    `ALTER TABLE ${usersTable} ADD COLUMN IF NOT EXISTS "ai_credits" integer`
  );
  await executeRaw(
    payload,
    `UPDATE ${usersTable} SET "ai_credits" = ${defaultAiCredits} WHERE "ai_credits" IS NULL`
  );

  await ensureLockedDocsColumns(payload, schema);
};
