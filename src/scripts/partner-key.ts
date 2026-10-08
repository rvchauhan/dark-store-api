/**
 * Partner API key administration from the terminal.
 *
 * Issuing a key is an operator action, so this script is the primary path —
 * it needs only DATABASE_URL and works without the API running.
 *
 * Platform key (put this in your Shopify app .env):
 *   npm run partner-key:create -- --platform --name "Shopify App"
 *
 * Organization key (ERP / reporting for one merchant):
 *   npm run partner-key:create -- --business <uuid> --name "Acme ERP"
 *   npm run partner-key:create -- --business <uuid> --name "Reporting" --scopes read
 *
 *   npm run partner-key:list
 *   npm run partner-key:list -- --platform
 *   npm run partner-key:list -- --business <uuid>
 *   npm run partner-key:revoke -- --id <uuid>
 *
 * The raw key is printed once at creation and is not recoverable afterwards.
 */
import "dotenv/config";
import { prisma } from "../db/client.js";
import {
  PARTNER_KEY_SCOPES,
  partnerKeysService,
  type PartnerKeyScope,
} from "../modules/partner-keys/partner-keys.service.js";

type Flags = Record<string, string | undefined>;

/** Parses `--key value` pairs; bare flags become "true". */
function parseFlags(argv: string[]): Flags {
  const flags: Flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const name = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      flags[name] = next;
      i++;
    } else {
      flags[name] = "true";
    }
  }
  return flags;
}

function fail(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function parseScopes(raw: string | undefined): PartnerKeyScope[] | undefined {
  if (!raw) return undefined;

  const scopes = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  for (const scope of scopes) {
    if (!PARTNER_KEY_SCOPES.includes(scope as PartnerKeyScope)) {
      fail(`Unknown scope "${scope}". Valid scopes: ${PARTNER_KEY_SCOPES.join(", ")}`);
    }
  }

  if (scopes.length === 0) {
    fail("--scopes was provided but empty");
  }

  return scopes as PartnerKeyScope[];
}

async function create(flags: Flags) {
  const isPlatform = flags.platform === "true";
  const businessId = flags.business ?? flags.businessId;
  const name = flags.name;

  if (isPlatform && businessId) fail("Pass either --platform or --business, not both");
  if (!isPlatform && !businessId) fail("Provide --platform or --business <uuid>");
  if (!name || name === "true") fail('--name "Shopify App" is required');

  const result = await partnerKeysService.create({
    businessId: isPlatform ? null : businessId,
    name,
    scopes: parseScopes(flags.scopes),
    expiresAt: flags.expires ? new Date(flags.expires) : null,
  });

  console.log("");
  console.log(result.isPlatform ? "Platform partner key created" : "Partner key created");
  console.log("----------------------------");
  if (result.isPlatform) {
    console.log("Type         : platform (Shopify / Open API provisioning)");
  } else {
    console.log(`Organization : ${result.businessName} (${result.businessId})`);
  }
  console.log(`Label        : ${result.name}`);
  console.log(`Scopes       : ${result.scopes.join(", ")}`);
  console.log(`Expires      : ${result.expiresAt?.toISOString() ?? "never"}`);
  console.log(`Key id       : ${result.id}`);
  console.log("");
  console.log(`  ${result.key}`);
  console.log("");
  console.log("Copy it now — only a hash is stored, so it cannot be shown again.");
  console.log("");
  if (result.isPlatform) {
    console.log("Shopify app .env:");
    console.log(`  PARTNER_API_KEY=${result.key}`);
    console.log(`  DARK_STORE_API_URL=http://localhost:3001`);
    console.log("");
    console.log("Provision a merchant:");
    console.log(
      `  curl -X POST http://localhost:3001/api/partner/provision \\`,
    );
    console.log(`    -H "x-api-key: ${result.key}" -H "Content-Type: application/json" \\`);
    console.log(
      `    -d '{"provider":"shopify","externalId":"acme.myshopify.com","organizationName":"Acme","admin":{"email":"owner@acme.com","name":"Owner"}}'`,
    );
  } else {
    console.log("Usage:");
    console.log(`  curl http://localhost:3001/api/catalog/skus -H "x-api-key: ${result.key}"`);
  }
  console.log("");
}

async function list(flags: Flags) {
  const isPlatform = flags.platform === "true";
  const businessId = flags.business ?? flags.businessId;
  const filter = isPlatform ? null : businessId;

  const keys = await partnerKeysService.list(filter);

  if (keys.length === 0) {
    console.log("No partner keys found.");
    return;
  }

  console.table(
    keys.map((key) => ({
      id: key.id,
      name: key.name,
      type: key.isPlatform ? "platform" : "organization",
      business: key.businessId ?? "—",
      prefix: `${key.keyPrefix}...`,
      scopes: key.scopes.join(","),
      lastUsed: key.lastUsedAt?.toISOString() ?? "never",
      status: key.revokedAt ? "revoked" : "active",
    })),
  );
}

async function revoke(flags: Flags) {
  const id = flags.id;
  if (!id) fail("--id <uuid> is required");

  const revoked = await partnerKeysService.revoke(id);
  console.log(`Revoked "${revoked.name}" (${revoked.id}) at ${revoked.revokedAt?.toISOString()}`);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const flags = parseFlags(rest);

  switch (command) {
    case "create":
      await create(flags);
      break;
    case "list":
      await list(flags);
      break;
    case "revoke":
      await revoke(flags);
      break;
    default:
      console.log("Usage: partner-key <create|list|revoke> [flags]");
      console.log("");
      console.log('  create  --platform --name "Shopify App" [--scopes read,write]');
      console.log('  create  --business <uuid> --name "Acme ERP" [--scopes read,write] [--expires <iso-date>]');
      console.log("  list    [--platform] [--business <uuid>]");
      console.log("  revoke  --id <uuid>");
      process.exit(command ? 1 : 0);
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
