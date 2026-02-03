import fs from "fs";
import path from "path";
import { Client } from "pg";

const envPath = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const idx = line.indexOf("=");
    if (idx === -1) {
      continue;
    }
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is missing.");
}

const run = async () => {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();

  const values = ["yandex", "ozon", "pochta", "pickup"];
  for (const value of values) {
    await client.query(
      `ALTER TYPE enum_orders_shipping_method ADD VALUE IF NOT EXISTS '${value}'`
    );
  }

  await client.end();
  console.log("Shipping method enum updated.");
};

run().catch((error) => {
  console.error("Failed to update shipping enum:", error);
  process.exit(1);
});
