import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { needsAdmin, registerAuthRoutes, requireAdmin } from "./auth.js";
import { ensureDailyBackup, registerBackupRoutes } from "./routes/backups.js";
import { registerImportExportRoutes } from "./routes/importExport.js";
import { registerProjectRoutes } from "./routes/projects.js";
import { registerRankingRoutes } from "./routes/rankings.js";
import { registerTournamentRoutes } from "./routes/tournaments.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function buildApp() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info"
    }
  });

  app.register(cors, {
    origin: true,
    credentials: true
  });

  app.addContentTypeParser(["text/csv", "text/csv; charset=utf-8"], { parseAs: "string" }, (_request, body, done) => {
    done(null, body);
  });

  app.get("/api/health", async () => ({
    ok: true,
    name: "competition-manager",
    version: "0.1.0"
  }));

  registerAuthRoutes(app);

  app.addHook("preHandler", async (request, reply) => {
    if (needsAdmin(request)) {
      await requireAdmin(request, reply);
      if (reply.sent) return;
    }
  });

  registerProjectRoutes(app);
  registerTournamentRoutes(app);
  registerRankingRoutes(app);
  registerBackupRoutes(app);
  registerImportExportRoutes(app);

  app.addHook("onReady", async () => {
    const backup = await ensureDailyBackup();
    app.log.info(
      backup.created
        ? { backup: backup.record?.fileName }
        : { backup: backup.record?.fileName },
      backup.created ? "Daily backup created" : "Daily backup already exists"
    );
  });

  const webDist = resolveWebDist();
  app.register(fastifyStatic, {
    root: webDist,
    prefix: "/"
  });

  app.setNotFoundHandler((request, reply) => {
    if (request.raw.url?.startsWith("/api/")) {
      reply.status(404).send({ error: "API route not found" });
      return;
    }
    reply.sendFile("index.html");
  });

  return app;
}

function resolveWebDist(): string {
  const candidates = [
    path.resolve(process.cwd(), "../web/dist"),
    path.resolve(process.cwd(), "apps/web/dist"),
    path.resolve(__dirname, "../../../../../../apps/web/dist")
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? path.resolve(process.cwd(), "../web/dist");
}
