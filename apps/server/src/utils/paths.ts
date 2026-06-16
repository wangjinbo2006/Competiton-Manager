import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function findRepoRoot(): string {
  const startPoints = [process.cwd(), path.dirname(fileURLToPath(import.meta.url))];

  for (const startPoint of startPoints) {
    let current = startPoint;
    while (true) {
      if (fs.existsSync(path.join(current, "prisma/schema.prisma"))) {
        return current;
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }

  return process.cwd();
}

export function resolveSqlitePath(databaseUrl = process.env.DATABASE_URL ?? "file:./data/competition-manager.sqlite"): string {
  if (!databaseUrl.startsWith("file:")) {
    throw new Error(`Only file: SQLite URLs are supported, received ${databaseUrl}`);
  }

  const value = databaseUrl.slice("file:".length);
  return path.isAbsolute(value) ? value : path.resolve(findRepoRoot(), value);
}
