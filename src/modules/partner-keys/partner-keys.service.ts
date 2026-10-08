import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { PartnerKey } from "@prisma/client";
import { prisma } from "../../db/client.js";
import { AppError } from "../../shared/errors/app-error.js";

/**
 * Partner key module service — owns partner_keys.
 *
 * Two kinds of key:
 *   - Organization key (businessId set): machine access as business_admin for one tenant
 *   - Platform key (businessId null): Shopify-app env credential used to provision merchants
 *
 * Security model:
 * - The raw key exists only in the response of `create()`. Only its SHA-256
 *   hash is persisted, so a database leak yields no usable credentials.
 * - Lookup is by hash on a unique index, so verification costs one indexed read.
 */

/** Identifies the issuing service; also what GitHub secret scanning matches on. */
const KEY_NAMESPACE = "dsk";

/** Characters of the raw key kept in plaintext to identify it in listings. */
const PREFIX_LENGTH = 16;

/** Skip the `lastUsedAt` write unless the stored value is at least this stale. */
const LAST_USED_THROTTLE_MS = 60_000;

export const PARTNER_KEY_SCOPES = ["read", "write"] as const;

export type PartnerKeyScope = (typeof PARTNER_KEY_SCOPES)[number];

export type CreatePartnerKeyInput = {
  /** Omit / null for a platform provisioning key (Shopify app env). */
  businessId?: string | null;
  name: string;
  scopes?: PartnerKeyScope[];
  expiresAt?: Date | null;
};

/** Environment segment of the key — keeps sandbox credentials off production data. */
function keyEnvironment(): string {
  return process.env.NODE_ENV === "production" ? "live" : "test";
}

function hashKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

/**
 * Public shape of a key. Deliberately omits `keyHash` so a stored hash can
 * never leak through an API response.
 */
function toPublic(key: PartnerKey) {
  return {
    id: key.id,
    businessId: key.businessId,
    isPlatform: key.businessId == null,
    name: key.name,
    keyPrefix: key.keyPrefix,
    scopes: key.scopes,
    lastUsedAt: key.lastUsedAt,
    expiresAt: key.expiresAt,
    revokedAt: key.revokedAt,
    createdAt: key.createdAt,
  };
}

export type PublicPartnerKey = ReturnType<typeof toPublic>;

/** Resolved identity attached to req.auth when a request authenticates by key. */
export type VerifiedPartnerKey = {
  id: string;
  /** null for platform provisioning keys. */
  businessId: string | null;
  isPlatform: boolean;
  name: string;
  scopes: string[];
};

export class PartnerKeysService {
  /**
   * Issues a new key (organization or platform).
   * The returned `key` is the only time the raw secret exists — it is not recoverable.
   */
  async create(input: CreatePartnerKeyInput) {
    let businessName: string | null = null;

    if (input.businessId) {
      const business = await prisma.business.findUnique({
        where: { id: input.businessId },
        select: { id: true, name: true },
      });

      if (!business) {
        throw new AppError(404, "Business not found", "NOT_FOUND");
      }
      businessName = business.name;
    }

    // 32 bytes = 256 bits of entropy from a CSPRNG.
    const secret = randomBytes(32).toString("base64url");
    const rawKey = `${KEY_NAMESPACE}_${keyEnvironment()}_${secret}`;

    const record = await prisma.partnerKey.create({
      data: {
        businessId: input.businessId ?? null,
        name: input.name,
        keyPrefix: rawKey.slice(0, PREFIX_LENGTH),
        keyHash: hashKey(rawKey),
        scopes: input.scopes ?? [...PARTNER_KEY_SCOPES],
        expiresAt: input.expiresAt ?? null,
      },
    });

    return {
      ...toPublic(record),
      businessName,
      /** Shown once. Not stored, not recoverable. */
      key: rawKey,
    };
  }

  /**
   * Resolves a raw key into the organization it belongs to (or platform).
   * Throws 401 for anything unusable so callers can't distinguish
   * "no such key" from "revoked" from "expired".
   */
  async verify(rawKey: string): Promise<VerifiedPartnerKey> {
    const invalid = () => new AppError(401, "Invalid API key", "INVALID_API_KEY");

    // Cheap structural check — rejects obvious junk before touching the database.
    if (!rawKey.startsWith(`${KEY_NAMESPACE}_`)) {
      throw invalid();
    }

    const record = await prisma.partnerKey.findUnique({
      where: { keyHash: hashKey(rawKey) },
    });

    if (!record) {
      throw invalid();
    }
    if (record.revokedAt) {
      throw new AppError(401, "API key has been revoked", "API_KEY_REVOKED");
    }
    if (record.expiresAt && record.expiresAt.getTime() <= Date.now()) {
      throw new AppError(401, "API key has expired", "API_KEY_EXPIRED");
    }

    this.touchLastUsed(record);

    return {
      id: record.id,
      businessId: record.businessId,
      isPlatform: record.businessId == null,
      name: record.name,
      scopes: record.scopes,
    };
  }

  /**
   * Records usage without adding a write to every request — updates at most
   * once per throttle window, and never blocks or fails the caller.
   */
  private touchLastUsed(record: PartnerKey) {
    const last = record.lastUsedAt?.getTime() ?? 0;
    if (Date.now() - last < LAST_USED_THROTTLE_MS) {
      return;
    }

    void prisma.partnerKey
      .update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
      .catch(() => {
        // Usage telemetry is best-effort; a failure here must not reject the request.
      });
  }

  async list(businessId?: string | null): Promise<PublicPartnerKey[]> {
    const keys = await prisma.partnerKey.findMany({
      where:
        businessId === undefined
          ? undefined
          : businessId === null
            ? { businessId: null }
            : { businessId },
      orderBy: { createdAt: "desc" },
    });

    return keys.map(toPublic);
  }

  async revoke(id: string): Promise<PublicPartnerKey> {
    const existing = await prisma.partnerKey.findUnique({ where: { id } });
    if (!existing) {
      throw new AppError(404, "Partner key not found", "NOT_FOUND");
    }
    if (existing.revokedAt) {
      return toPublic(existing);
    }

    const revoked = await prisma.partnerKey.update({
      where: { id },
      data: { revokedAt: new Date() },
    });

    return toPublic(revoked);
  }
}

export const partnerKeysService = new PartnerKeysService();

/**
 * Constant-time comparison for the operator secret guarding the admin routes.
 * Lives here so key-related secret handling stays in one place.
 */
export function secretsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
