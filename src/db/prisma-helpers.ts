/**
 * Shared helpers for Prisma error handling and Decimal/JSON serialization.
 * Keeps API response shapes compatible with the former Drizzle numeric (string) fields.
 */
import { Prisma } from "@prisma/client";

/** Unwrap Prisma unique violations (P2002) for caller-friendly 409 mapping. */
export function asUniqueViolation(err: unknown): { fields: string[] } | null {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    const target = err.meta?.target;
    if (Array.isArray(target)) {
      return { fields: target.map(String) };
    }
    if (typeof target === "string") {
      return { fields: [target] };
    }
    return { fields: [] };
  }
  return null;
}

/** True when the unique violation hit the given column (camelCase or snake_case). */
export function uniqueHit(violation: { fields: string[] }, ...names: string[]): boolean {
  const normalized = new Set(violation.fields.map((f) => f.toLowerCase().replace(/_/g, "")));
  return names.some((n) => normalized.has(n.toLowerCase().replace(/_/g, "")));
}

/** Serialize Decimal | number | string | null for JSON APIs that historically returned strings. */
export function decimalString(value: Prisma.Decimal | number | string | null | undefined): string | null {
  if (value == null) return null;
  return value.toString();
}

export function decimalStringRequired(value: Prisma.Decimal | number | string): string {
  return value.toString();
}

export function asNumber(value: Prisma.Decimal | number | string | null | undefined): number {
  if (value == null) return 0;
  return Number(value);
}
