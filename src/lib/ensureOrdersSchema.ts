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
  if (typeof value !== "string") return "public";
  const trimmed = value.trim();
  if (!trimmed) return "public";
  return /^[A-Za-z0-9_]+$/.test(trimmed) ? trimmed : "public";
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
  const schema = normalizeSchemaName(payload?.db?.schemaName);
  const ordersItemsTable = qualifiedTable(schema, "orders_items");
  const ordersItemsRegclass = `${schema}.orders_items`;

  const existingTable = await executeRaw(
    payload,
    `SELECT to_regclass('${ordersItemsRegclass}') AS rel`
  );
  if (!existingTable?.rows?.[0]?.rel) {
    return;
  }

  try {
    await executeRaw(
      payload,
      `ALTER TABLE ${ordersItemsTable} ADD COLUMN IF NOT EXISTS "print_specs_color" varchar`
    );
  } catch (error) {
    payload?.logger?.warn?.({
      msg: "Failed to ensure legacy orders_items.print_specs_color column",
      err: error,
    });
  }
};
