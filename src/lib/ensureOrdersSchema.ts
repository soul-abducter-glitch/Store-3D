type PayloadLike = {
  db?: {
    execute?: (args: { raw?: string }) => Promise<{ rows?: Array<Record<string, unknown>> }>;
    pool?: { query?: (query: string) => Promise<{ rows?: Array<Record<string, unknown>> }> };
    schemaName?: unknown;
  };
  logger?: {
    warn?: (args: unknown) => void;
  };
};

const normalizeSchemaName = (value: unknown) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return /^[A-Za-z0-9_]+$/.test(trimmed) ? trimmed : null;
};

const quoteIdentifier = (value: string) => `"${value.replace(/"/g, "\"\"")}"`;

const qualifiedTable = (schema: string, table: string) =>
  `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;

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

export const ensureOrdersSchema = async (payload: PayloadLike) => {
  const schemaHint = normalizeSchemaName(payload?.db?.schemaName);
  const schemaRows = await executeRaw(
    payload,
    `
      SELECT n.nspname AS schema_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relname = 'orders_items'
        AND c.relkind IN ('r', 'p')
        AND n.nspname NOT IN ('pg_catalog', 'information_schema')
    `
  );

  const schemasFromDb = Array.isArray(schemaRows?.rows)
    ? schemaRows.rows
        .map((row) => normalizeSchemaName((row as { schema_name?: unknown }).schema_name))
        .filter((value): value is string => Boolean(value))
    : [];

  const schemas = Array.from(new Set([...schemasFromDb, ...(schemaHint ? [schemaHint] : []), "public"]));

  for (const schema of schemas) {
    const regclassResult = await executeRaw(
      payload,
      `SELECT to_regclass('${schema}.orders_items') AS rel`
    );
    if (!regclassResult?.rows?.[0]?.rel) {
      continue;
    }

    const ordersItemsTable = qualifiedTable(schema, "orders_items");
    try {
      await executeRaw(
        payload,
        `ALTER TABLE ${ordersItemsTable} ADD COLUMN IF NOT EXISTS "print_specs_color" varchar`
      );
    } catch (error) {
      payload?.logger?.warn?.({
        msg: "Failed to ensure legacy orders_items.print_specs_color column",
        schema,
        err: error,
      });
    }
  }
};
