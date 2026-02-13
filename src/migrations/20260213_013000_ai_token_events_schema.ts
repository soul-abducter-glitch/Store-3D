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
  const aiTokenEventsTable = qualifiedTable(schema, "ai_token_events");
  const lockRelsTable = qualifiedTable(schema, "payload_locked_documents_rels");

  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS ${aiTokenEventsTable} (
      "id" serial PRIMARY KEY,
      "user_id" integer NOT NULL,
      "reason" varchar NOT NULL DEFAULT 'adjust',
      "delta" integer NOT NULL DEFAULT 0,
      "balance_after" integer NOT NULL DEFAULT 0,
      "source" varchar NOT NULL DEFAULT 'system',
      "reference_id" varchar,
      "idempotency_key" varchar,
      "meta" jsonb,
      "updated_at" timestamptz DEFAULT now(),
      "created_at" timestamptz DEFAULT now()
    )
  `));

  await db.execute(sql.raw(`ALTER TABLE ${aiTokenEventsTable} ADD COLUMN IF NOT EXISTS "user_id" integer`));
  await db.execute(
    sql.raw(`ALTER TABLE ${aiTokenEventsTable} ADD COLUMN IF NOT EXISTS "reason" varchar DEFAULT 'adjust'`)
  );
  await db.execute(sql.raw(`ALTER TABLE ${aiTokenEventsTable} ADD COLUMN IF NOT EXISTS "delta" integer DEFAULT 0`));
  await db.execute(
    sql.raw(`ALTER TABLE ${aiTokenEventsTable} ADD COLUMN IF NOT EXISTS "balance_after" integer DEFAULT 0`)
  );
  await db.execute(
    sql.raw(`ALTER TABLE ${aiTokenEventsTable} ADD COLUMN IF NOT EXISTS "source" varchar DEFAULT 'system'`)
  );
  await db.execute(sql.raw(`ALTER TABLE ${aiTokenEventsTable} ADD COLUMN IF NOT EXISTS "reference_id" varchar`));
  await db.execute(
    sql.raw(`ALTER TABLE ${aiTokenEventsTable} ADD COLUMN IF NOT EXISTS "idempotency_key" varchar`)
  );
  await db.execute(sql.raw(`ALTER TABLE ${aiTokenEventsTable} ADD COLUMN IF NOT EXISTS "meta" jsonb`));
  await db.execute(
    sql.raw(`ALTER TABLE ${aiTokenEventsTable} ADD COLUMN IF NOT EXISTS "updated_at" timestamptz DEFAULT now()`)
  );
  await db.execute(
    sql.raw(`ALTER TABLE ${aiTokenEventsTable} ADD COLUMN IF NOT EXISTS "created_at" timestamptz DEFAULT now()`)
  );

  await db.execute(
    sql.raw(`CREATE INDEX IF NOT EXISTS "ai_token_events_user_idx" ON ${aiTokenEventsTable} ("user_id")`)
  );
  await db.execute(
    sql.raw(`CREATE INDEX IF NOT EXISTS "ai_token_events_reason_idx" ON ${aiTokenEventsTable} ("reason")`)
  );
  await db.execute(
    sql.raw(`CREATE INDEX IF NOT EXISTS "ai_token_events_source_idx" ON ${aiTokenEventsTable} ("source")`)
  );
  await db.execute(
    sql.raw(
      `CREATE INDEX IF NOT EXISTS "ai_token_events_idempotency_idx" ON ${aiTokenEventsTable} ("idempotency_key")`
    )
  );
  await db.execute(
    sql.raw(
      `CREATE INDEX IF NOT EXISTS "ai_token_events_created_at_idx" ON ${aiTokenEventsTable} ("created_at")`
    )
  );

  await db.execute(sql.raw(`
    DO $$
    BEGIN
      IF to_regclass('${schema}.payload_locked_documents_rels') IS NOT NULL THEN
        ALTER TABLE ${lockRelsTable} ADD COLUMN IF NOT EXISTS "ai_token_events_id" integer;
      END IF;
    END $$;
  `));
}

export async function down({ payload }: MigrateDownArgs): Promise<void> {
  payload.logger.info({
    msg: "down migration for ai_token_events schema is intentionally a no-op to prevent data loss",
  });
}
