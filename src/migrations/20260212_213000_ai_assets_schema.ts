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
  const aiAssetsTable = qualifiedTable(schema, "ai_assets");
  const lockRelsTable = qualifiedTable(schema, "payload_locked_documents_rels");

  await db.execute(sql.raw(`
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
  `));

  await db.execute(sql.raw(`ALTER TABLE ${aiAssetsTable} ADD COLUMN IF NOT EXISTS "user_id" integer`));
  await db.execute(sql.raw(`ALTER TABLE ${aiAssetsTable} ADD COLUMN IF NOT EXISTS "job_id" integer`));
  await db.execute(
    sql.raw(`ALTER TABLE ${aiAssetsTable} ADD COLUMN IF NOT EXISTS "status" varchar DEFAULT 'ready'`)
  );
  await db.execute(
    sql.raw(`ALTER TABLE ${aiAssetsTable} ADD COLUMN IF NOT EXISTS "provider" varchar DEFAULT 'mock'`)
  );
  await db.execute(sql.raw(`ALTER TABLE ${aiAssetsTable} ADD COLUMN IF NOT EXISTS "title" varchar DEFAULT ''`));
  await db.execute(sql.raw(`ALTER TABLE ${aiAssetsTable} ADD COLUMN IF NOT EXISTS "prompt" text`));
  await db.execute(
    sql.raw(`ALTER TABLE ${aiAssetsTable} ADD COLUMN IF NOT EXISTS "source_type" varchar DEFAULT 'none'`)
  );
  await db.execute(sql.raw(`ALTER TABLE ${aiAssetsTable} ADD COLUMN IF NOT EXISTS "source_url" text`));
  await db.execute(sql.raw(`ALTER TABLE ${aiAssetsTable} ADD COLUMN IF NOT EXISTS "preview_url" text`));
  await db.execute(sql.raw(`ALTER TABLE ${aiAssetsTable} ADD COLUMN IF NOT EXISTS "model_url" text DEFAULT ''`));
  await db.execute(
    sql.raw(`ALTER TABLE ${aiAssetsTable} ADD COLUMN IF NOT EXISTS "format" varchar DEFAULT 'unknown'`)
  );
  await db.execute(
    sql.raw(`ALTER TABLE ${aiAssetsTable} ADD COLUMN IF NOT EXISTS "updated_at" timestamptz DEFAULT now()`)
  );
  await db.execute(
    sql.raw(`ALTER TABLE ${aiAssetsTable} ADD COLUMN IF NOT EXISTS "created_at" timestamptz DEFAULT now()`)
  );

  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS "ai_assets_user_idx" ON ${aiAssetsTable} ("user_id")`));
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS "ai_assets_job_idx" ON ${aiAssetsTable} ("job_id")`));
  await db.execute(
    sql.raw(`CREATE INDEX IF NOT EXISTS "ai_assets_created_at_idx" ON ${aiAssetsTable} ("created_at")`)
  );

  await db.execute(sql.raw(`
    DO $$
    BEGIN
      IF to_regclass('${schema}.payload_locked_documents_rels') IS NOT NULL THEN
        ALTER TABLE ${lockRelsTable} ADD COLUMN IF NOT EXISTS "ai_assets_id" integer;
      END IF;
    END $$;
  `));
}

export async function down({ payload }: MigrateDownArgs): Promise<void> {
  payload.logger.info({
    msg: "down migration for ai_assets schema is intentionally a no-op to prevent data loss",
  });
}
