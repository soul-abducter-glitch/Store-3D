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
  const aiAssetsTable = qualifiedTable(schema, "ai_assets");

  await db.execute(
    sql.raw(`ALTER TABLE ${aiJobsTable} ADD COLUMN IF NOT EXISTS "parent_job_id" integer`)
  );
  await db.execute(
    sql.raw(`ALTER TABLE ${aiJobsTable} ADD COLUMN IF NOT EXISTS "parent_asset_id" integer`)
  );
  await db.execute(sql.raw(`ALTER TABLE ${aiJobsTable} ADD COLUMN IF NOT EXISTS "input_refs" jsonb`));
  await db.execute(
    sql.raw(
      `CREATE INDEX IF NOT EXISTS "ai_jobs_parent_job_idx" ON ${aiJobsTable} ("parent_job_id")`
    )
  );
  await db.execute(
    sql.raw(
      `CREATE INDEX IF NOT EXISTS "ai_jobs_parent_asset_idx" ON ${aiJobsTable} ("parent_asset_id")`
    )
  );

  await db.execute(
    sql.raw(`ALTER TABLE ${aiAssetsTable} ADD COLUMN IF NOT EXISTS "previous_asset_id" integer`)
  );
  await db.execute(sql.raw(`ALTER TABLE ${aiAssetsTable} ADD COLUMN IF NOT EXISTS "family_id" varchar`));
  await db.execute(
    sql.raw(`ALTER TABLE ${aiAssetsTable} ADD COLUMN IF NOT EXISTS "version" integer DEFAULT 1`)
  );
  await db.execute(
    sql.raw(
      `CREATE INDEX IF NOT EXISTS "ai_assets_previous_asset_idx" ON ${aiAssetsTable} ("previous_asset_id")`
    )
  );
  await db.execute(
    sql.raw(
      `CREATE INDEX IF NOT EXISTS "ai_assets_family_id_idx" ON ${aiAssetsTable} ("family_id")`
    )
  );
}

export async function down({ payload }: MigrateDownArgs): Promise<void> {
  payload.logger.info({
    msg: "down migration for ai stage2 relation fields is intentionally a no-op to prevent data loss",
  });
}

