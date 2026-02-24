type PayloadLike = {
  db?: {
    execute?: (args: { raw?: string }) => Promise<{ rows?: Array<Record<string, unknown>> }>;
    pool?: { query?: (query: string) => Promise<{ rows?: Array<Record<string, unknown>> }> };
    schemaName?: string;
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
  const db = payload?.db;
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

const tableExists = async (payload: PayloadLike, schema: string, table: string) => {
  const regclass = toRegclassLiteral(schema, table);
  const result = await executeRaw(payload, `SELECT to_regclass('${regclass}') AS rel`);
  return Boolean(result?.rows?.[0]?.rel);
};

export const ensureCatalogSchema = async (payload: PayloadLike) => {
  const schema = normalizeSchemaName(payload?.db?.schemaName);
  const mediaTable = qualifiedTable(schema, "media");
  const productsTable = qualifiedTable(schema, "products");

  if (await tableExists(payload, schema, "media")) {
    await executeRaw(payload, `ALTER TABLE ${mediaTable} ADD COLUMN IF NOT EXISTS "alt" text`);
    await executeRaw(payload, `ALTER TABLE ${mediaTable} ADD COLUMN IF NOT EXISTS "file_type" varchar`);
    await executeRaw(
      payload,
      `ALTER TABLE ${mediaTable} ADD COLUMN IF NOT EXISTS "is_customer_upload" boolean DEFAULT false`
    );
    await executeRaw(payload, `ALTER TABLE ${mediaTable} ADD COLUMN IF NOT EXISTS "owner_user_id" integer`);
    await executeRaw(payload, `ALTER TABLE ${mediaTable} ADD COLUMN IF NOT EXISTS "owner_email" varchar`);
    await executeRaw(payload, `ALTER TABLE ${mediaTable} ADD COLUMN IF NOT EXISTS "owner_session_hash" varchar`);
    await executeRaw(payload, `ALTER TABLE ${mediaTable} ADD COLUMN IF NOT EXISTS "prefix" varchar`);
    await executeRaw(payload, `ALTER TABLE ${mediaTable} ADD COLUMN IF NOT EXISTS "filename" varchar`);
    await executeRaw(payload, `ALTER TABLE ${mediaTable} ADD COLUMN IF NOT EXISTS "mime_type" varchar`);
    await executeRaw(payload, `ALTER TABLE ${mediaTable} ADD COLUMN IF NOT EXISTS "filesize" numeric`);
    await executeRaw(payload, `ALTER TABLE ${mediaTable} ADD COLUMN IF NOT EXISTS "width" numeric`);
    await executeRaw(payload, `ALTER TABLE ${mediaTable} ADD COLUMN IF NOT EXISTS "height" numeric`);
    await executeRaw(payload, `ALTER TABLE ${mediaTable} ADD COLUMN IF NOT EXISTS "focal_x" numeric`);
    await executeRaw(payload, `ALTER TABLE ${mediaTable} ADD COLUMN IF NOT EXISTS "focal_y" numeric`);
    await executeRaw(payload, `ALTER TABLE ${mediaTable} ADD COLUMN IF NOT EXISTS "url" text`);
    await executeRaw(payload, `ALTER TABLE ${mediaTable} ADD COLUMN IF NOT EXISTS "thumbnail_url" text`);
    await executeRaw(
      payload,
      `ALTER TABLE ${mediaTable} ADD COLUMN IF NOT EXISTS "updated_at" timestamptz DEFAULT now()`
    );
    await executeRaw(
      payload,
      `ALTER TABLE ${mediaTable} ADD COLUMN IF NOT EXISTS "created_at" timestamptz DEFAULT now()`
    );
  }

  if (await tableExists(payload, schema, "products")) {
    await executeRaw(payload, `ALTER TABLE ${productsTable} ADD COLUMN IF NOT EXISTS "raw_model_id" integer`);
    await executeRaw(payload, `ALTER TABLE ${productsTable} ADD COLUMN IF NOT EXISTS "painted_model_id" integer`);
    await executeRaw(payload, `ALTER TABLE ${productsTable} ADD COLUMN IF NOT EXISTS "thumbnail_id" integer`);
    await executeRaw(
      payload,
      `ALTER TABLE ${productsTable} ADD COLUMN IF NOT EXISTS "updated_at" timestamptz DEFAULT now()`
    );
    await executeRaw(
      payload,
      `ALTER TABLE ${productsTable} ADD COLUMN IF NOT EXISTS "created_at" timestamptz DEFAULT now()`
    );
  }
};
