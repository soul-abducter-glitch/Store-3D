import fs from "fs";
import path from "path";

import { getPayload } from "payload";

type CategoryDoc = {
  id: string | number;
  name?: string | null;
  slug?: string | null;
  parent?: string | number | null;
};

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

const findCategory = async (
  payload: any,
  {
    slug,
    names = [],
  }: {
    slug: string;
    names?: string[];
  }
): Promise<CategoryDoc | null> => {
  const whereOr = [
    { slug: { equals: slug } },
    ...names.map((name) => ({ name: { equals: name } })),
  ];
  const result = await payload.find({
    collection: "categories",
    depth: 0,
    limit: 1,
    overrideAccess: true,
    where: {
      or: whereOr,
    },
  });
  return (result?.docs?.[0] as CategoryDoc) ?? null;
};

const upsertCategory = async (
  payload: any,
  {
    name,
    slug,
    parentId,
    matchNames = [],
  }: {
    name: string;
    slug: string;
    parentId?: string | number | null;
    matchNames?: string[];
  }
) => {
  const existing = await findCategory(payload, { slug, names: matchNames });
  if (existing?.id) {
    const data: Record<string, unknown> = { name, slug };
    if (parentId !== undefined) {
      data.parent = parentId;
    }
    await payload.update({
      collection: "categories",
      id: existing.id as any,
      data,
      overrideAccess: true,
    });
    return existing.id;
  }
  const created = await payload.create({
    collection: "categories",
    data: {
      name,
      slug,
      ...(parentId ? { parent: parentId } : {}),
    },
    overrideAccess: true,
  });
  return created?.id as string | number;
};

const run = async () => {
  const configUrl = new URL("../payload.config.simple.ts", import.meta.url);
  const { default: payloadConfig } = await import(configUrl.href);
  const payload = await getPayload({ config: payloadConfig });

  const animeId = await upsertCategory(payload, {
    name: "Аниме",
    slug: "anime",
    matchNames: ["Аниме", "Anime"],
  });

  const animeGirlsId = await upsertCategory(payload, {
    name: "Аниме девушки",
    slug: "anime-girls",
    parentId: animeId ?? null,
    matchNames: ["Аниме девушки", "Аеиме девушки", "Anime girls", "anime+girl"],
  });

  console.log("Anime category id:", animeId);
  console.log("Anime girls category id:", animeGirlsId);

  if (typeof payload.db?.destroy === "function") {
    await payload.db.destroy();
  }
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
