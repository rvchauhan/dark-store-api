import type { User } from "@prisma/client";
import { Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { prisma } from "../../db/client.js";
import { AppError } from "../../shared/errors/app-error.js";
import { authService } from "../auth/auth.service.js";
import type { ProvisionInput, ProvisionStoreInput, SessionInput } from "./partner.schemas.js";

const DEFAULT_GEOFENCE = {
  type: "circle",
  radiusKm: 5,
  center: { lat: 0, lng: 0 },
  note: "placeholder — update from portal",
};

const DEFAULT_OPERATING_HOURS = {
  timezone: "UTC",
  open: "00:00",
  close: "23:59",
};

function mergeInstallationMetadata(
  existing: Prisma.JsonValue | null | undefined,
  externalId: string,
  input: { metadata?: Record<string, unknown>; shopifyAccessToken?: string },
): Prisma.InputJsonValue {
  const base = {
    ...((existing ?? {}) as Record<string, unknown>),
    ...((input.metadata ?? {}) as Record<string, unknown>),
  };
  if (input.shopifyAccessToken) {
    base.shop = externalId.toLowerCase();
    base.shopifyAccessToken = input.shopifyAccessToken;
  }
  return base as Prisma.InputJsonValue;
}

/**
 * Partner provisioning — creates a Business + business_admin (+ optional first
 * dark store) from an external install and returns a staff JWT.
 *
 * Idempotent on (provider, externalId): reinstall / retry returns the same
 * tenant and a fresh JWT for the existing admin.
 */
export class PartnerProvisionService {
  async provision(input: ProvisionInput) {
    const provider = input.provider.trim().toLowerCase();
    const externalId = input.externalId.trim().toLowerCase();
    const email = input.admin.email.trim().toLowerCase();
    const adminName = input.admin.name.trim();
    const orgName = input.organizationName.trim();

    const existingInstall = await prisma.externalInstallation.findUnique({
      where: { provider_externalId: { provider, externalId } },
      include: {
        business: {
          include: {
            users: {
              where: { role: "business_admin" },
              orderBy: { createdAt: "asc" },
            },
            stores: { orderBy: { createdAt: "asc" }, take: 1 },
          },
        },
      },
    });

    if (existingInstall) {
      return this.reprovisionExisting(existingInstall, input, email, adminName);
    }

    // Email must not already belong to another tenant.
    const emailOwner = await prisma.user.findUnique({ where: { email } });
    if (emailOwner) {
      throw new AppError(
        409,
        "An account with this admin email already exists for another organization",
        "EMAIL_TAKEN",
      );
    }

    const passwordHash = input.admin.password
      ? await bcrypt.hash(input.admin.password, 10)
      : null;

    const metadata = mergeInstallationMetadata(null, externalId, input);

    const { business, admin, installation, store } = await prisma.$transaction(async (tx) => {
      const business = await tx.business.create({
        data: { name: orgName },
      });

      const admin = await tx.user.create({
        data: {
          businessId: business.id,
          storeId: null,
          name: adminName,
          email,
          phone: input.admin.phone?.trim() || null,
          passwordHash,
          role: "business_admin",
          status: "active",
        },
      });

      const installation = await tx.externalInstallation.create({
        data: {
          businessId: business.id,
          provider,
          externalId,
          displayName: input.displayName?.trim() || orgName,
          metadata,
          uninstalledAt: null,
        },
      });

      const store = input.store
        ? await this.createStoreInTx(tx, business.id, input.store)
        : null;

      return { business, admin, installation, store };
    });

    const session = authService.issueSessionForUser(admin);

    return {
      created: true,
      business: { id: business.id, name: business.name },
      installation: {
        id: installation.id,
        provider: installation.provider,
        externalId: installation.externalId,
        displayName: installation.displayName,
        installedAt: installation.installedAt,
      },
      store: store
        ? { id: store.id, name: store.name, status: store.status, address: store.address }
        : null,
      ...session,
      passwordSet: Boolean(passwordHash),
      hint: passwordHash
        ? "Admin can use this JWT now, and email/password later on the portal."
        : "Admin is logged in via JWT. They must set a password (or use Google) before the next portal login.",
    };
  }

  /**
   * App-open login: resolve installation by shop domain and issue a fresh JWT.
   * Does not create anything — call /provision on first install.
   */
  async session(input: SessionInput) {
    const provider = input.provider.trim().toLowerCase();
    const externalId = input.externalId.trim().toLowerCase();

    const installation = await prisma.externalInstallation.findUnique({
      where: { provider_externalId: { provider, externalId } },
      include: {
        business: {
          include: {
            users: {
              where: { role: "business_admin", status: { not: "disabled" } },
              orderBy: { createdAt: "asc" },
            },
            stores: { orderBy: { createdAt: "asc" }, take: 5 },
          },
        },
      },
    });

    if (!installation) {
      throw new AppError(
        404,
        "Installation not found — call POST /api/partner/provision first",
        "INSTALLATION_NOT_FOUND",
      );
    }

    if (installation.uninstalledAt) {
      throw new AppError(
        403,
        "This installation was uninstalled — re-provision to reactivate",
        "INSTALLATION_UNINSTALLED",
      );
    }

    const preferredEmail = input.adminEmail?.trim().toLowerCase();
    const admin =
      (preferredEmail
        ? installation.business.users.find((u) => u.email === preferredEmail)
        : undefined) ?? installation.business.users[0];

    if (!admin) {
      throw new AppError(404, "No active admin found for this installation", "ADMIN_NOT_FOUND");
    }

    // Touch last activity and refresh Shopify credentials when provided.
    await prisma.externalInstallation.update({
      where: { id: installation.id },
      data: {
        updatedAt: new Date(),
        ...(input.shopifyAccessToken
          ? {
              metadata: mergeInstallationMetadata(
                installation.metadata,
                installation.externalId,
                input,
              ),
            }
          : {}),
      },
    });

    const session = authService.issueSessionForUser(admin);

    return {
      created: false,
      business: { id: installation.business.id, name: installation.business.name },
      installation: {
        id: installation.id,
        provider: installation.provider,
        externalId: installation.externalId,
        displayName: installation.displayName,
        installedAt: installation.installedAt,
      },
      stores: installation.business.stores.map((s) => ({
        id: s.id,
        name: s.name,
        status: s.status,
        address: s.address,
      })),
      ...session,
      passwordSet: Boolean(admin.passwordHash),
      hint: "Session issued from existing Shopify installation.",
    };
  }

  private async createStoreInTx(
    tx: Prisma.TransactionClient,
    businessId: string,
    input: ProvisionStoreInput,
  ) {
    const code = input.code
      ? input.code.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "")
      : undefined;

    return tx.store.create({
      data: {
        businessId,
        name: input.name.trim(),
        code: code || null,
        address: input.address.trim(),
        geofence: (input.geofence ?? DEFAULT_GEOFENCE) as Prisma.InputJsonValue,
        operatingHours: (input.operatingHours ?? DEFAULT_OPERATING_HOURS) as Prisma.InputJsonValue,
        status: input.activate === false ? "onboarding" : "active",
      },
    });
  }

  private async reprovisionExisting(
    existing: {
      id: string;
      businessId: string;
      provider: string;
      externalId: string;
      displayName: string | null;
      metadata: Prisma.JsonValue | null;
      installedAt: Date;
      uninstalledAt: Date | null;
      business: {
        id: string;
        name: string;
        users: User[];
        stores: { id: string; name: string; status: string; address: string }[];
      };
    },
    input: ProvisionInput,
    email: string,
    adminName: string,
  ) {
    // Prefer the admin matching the requested email; else the first business_admin.
    let admin: User | undefined =
      existing.business.users.find((u) => u.email === email) ??
      existing.business.users[0];

    if (!admin) {
      const emailOwner = await prisma.user.findUnique({ where: { email } });
      if (emailOwner && emailOwner.businessId !== existing.businessId) {
        throw new AppError(
          409,
          "An account with this admin email already exists for another organization",
          "EMAIL_TAKEN",
        );
      }

      if (emailOwner) {
        admin = emailOwner;
      } else {
        const passwordHash = input.admin.password
          ? await bcrypt.hash(input.admin.password, 10)
          : null;

        admin = await prisma.user.create({
          data: {
            businessId: existing.businessId,
            storeId: null,
            name: adminName,
            email,
            phone: input.admin.phone?.trim() || null,
            passwordHash,
            role: "business_admin",
            status: "active",
          },
        });
      }
    }

    if (admin.status === "disabled") {
      throw new AppError(403, "Admin account is disabled", "ACCOUNT_DISABLED");
    }

    const metadata = mergeInstallationMetadata(existing.metadata, existing.externalId, input);
    const installation = await prisma.externalInstallation.update({
      where: { id: existing.id },
      data: {
        uninstalledAt: null,
        displayName: input.displayName?.trim() || existing.displayName || input.organizationName,
        metadata,
        installedAt: existing.uninstalledAt ? new Date() : existing.installedAt,
      },
    });

    if (input.organizationName.trim() && input.organizationName.trim() !== existing.business.name) {
      await prisma.business.update({
        where: { id: existing.businessId },
        data: { name: input.organizationName.trim() },
      });
    }

    if (input.admin.password && !admin.passwordHash) {
      const passwordHash = await bcrypt.hash(input.admin.password, 10);
      admin = await prisma.user.update({
        where: { id: admin.id },
        data: { passwordHash, status: "active" },
      });
    }

    if (admin.status === "invited") {
      admin = await prisma.user.update({
        where: { id: admin.id },
        data: { status: "active" },
      });
    }

    // Create the optional first store only if the business has none yet.
    let store =
      existing.business.stores[0] ??
      null;

    if (input.store && !store) {
      store = await prisma.$transaction((tx) =>
        this.createStoreInTx(tx, existing.businessId, input.store!),
      );
    }

    const business = await prisma.business.findUniqueOrThrow({
      where: { id: existing.businessId },
      select: { id: true, name: true },
    });

    const session = authService.issueSessionForUser(admin);

    return {
      created: false,
      business,
      installation: {
        id: installation.id,
        provider: installation.provider,
        externalId: installation.externalId,
        displayName: installation.displayName,
        installedAt: installation.installedAt,
      },
      store: store
        ? { id: store.id, name: store.name, status: store.status, address: store.address }
        : null,
      ...session,
      passwordSet: Boolean(admin.passwordHash),
      hint: "Existing installation — returned a fresh JWT for the store admin.",
    };
  }

  /** Soft-uninstall: keeps the tenant, marks the external link inactive. */
  async uninstall(provider: string, externalId: string) {
    const normalizedProvider = provider.trim().toLowerCase();
    const normalizedExternalId = externalId.trim().toLowerCase();

    const existing = await prisma.externalInstallation.findUnique({
      where: {
        provider_externalId: {
          provider: normalizedProvider,
          externalId: normalizedExternalId,
        },
      },
    });

    if (!existing) {
      throw new AppError(404, "Installation not found", "NOT_FOUND");
    }

    if (existing.uninstalledAt) {
      return existing;
    }

    return prisma.externalInstallation.update({
      where: { id: existing.id },
      data: { uninstalledAt: new Date() },
    });
  }
}

export const partnerProvisionService = new PartnerProvisionService();
