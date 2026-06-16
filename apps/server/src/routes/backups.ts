import type { FastifyInstance } from "fastify";
import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "../db.js";
import { findRepoRoot, resolveSqlitePath } from "../utils/paths.js";

const dailyBackupPrefix = "auto-daily";

export function registerBackupRoutes(app: FastifyInstance) {
  app.get("/api/backups", async () => {
    return prisma.backupRecord.findMany({ orderBy: { createdAt: "desc" } });
  });

  app.post("/api/backups", async (request, reply) => {
    const record = await createBackupRecord();

    reply.status(201);
    return record;
  });

  app.get("/api/backups/:backupId/download", async (request, reply) => {
    const { backupId } = request.params as { backupId: string };
    const backup = await prisma.backupRecord.findUnique({ where: { id: backupId } });
    if (!backup) {
      reply.status(404);
      return { error: "Backup not found" };
    }

    try {
      const data = await fs.readFile(backup.filePath);
      reply.header("content-type", "application/vnd.sqlite3");
      reply.header("content-disposition", `attachment; filename="${safeAttachmentFileName(backup.fileName)}"`);
      return data;
    } catch {
      reply.status(404);
      return { error: "Backup file not found" };
    }
  });

  app.post("/api/backups/:backupId/restore", async (request, reply) => {
    const { backupId } = request.params as { backupId: string };
    const backup = await prisma.backupRecord.findUnique({ where: { id: backupId } });
    if (!backup) {
      reply.status(404);
      return { error: "Backup not found" };
    }

    await fs.access(backup.filePath);
    const restorePoint = await createBackupRecord("pre-restore");
    const target = resolveSqlitePath();
    await prisma.$disconnect();
    await fs.copyFile(backup.filePath, target);

    return {
      restored: true,
      restoredFrom: backup.fileName,
      restorePoint: restorePoint.fileName,
      restartRequired: true
    };
  });
}

export async function ensureDailyBackup(): Promise<{ created: boolean; record?: Awaited<ReturnType<typeof createBackupRecord>> }> {
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(startOfDay);
  endOfDay.setDate(endOfDay.getDate() + 1);

  const existing = await prisma.backupRecord.findFirst({
    where: {
      fileName: { startsWith: `${dailyBackupPrefix}-` },
      createdAt: {
        gte: startOfDay,
        lt: endOfDay
      }
    },
    orderBy: { createdAt: "desc" }
  });

  if (existing) return { created: false, record: existing };
  return { created: true, record: await createBackupRecord(dailyBackupPrefix) };
}

export async function createBackupRecord(prefix = "competition-manager") {
  const source = resolveSqlitePath();
  const backupsDir = path.join(findRepoRoot(), "backups");
  await fs.mkdir(backupsDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const fileName = `${prefix}-${stamp}.sqlite`;
  const filePath = path.join(backupsDir, fileName);
  await fs.copyFile(source, filePath);
  const stat = await fs.stat(filePath);

  return prisma.backupRecord.create({
    data: {
      fileName,
      filePath,
      sizeBytes: stat.size
    }
  });
}

function safeAttachmentFileName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
}
