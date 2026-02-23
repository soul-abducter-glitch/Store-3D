import { randomBytes } from "crypto";

type PairSession = {
  code: string;
  userId: string;
  token: string;
  createdAtMs: number;
  expiresAtMs: number;
  consumedAtMs: number | null;
};

type PairStore = {
  sessionsByCode: Map<string, PairSession>;
};

const DEFAULT_TTL_MS = 10 * 60 * 1000;
const MAX_ACTIVE_CODES_PER_USER = 3;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_PATTERN = /^[A-Z2-9]{4}-[A-Z2-9]{4}$/;

const getStore = (): PairStore => {
  const scope = globalThis as typeof globalThis & {
    __store3dBlenderPairingStore?: PairStore;
  };
  if (!scope.__store3dBlenderPairingStore) {
    scope.__store3dBlenderPairingStore = {
      sessionsByCode: new Map<string, PairSession>(),
    };
  }
  return scope.__store3dBlenderPairingStore;
};

const now = () => Date.now();

const normalizeCode = (value: string) => value.trim().toUpperCase();

const isExpired = (session: PairSession, atMs = now()) => session.expiresAtMs <= atMs;

const cleanupExpiredSessions = (atMs = now()) => {
  const store = getStore();
  for (const [code, session] of store.sessionsByCode.entries()) {
    if (isExpired(session, atMs) || session.consumedAtMs !== null) {
      store.sessionsByCode.delete(code);
    }
  }
};

const generateCode = () => {
  const bytes = randomBytes(8);
  let out = "";
  for (let i = 0; i < 8; i += 1) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return `${out.slice(0, 4)}-${out.slice(4, 8)}`;
};

const trimSessionsForUser = (userId: string) => {
  const store = getStore();
  const active = Array.from(store.sessionsByCode.values())
    .filter((item) => item.userId === userId && !isExpired(item) && item.consumedAtMs === null)
    .sort((a, b) => a.createdAtMs - b.createdAtMs);

  while (active.length >= MAX_ACTIVE_CODES_PER_USER) {
    const oldest = active.shift();
    if (!oldest) break;
    store.sessionsByCode.delete(oldest.code);
  }
};

export const createBlenderPairCode = (input: { userId: string; token: string; ttlMs?: number }) => {
  cleanupExpiredSessions();
  trimSessionsForUser(input.userId);

  const store = getStore();
  const createdAtMs = now();
  const ttlMs = Math.max(60_000, Math.min(30 * 60 * 1000, Math.trunc(input.ttlMs ?? DEFAULT_TTL_MS)));
  const expiresAtMs = createdAtMs + ttlMs;

  let code = generateCode();
  let attempts = 0;
  while (store.sessionsByCode.has(code) && attempts < 10) {
    code = generateCode();
    attempts += 1;
  }

  const session: PairSession = {
    code,
    userId: input.userId,
    token: input.token,
    createdAtMs,
    expiresAtMs,
    consumedAtMs: null,
  };
  store.sessionsByCode.set(code, session);

  return {
    code,
    expiresAt: new Date(expiresAtMs).toISOString(),
    createdAt: new Date(createdAtMs).toISOString(),
  };
};

export const claimBlenderPairCode = (rawCode: string) => {
  cleanupExpiredSessions();
  const code = normalizeCode(rawCode);
  if (!CODE_PATTERN.test(code)) {
    return {
      ok: false as const,
      error: "Pair code format is invalid.",
    };
  }

  const store = getStore();
  const session = store.sessionsByCode.get(code);
  if (!session) {
    return {
      ok: false as const,
      error: "Pair code was not found or already used.",
    };
  }
  if (isExpired(session)) {
    store.sessionsByCode.delete(code);
    return {
      ok: false as const,
      error: "Pair code has expired.",
    };
  }

  session.consumedAtMs = now();
  store.sessionsByCode.delete(code);
  return {
    ok: true as const,
    token: session.token,
  };
};

