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
  const supportTicketsTable = qualifiedTable(schema, "support_tickets");
  const lockRelsTable = qualifiedTable(schema, "payload_locked_documents_rels");

  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS ${supportTicketsTable} (
      "id" serial PRIMARY KEY,
      "user_id" integer NOT NULL,
      "status" varchar NOT NULL DEFAULT 'open',
      "priority" varchar NOT NULL DEFAULT 'normal',
      "category" varchar NOT NULL DEFAULT 'other',
      "email" varchar NOT NULL DEFAULT '',
      "name" varchar,
      "title" varchar NOT NULL DEFAULT '',
      "message" text NOT NULL DEFAULT '',
      "admin_reply" text,
      "last_user_message_at" timestamptz,
      "last_admin_reply_at" timestamptz,
      "meta" jsonb,
      "updated_at" timestamptz DEFAULT now(),
      "created_at" timestamptz DEFAULT now()
    )
  `));

  await db.execute(sql.raw(`ALTER TABLE ${supportTicketsTable} ADD COLUMN IF NOT EXISTS "user_id" integer`));
  await db.execute(sql.raw(`ALTER TABLE ${supportTicketsTable} ADD COLUMN IF NOT EXISTS "status" varchar DEFAULT 'open'`));
  await db.execute(sql.raw(`ALTER TABLE ${supportTicketsTable} ADD COLUMN IF NOT EXISTS "priority" varchar DEFAULT 'normal'`));
  await db.execute(sql.raw(`ALTER TABLE ${supportTicketsTable} ADD COLUMN IF NOT EXISTS "category" varchar DEFAULT 'other'`));
  await db.execute(sql.raw(`ALTER TABLE ${supportTicketsTable} ADD COLUMN IF NOT EXISTS "email" varchar DEFAULT ''`));
  await db.execute(sql.raw(`ALTER TABLE ${supportTicketsTable} ADD COLUMN IF NOT EXISTS "name" varchar`));
  await db.execute(sql.raw(`ALTER TABLE ${supportTicketsTable} ADD COLUMN IF NOT EXISTS "title" varchar DEFAULT ''`));
  await db.execute(sql.raw(`ALTER TABLE ${supportTicketsTable} ADD COLUMN IF NOT EXISTS "message" text DEFAULT ''`));
  await db.execute(sql.raw(`ALTER TABLE ${supportTicketsTable} ADD COLUMN IF NOT EXISTS "admin_reply" text`));
  await db.execute(sql.raw(`ALTER TABLE ${supportTicketsTable} ADD COLUMN IF NOT EXISTS "last_user_message_at" timestamptz`));
  await db.execute(sql.raw(`ALTER TABLE ${supportTicketsTable} ADD COLUMN IF NOT EXISTS "last_admin_reply_at" timestamptz`));
  await db.execute(sql.raw(`ALTER TABLE ${supportTicketsTable} ADD COLUMN IF NOT EXISTS "meta" jsonb`));
  await db.execute(sql.raw(`ALTER TABLE ${supportTicketsTable} ADD COLUMN IF NOT EXISTS "updated_at" timestamptz DEFAULT now()`));
  await db.execute(sql.raw(`ALTER TABLE ${supportTicketsTable} ADD COLUMN IF NOT EXISTS "created_at" timestamptz DEFAULT now()`));

  await db.execute(
    sql.raw(`CREATE INDEX IF NOT EXISTS "support_tickets_user_idx" ON ${supportTicketsTable} ("user_id")`)
  );
  await db.execute(
    sql.raw(`CREATE INDEX IF NOT EXISTS "support_tickets_status_idx" ON ${supportTicketsTable} ("status")`)
  );
  await db.execute(
    sql.raw(
      `CREATE INDEX IF NOT EXISTS "support_tickets_created_at_idx" ON ${supportTicketsTable} ("created_at")`
    )
  );

  await db.execute(sql.raw(`
    DO $$
    BEGIN
      IF to_regclass('${schema}.payload_locked_documents_rels') IS NOT NULL THEN
        ALTER TABLE ${lockRelsTable} ADD COLUMN IF NOT EXISTS "support_tickets_id" integer;
      END IF;
    END $$;
  `));
}

export async function down({ payload }: MigrateDownArgs): Promise<void> {
  payload.logger.info({
    msg: "down migration for support_tickets schema is intentionally a no-op to prevent data loss",
  });
}

