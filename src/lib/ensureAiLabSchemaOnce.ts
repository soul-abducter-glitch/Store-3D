import { ensureAiLabSchema } from "./ensureAiLabSchema";

type PayloadLike = Parameters<typeof ensureAiLabSchema>[0];

let ensurePromise: Promise<void> | null = null;

export const ensureAiLabSchemaOnce = async (payload: PayloadLike) => {
  if (!ensurePromise) {
    ensurePromise = ensureAiLabSchema(payload).catch((error) => {
      ensurePromise = null;
      throw error;
    });
  }
  await ensurePromise;
};

