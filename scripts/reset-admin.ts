import fs from "fs";
import path from "path";

import { getPayload } from "payload";

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

const email = process.env.RESET_EMAIL;
const password = process.env.RESET_PASSWORD;

if (!email || !password) {
  console.error("Missing RESET_EMAIL or RESET_PASSWORD.");
  process.exit(1);
}

const run = async () => {
  const { default: payloadConfig } = await import("../payload.config");
  const payload = await getPayload({ config: payloadConfig });

  const existing = await payload.find({
    collection: "users",
    limit: 1,
    overrideAccess: true,
    where: {
      email: {
        equals: email,
      },
    },
  });

  if (existing.docs.length > 0) {
    await payload.update({
      collection: "users",
      data: {
        password,
      },
      id: existing.docs[0].id,
      overrideAccess: true,
    });
    console.log(`Password updated for ${email}`);
  } else {
    await payload.create({
      collection: "users",
      data: {
        email,
        password,
      },
      overrideAccess: true,
    });
    console.log(`User created for ${email}`);
  }

  if (typeof payload.db?.destroy === "function") {
    await payload.db.destroy();
  }
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
