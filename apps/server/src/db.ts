import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@prisma/client";
import path from "node:path";
import { findRepoRoot } from "./utils/paths.js";

const databaseUrl = process.env.DATABASE_URL ?? "file:./data/competition-manager.sqlite";
const repoRoot = findRepoRoot();
const adapter = new PrismaBetterSqlite3({ url: normalizeDatabaseUrl(databaseUrl) });

export const prisma = new PrismaClient({
  adapter,
  log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"]
});

function normalizeDatabaseUrl(url: string): string {
  if (!url.startsWith("file:")) return url;
  const value = url.slice("file:".length);
  if (path.isAbsolute(value)) return url;
  return `file:${path.resolve(repoRoot, value)}`;
}
