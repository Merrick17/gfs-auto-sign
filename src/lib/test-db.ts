import { readFileSync, readdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";

export const migrationSql = () =>
  readdirSync("prisma/migrations", { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
    .map((n) => readFileSync(`prisma/migrations/${n}/migration.sql`, "utf8"))
    .join("\n");

// Graph calls need a stored delegated sign-in; tests fake the token endpoint.
export async function seedOAuth(db: PrismaClient) {
  process.env.CERT_ENCRYPTION_KEY ||= randomBytes(32).toString("base64");
  const { storeRefreshToken } = await import("./graph-token");
  await storeRefreshToken("owner-oid", "test-refresh-token", "Mail.ReadWrite");
  void db;
}
