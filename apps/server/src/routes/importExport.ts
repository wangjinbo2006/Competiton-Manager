import type { FastifyInstance } from "fastify";
import { calculateStandings } from "@competition-manager/shared";
import { stringifyCsv, parseCsv, rowsToObjects } from "../utils/csv.js";
import { prisma } from "../db.js";
import { createBackupRecord } from "./backups.js";

export function registerImportExportRoutes(app: FastifyInstance) {
  app.post("/api/projects/:projectId/import/players", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) {
      reply.status(404);
      return { error: "Project not found" };
    }

    const csvText = typeof request.body === "string" ? request.body : JSON.stringify(request.body ?? "");
    const records = rowsToObjects(parseCsv(csvText));
    const backup = await createBackupRecord("pre-import");
    const created = [];
    const skipped = [];

    for (const [index, record] of records.entries()) {
      const name = record.name || record["姓名"];
      if (!name) {
        skipped.push({ row: index + 2, reason: "Missing name" });
        continue;
      }
      const code = record.code || record["编号"] || null;
      if (code) {
        const existing = await prisma.projectPlayer.findUnique({
          where: { projectId_code: { projectId, code } }
        });
        if (existing) {
          skipped.push({ row: index + 2, reason: `Duplicate code ${code}` });
          continue;
        }
      }

      const entry = await prisma.$transaction(async (tx) => {
        const birthDate = record.birthDate || record["出生日期"] || record["生日"] || undefined;
        const parsedBirthDate = parseOptionalDate(birthDate);
        if (birthDate && !parsedBirthDate) {
          skipped.push({ row: index + 2, reason: "Invalid birthDate" });
          return null;
        }
        const player = await tx.player.create({
          data: {
            name,
            nickname: record.nickname || record["昵称"] || null,
            gender: record.gender || record["性别"] || null,
            birthDate: parsedBirthDate,
            club: record.club || record["队伍"] || null,
            country: record.country || record["国家"] || null,
            region: record.region || record["地区"] || null,
            contact: record.contact || record["联系方式"] || null,
            avatarUrl: record.avatarUrl || record["头像"] || record["头像链接"] || null,
            note: record.note || record["备注"] || null
          }
        });

        return tx.projectPlayer.create({
          data: {
            projectId,
            playerId: player.id,
            displayName: record.displayName || record["显示名"] || record.nickname || record["昵称"] || name,
            code,
            seedRank: toPositiveInt(record.seedRank || record["种子"]) ?? null,
            currentElo: toPositiveInt(record.currentElo || record["Elo"]) ?? project.defaultElo,
            currentWcc: toPositiveInt(record.currentWcc || record["WCC"]) ?? 0
          }
        });
      });
      if (entry) created.push(entry);
    }

    reply.status(201);
    return { created: created.length, skipped, backup: { id: backup.id, fileName: backup.fileName, sizeBytes: backup.sizeBytes } };
  });

  app.get("/api/projects/:projectId/export/players.csv", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const players = await prisma.projectPlayer.findMany({
      where: { projectId, active: true },
      orderBy: [{ displayName: "asc" }],
      include: { player: true }
    });

    const csv = stringifyCsv([
      [
        "code",
        "displayName",
        "name",
        "nickname",
        "gender",
        "birthDate",
        "club",
        "country",
        "region",
        "contact",
        "avatarUrl",
        "note",
        "currentElo",
        "currentWcc",
        "matchesPlayed",
        "wins",
        "draws",
        "losses"
      ],
      ...players.map((entry) => [
        entry.code,
        entry.displayName,
        entry.player.name,
        entry.player.nickname,
        entry.player.gender,
        formatDate(entry.player.birthDate),
        entry.player.club,
        entry.player.country,
        entry.player.region,
        entry.player.contact,
        entry.player.avatarUrl,
        entry.player.note,
        entry.currentElo,
        entry.currentWcc,
        entry.matchesPlayed,
        entry.wins,
        entry.draws,
        entry.losses
      ])
    ]);

    reply.header("content-type", "text/csv; charset=utf-8");
    reply.header("content-disposition", 'attachment; filename="players.csv"');
    return csv;
  });

  app.get("/api/projects/:projectId/export/rankings.csv", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const players = await prisma.projectPlayer.findMany({
      where: { projectId, active: true },
      orderBy: [{ currentElo: "desc" }, { displayName: "asc" }],
      include: { player: true }
    });

    const csv = stringifyCsv([
      ["rank", "displayName", "code", "elo", "wcc", "matchesPlayed", "wins", "draws", "losses"],
      ...players.map((entry, index) => [
        index + 1,
        entry.displayName,
        entry.code,
        entry.currentElo,
        entry.currentWcc,
        entry.matchesPlayed,
        entry.wins,
        entry.draws,
        entry.losses
      ])
    ]);

    reply.header("content-type", "text/csv; charset=utf-8");
    reply.header("content-disposition", 'attachment; filename="rankings.csv"');
    return csv;
  });

  app.get("/api/tournaments/:tournamentId/export/matches.csv", async (request, reply) => {
    const { tournamentId } = request.params as { tournamentId: string };
    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: {
        matches: {
          orderBy: [{ createdAt: "asc" }],
          include: {
            round: true,
            participantA: { include: { projectPlayer: true } },
            participantB: { include: { projectPlayer: true } },
            winner: { include: { projectPlayer: true } },
            games: { orderBy: { gameNumber: "asc" } }
          }
        }
      }
    });

    if (!tournament) {
      reply.status(404);
      return { error: "Tournament not found" };
    }

    const csv = stringifyCsv([
      ["tournament", "round", "bracketNode", "table", "playerA", "playerB", "scoreA", "scoreB", "games", "resultType", "winner", "status", "finishedAt"],
      ...tournament.matches.map((match) => [
        tournament.name,
        match.round?.name ?? "",
        match.bracketNodeKey,
        match.tableNumber,
        match.participantA?.projectPlayer.displayName,
        match.participantB?.projectPlayer.displayName,
        match.scoreA,
        match.scoreB,
        formatGames(match.games),
        match.resultType,
        match.winner?.projectPlayer.displayName,
        match.status,
        formatDateTime(match.finishedAt)
      ])
    ]);

    reply.header("content-type", "text/csv; charset=utf-8");
    reply.header("content-disposition", 'attachment; filename="tournament-matches.csv"');
    return csv;
  });

  app.get("/api/tournaments/:tournamentId/export/standings.csv", async (request, reply) => {
    const { tournamentId } = request.params as { tournamentId: string };
    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: {
        participants: { include: { projectPlayer: true } },
        matches: true
      }
    });

    if (!tournament) {
      reply.status(404);
      return { error: "Tournament not found" };
    }

    const standings = calculateStandings(
      tournament.participants.map((participant) => ({
        id: participant.id,
        displayName: participant.projectPlayer.displayName,
        seed: participant.seed
      })),
      tournament.matches.map((match) => ({
        id: match.id,
        participantAId: match.participantAId,
        participantBId: match.participantBId,
        scoreA: match.scoreA,
        scoreB: match.scoreB,
        resultType: match.resultType,
        isBye: match.isBye
      }))
    );
    const csv = stringifyCsv([
      ["rank", "displayName", "matchesPlayed", "wins", "draws", "losses", "points", "buchholz"],
      ...standings.map((row) => [row.rank, row.displayName, row.matchesPlayed, row.wins, row.draws, row.losses, row.points, row.buchholz])
    ]);

    reply.header("content-type", "text/csv; charset=utf-8");
    reply.header("content-disposition", 'attachment; filename="tournament-standings.csv"');
    return csv;
  });
}

function toPositiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function formatDate(value: Date | null): string {
  if (!value) return "";
  return value.toISOString().slice(0, 10);
}

function formatDateTime(value: Date | null): string {
  if (!value) return "";
  return value.toISOString();
}

function formatGames(games: Array<{ scoreA: number | null; scoreB: number | null }>): string {
  return games.map((game) => `${game.scoreA ?? ""}-${game.scoreB ?? ""}`).join(" ");
}

function parseOptionalDate(value: string | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
