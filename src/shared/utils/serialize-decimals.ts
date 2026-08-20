import { Prisma } from "@prisma/client";

/**
 * Walk API payloads and turn Prisma.Decimal into strings that match the old
 * Drizzle `numeric` wire format (e.g. "45.00" rather than "45").
 */
export function serializeDecimals<T>(value: T): T {
  return walk(value) as T;
}

function walk(value: unknown): unknown {
  if (value == null) return value;

  if (value instanceof Prisma.Decimal) {
    const places = value.decimalPlaces();
    // Money / rate columns are Decimal(p, 2); weight is Decimal(p, 3).
    // When PG returns a whole number, decimalPlaces() is 0 — keep 2dp for money compatibility.
    const scale = places > 0 ? places : 2;
    return value.toFixed(scale);
  }

  if (value instanceof Date) return value;

  if (Array.isArray(value)) return value.map(walk);

  if (typeof value === "object") {
    // Avoid rewriting class instances / Buffers
    if (Object.getPrototypeOf(value) !== Object.prototype) return value;

    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = walk(v);
    }
    return out;
  }

  return value;
}
