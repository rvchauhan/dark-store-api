import "dotenv/config";
import { PrismaClient } from "@prisma/client";

/**
 * Single Prisma client for the modular monolith.
 * When splitting microservices, each service gets its own client + DATABASE_URL.
 */
export const prisma = new PrismaClient();

export { Prisma } from "@prisma/client";
