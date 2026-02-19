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

  await db.execute(
    sql.raw(`ALTER TABLE ${aiAssetsTable} ADD COLUMN IF NOT EXISTS "version_label" varchar DEFAULT 'original'`)
  );
  await db.execute(sql.raw(`ALTER TABLE ${aiAssetsTable} ADD COLUMN IF NOT EXISTS "split_part_set" jsonb`));
  await db.execute(sql.raw(`ALTER TABLE ${aiAssetsTable} ADD COLUMN IF NOT EXISTS "pipeline_jobs" jsonb`));
  await db.execute(
    sql.raw(`CREATE INDEX IF NOT EXISTS "ai_assets_version_label_idx" ON ${aiAssetsTable} ("version_label")`)
  );
}

export async function down({ payload }: MigrateDownArgs): Promise<void> {
  payload.logger.info({
    msg: "down migration for ai asset pipeline columns is intentionally a no-op to prevent data loss",
  });
}
