import { attachDatabasePool } from "@vercel/functions";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// Lazy so routes that never touch the database (e.g. Graph validation) work without it.
// node-postgres on the pooled Neon URL; migrations use DATABASE_URL_UNPOOLED (see prisma.config.ts).
export function getDb(): PrismaClient {
  if (globalForPrisma.prisma) return globalForPrisma.prisma;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  // Neon's pooler closes idle connections. Retire ours first, keep sockets alive, and never let an
  // idle-connection error crash the process: the pool simply drops that client and opens a new one.
  const pool = new Pool({ connectionString, max: 5, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 15_000, keepAlive: true });
  pool.on("error", () => undefined);
  // Lets Vercel Fluid compute drain idle connections before an instance is suspended.
  if (process.env.VERCEL) attachDatabasePool(pool);
  const client = new PrismaClient({ adapter: new PrismaPg(pool) });
  globalForPrisma.prisma = client;
  return client;
}
