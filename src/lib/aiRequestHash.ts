import crypto from "node:crypto";

const stableStringify = (value: unknown): string => {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, current]) => current !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries
      .map(([key, current]) => `${JSON.stringify(key)}:${stableStringify(current)}`)
      .join(",")}}`;
  }
  return JSON.stringify(String(value));
};

export const buildAiRequestHash = (input: unknown) =>
  crypto.createHash("sha256").update(stableStringify(input)).digest("hex");
