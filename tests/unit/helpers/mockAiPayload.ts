type JobRecord = Record<string, any>;
type UserRecord = Record<string, any>;
type TokenEventRecord = Record<string, any>;
type JobEventRecord = Record<string, any>;

const toNumeric = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
};

const normalizeRelId = (value: unknown): string | number | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") {
    const candidate =
      (value as { id?: unknown; value?: unknown; _id?: unknown }).id ??
      (value as { id?: unknown; value?: unknown; _id?: unknown }).value ??
      (value as { id?: unknown; value?: unknown; _id?: unknown })._id ??
      null;
    return normalizeRelId(candidate);
  }
  if (typeof value === "number") return value;
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw;
};

const getNestedValue = (obj: Record<string, unknown>, key: string) => {
  if (key in obj) return obj[key];
  const snake = key.replace(/[A-Z]/g, (ch) => `_${ch.toLowerCase()}`);
  if (snake in obj) return obj[snake];
  return undefined;
};

const matchesWhere = (doc: Record<string, any>, where?: Record<string, unknown>): boolean => {
  if (!where) return true;
  if (where.and && Array.isArray(where.and)) {
    return (where.and as Record<string, unknown>[]).every((part) => matchesWhere(doc, part));
  }
  if (where.or && Array.isArray(where.or)) {
    return (where.or as Record<string, unknown>[]).some((part) => matchesWhere(doc, part));
  }
  return Object.entries(where).every(([key, condition]) => {
    if (key === "and" || key === "or") return true;
    const value = key === "user" || key === "job" ? normalizeRelId(doc[key]) : getNestedValue(doc, key);
    if (condition && typeof condition === "object" && !Array.isArray(condition)) {
      const cond = condition as Record<string, unknown>;
      if ("equals" in cond) return String(value ?? "") === String(cond.equals ?? "");
      if ("in" in cond && Array.isArray(cond.in)) {
        return (cond.in as unknown[]).map((entry) => String(entry)).includes(String(value ?? ""));
      }
      if ("greater_than_equal" in cond) {
        const left = toNumeric(value);
        const right = toNumeric(cond.greater_than_equal);
        return left >= right;
      }
    }
    return String(value ?? "") === String(condition ?? "");
  });
};

const sortDocs = (docs: any[], sort?: string) => {
  if (!sort) return docs;
  const desc = sort.startsWith("-");
  const field = desc ? sort.slice(1) : sort;
  return [...docs].sort((a, b) => {
    const av = getNestedValue(a, field);
    const bv = getNestedValue(b, field);
    if (av === bv) return 0;
    if (av === undefined || av === null) return 1;
    if (bv === undefined || bv === null) return -1;
    if (String(av) > String(bv)) return desc ? -1 : 1;
    return desc ? 1 : -1;
  });
};

export const createMockAiPayload = (input?: {
  jobs?: JobRecord[];
  users?: UserRecord[];
  tokenEvents?: TokenEventRecord[];
  jobEvents?: JobEventRecord[];
}) => {
  const jobs = new Map<string, JobRecord>();
  const users = new Map<string, UserRecord>();
  const tokenEvents: TokenEventRecord[] = [...(input?.tokenEvents || [])];
  const jobEvents: JobEventRecord[] = [...(input?.jobEvents || [])];

  (input?.jobs || []).forEach((job, index) => {
    const id = String(job.id ?? index + 1);
    jobs.set(id, { ...job, id });
  });
  (input?.users || []).forEach((user, index) => {
    const id = String(user.id ?? index + 1);
    users.set(id, { ...user, id });
  });

  let autoId = 1000;
  const nextId = () => String(autoId++);

  const payload = {
    async findByID(args: { collection: string; id: string | number }) {
      const key = String(args.id);
      if (args.collection === "ai_jobs") {
        return jobs.get(key) ? { ...jobs.get(key) } : null;
      }
      if (args.collection === "users") {
        return users.get(key) ? { ...users.get(key) } : null;
      }
      return null;
    },

    async find(args: {
      collection: string;
      where?: Record<string, unknown>;
      sort?: string;
      limit?: number;
    }) {
      let docs: any[] = [];
      if (args.collection === "ai_jobs") {
        docs = Array.from(jobs.values());
      } else if (args.collection === "ai_token_events") {
        docs = [...tokenEvents];
      } else if (args.collection === "ai_job_events") {
        docs = [...jobEvents];
      }
      docs = docs.filter((doc) => matchesWhere(doc, args.where));
      docs = sortDocs(docs, args.sort);
      if (typeof args.limit === "number" && Number.isFinite(args.limit)) {
        docs = docs.slice(0, Math.max(0, Math.trunc(args.limit)));
      }
      return { docs: docs.map((doc) => ({ ...doc })) };
    },

    async create(args: { collection: string; data: Record<string, unknown> }) {
      const id = String(args.data.id ?? nextId());
      if (args.collection === "ai_token_events") {
        const record = { ...args.data, id };
        tokenEvents.push(record);
        return { ...record };
      }
      if (args.collection === "ai_job_events") {
        const record = { ...args.data, id };
        jobEvents.push(record);
        return { ...record };
      }
      if (args.collection === "ai_jobs") {
        const record = { ...args.data, id };
        jobs.set(id, record);
        return { ...record };
      }
      throw new Error(`Unsupported collection for create: ${args.collection}`);
    },

    async update(args: { collection: string; id: string | number; data: Record<string, unknown> }) {
      const id = String(args.id);
      if (args.collection === "ai_jobs") {
        const current = jobs.get(id);
        if (!current) throw new Error("Job not found.");
        const next = { ...current, ...args.data, id };
        jobs.set(id, next);
        return { ...next };
      }
      if (args.collection === "users") {
        const current = users.get(id);
        if (!current) throw new Error("User not found.");
        const next = { ...current, ...args.data, id };
        users.set(id, next);
        return { ...next };
      }
      throw new Error(`Unsupported collection for update: ${args.collection}`);
    },

    // Debug helpers for assertions
    __state() {
      return {
        jobs: Array.from(jobs.values()).map((doc) => ({ ...doc })),
        users: Array.from(users.values()).map((doc) => ({ ...doc })),
        tokenEvents: tokenEvents.map((doc) => ({ ...doc })),
        jobEvents: jobEvents.map((doc) => ({ ...doc })),
      };
    },
  };

  return payload;
};
