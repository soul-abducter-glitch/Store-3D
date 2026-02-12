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
  const execute = payload?.db?.execute;
  if (typeof execute !== "function") {
    throw new Error("Payload DB adapter does not support raw SQL execution.");
  }
  return execute({ raw });
};

const ensureLockedDocsColumn = async (payload: PayloadLike, schema: string) => {
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
};

export const ensureAiLabSchema = async (payload: PayloadLike) => {
  const schema = normalizeSchemaName(payload?.db?.schemaName);
  const aiJobsTable = qualifiedTable(schema, "ai_jobs");

  await executeRaw(
    payload,
    `
      CREATE TABLE IF NOT EXISTS ${aiJobsTable} (
        "id" serial PRIMARY KEY,
        "user_id" integer NOT NULL,
        "status" varchar NOT NULL DEFAULT 'queued',
        "mode" varchar NOT NULL DEFAULT 'image',
        "provider" varchar DEFAULT 'mock',
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
    `CREATE INDEX IF NOT EXISTS "ai_jobs_created_at_idx" ON ${aiJobsTable} ("created_at")`
  );

  await ensureLockedDocsColumn(payload, schema);
};
