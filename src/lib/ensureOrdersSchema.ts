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
      WHERE c.relname IN ('orders_items', 'orders')
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
  const legacyPrintSpecColumns: Array<{ name: string; sqlType: string }> = [
    { name: "print_specs_technology", sqlType: "varchar" },
    { name: "print_specs_material", sqlType: "varchar" },
    { name: "print_specs_color", sqlType: "varchar" },
    { name: "print_specs_quality", sqlType: "varchar" },
    { name: "print_specs_note", sqlType: "text" },
    { name: "print_specs_packaging", sqlType: "varchar" },
    { name: "print_specs_dimensions_x", sqlType: "numeric" },
    { name: "print_specs_dimensions_y", sqlType: "numeric" },
    { name: "print_specs_dimensions_z", sqlType: "numeric" },
    { name: "print_specs_volume_cm3", sqlType: "numeric" },
    { name: "print_specs_is_hollow", sqlType: "boolean" },
    { name: "print_specs_infill_percent", sqlType: "numeric" },
  ];
  const legacyTechnicalSpecColumns: Array<{ name: string; sqlType: string }> = [
    { name: "technical_specs_technology", sqlType: "varchar" },
    { name: "technical_specs_material", sqlType: "varchar" },
    { name: "technical_specs_color", sqlType: "varchar" },
    { name: "technical_specs_quality", sqlType: "varchar" },
    { name: "technical_specs_note", sqlType: "text" },
    { name: "technical_specs_packaging", sqlType: "varchar" },
    { name: "technical_specs_dimensions_x", sqlType: "numeric" },
    { name: "technical_specs_dimensions_y", sqlType: "numeric" },
    { name: "technical_specs_dimensions_z", sqlType: "numeric" },
    { name: "technical_specs_volume_cm3", sqlType: "numeric" },
  ];

  for (const schema of schemas) {
    const ordersRegclassResult = await executeRaw(
      payload,
      `SELECT to_regclass('${schema}.orders') AS rel`
    );
    if (ordersRegclassResult?.rows?.[0]?.rel) {
      const ordersTable = qualifiedTable(schema, "orders");
      for (const column of legacyTechnicalSpecColumns) {
        try {
          await executeRaw(
            payload,
            `ALTER TABLE ${ordersTable} ADD COLUMN IF NOT EXISTS "${column.name}" ${column.sqlType}`
          );
        } catch (error) {
          payload?.logger?.warn?.({
            msg: "Failed to ensure legacy orders technical_specs column",
            schema,
            column: column.name,
            err: error,
          });
        }
      }
    }

    const regclassResult = await executeRaw(
      payload,
      `SELECT to_regclass('${schema}.orders_items') AS rel`
    );
    if (!regclassResult?.rows?.[0]?.rel) {
      continue;
    }

    const ordersItemsTable = qualifiedTable(schema, "orders_items");
    for (const column of legacyPrintSpecColumns) {
      try {
        await executeRaw(
          payload,
          `ALTER TABLE ${ordersItemsTable} ADD COLUMN IF NOT EXISTS "${column.name}" ${column.sqlType}`
        );
      } catch (error) {
        payload?.logger?.warn?.({
          msg: "Failed to ensure legacy orders_items print_specs column",
          schema,
          column: column.name,
          err: error,
        });
      }
    }
  }
};
