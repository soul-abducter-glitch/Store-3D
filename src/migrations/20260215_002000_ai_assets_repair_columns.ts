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

  await db.execute(sql.raw(`ALTER TABLE ${aiAssetsTable} ADD COLUMN IF NOT EXISTS "checks" jsonb`));
  await db.execute(sql.raw(`ALTER TABLE ${aiAssetsTable} ADD COLUMN IF NOT EXISTS "repair_logs" jsonb`));
}

export async function down({ payload }: MigrateDownArgs): Promise<void> {
  payload.logger.info({
    msg: "down migration for ai asset repair columns is intentionally a no-op to prevent data loss",
  });
}
