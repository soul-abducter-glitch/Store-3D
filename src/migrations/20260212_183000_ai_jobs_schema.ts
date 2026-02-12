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
  const aiJobsTable = qualifiedTable(schema, "ai_jobs");
  const lockRelsTable = qualifiedTable(schema, "payload_locked_documents_rels");

  await db.execute(sql.raw(`
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
  `));

  await db.execute(sql.raw(`ALTER TABLE ${aiJobsTable} ADD COLUMN IF NOT EXISTS "user_id" integer`));
  await db.execute(
    sql.raw(`ALTER TABLE ${aiJobsTable} ADD COLUMN IF NOT EXISTS "status" varchar DEFAULT 'queued'`)
  );
  await db.execute(
    sql.raw(`ALTER TABLE ${aiJobsTable} ADD COLUMN IF NOT EXISTS "mode" varchar DEFAULT 'image'`)
  );
  await db.execute(
    sql.raw(`ALTER TABLE ${aiJobsTable} ADD COLUMN IF NOT EXISTS "provider" varchar DEFAULT 'mock'`)
  );
  await db.execute(
    sql.raw(`ALTER TABLE ${aiJobsTable} ADD COLUMN IF NOT EXISTS "progress" numeric DEFAULT 0`)
  );
  await db.execute(sql.raw(`ALTER TABLE ${aiJobsTable} ADD COLUMN IF NOT EXISTS "prompt" text DEFAULT ''`));
  await db.execute(
    sql.raw(`ALTER TABLE ${aiJobsTable} ADD COLUMN IF NOT EXISTS "source_type" varchar DEFAULT 'none'`)
  );
  await db.execute(sql.raw(`ALTER TABLE ${aiJobsTable} ADD COLUMN IF NOT EXISTS "source_url" text`));
  await db.execute(sql.raw(`ALTER TABLE ${aiJobsTable} ADD COLUMN IF NOT EXISTS "error_message" text`));
  await db.execute(
    sql.raw(`ALTER TABLE ${aiJobsTable} ADD COLUMN IF NOT EXISTS "result_model_url" text`)
  );
  await db.execute(
    sql.raw(`ALTER TABLE ${aiJobsTable} ADD COLUMN IF NOT EXISTS "result_preview_url" text`)
  );
  await db.execute(
    sql.raw(
      `ALTER TABLE ${aiJobsTable} ADD COLUMN IF NOT EXISTS "result_format" varchar DEFAULT 'unknown'`
    )
  );
  await db.execute(sql.raw(`ALTER TABLE ${aiJobsTable} ADD COLUMN IF NOT EXISTS "started_at" timestamptz`));
  await db.execute(
    sql.raw(`ALTER TABLE ${aiJobsTable} ADD COLUMN IF NOT EXISTS "completed_at" timestamptz`)
  );
  await db.execute(
    sql.raw(`ALTER TABLE ${aiJobsTable} ADD COLUMN IF NOT EXISTS "updated_at" timestamptz DEFAULT now()`)
  );
  await db.execute(
    sql.raw(`ALTER TABLE ${aiJobsTable} ADD COLUMN IF NOT EXISTS "created_at" timestamptz DEFAULT now()`)
  );

  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS "ai_jobs_user_idx" ON ${aiJobsTable} ("user_id")`));
  await db.execute(
    sql.raw(`CREATE INDEX IF NOT EXISTS "ai_jobs_status_idx" ON ${aiJobsTable} ("status")`)
  );
  await db.execute(
    sql.raw(`CREATE INDEX IF NOT EXISTS "ai_jobs_created_at_idx" ON ${aiJobsTable} ("created_at")`)
  );

  await db.execute(sql.raw(`
    DO $$
    BEGIN
      IF to_regclass('${schema}.payload_locked_documents_rels') IS NOT NULL THEN
        ALTER TABLE ${lockRelsTable} ADD COLUMN IF NOT EXISTS "ai_jobs_id" integer;
      END IF;
    END $$;
  `));
}

export async function down({ payload }: MigrateDownArgs): Promise<void> {
  payload.logger.info({
    msg: "down migration for ai_jobs schema is intentionally a no-op to prevent data loss",
  });
}
