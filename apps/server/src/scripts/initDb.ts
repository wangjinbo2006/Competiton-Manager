import Database from "better-sqlite3";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const databaseUrl = process.env.DATABASE_URL ?? "file:./data/competition-manager.sqlite";
process.env.DATABASE_URL = databaseUrl;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

const databasePath = fileUrlToPath(databaseUrl);
fs.mkdirSync(path.dirname(databasePath), { recursive: true });

if (fs.existsSync(databasePath)) {
  const existingDb = new Database(databasePath);
  const hasTables = existingDb
    .prepare("select count(*) as count from sqlite_master where type = 'table' and name = 'Project'")
    .get() as { count: number };
  existingDb.close();
  if (hasTables.count > 0) {
    console.log(`Database already initialized at ${databasePath}`);
    process.exit(0);
  }
}

const sql = execFileSync(
  "npx",
  ["prisma", "migrate", "diff", "--from-empty", "--to-schema", "prisma/schema.prisma", "--script"],
  {
    encoding: "utf8",
    env: process.env,
    cwd: repoRoot
  }
);

const db = new Database(databasePath);
db.exec(sql);
db.close();

console.log(`Database initialized at ${databasePath}`);

function fileUrlToPath(url: string): string {
  if (!url.startsWith("file:")) {
    throw new Error(`Only file: SQLite URLs are supported, received ${url}`);
  }

  const value = url.slice("file:".length);
  return path.isAbsolute(value) ? value : path.resolve(repoRoot, value);
}
