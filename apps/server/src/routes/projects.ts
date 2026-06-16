import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import {
  calculateElo,
  calculateWccEffectivePoints,
  createPlayerSchema,
  createProjectSchema,
  createWccRuleSetSchema,
  scoreFromResult,
  updateProjectSchema,
  updatePlayerSchema,
  updateWccRuleSetSchema
} from "@competition-manager/shared";
import { prisma } from "../db.js";

export function registerProjectRoutes(app: FastifyInstance) {
  app.get("/api/projects", async () => {
    return prisma.project.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        _count: {
          select: {
            players: true,
            tournaments: true
          }
        }
      }
    });
  });

  app.post("/api/projects", async (request, reply) => {
    const input = createProjectSchema.parse(request.body);
    const project = await prisma.project.create({
      data: {
        name: input.name,
        slug: input.slug,
        description: input.description ?? null,
        defaultElo: input.defaultElo,
        scoringConfig: input.scoringConfig,
        eloEnabled: input.eloEnabled,
        wccEnabled: input.wccEnabled,
        wccRuleSets: {
          create: {
            name: "默认 WCC 100",
            level: "WCC_100",
            pointsTable: {
              CHAMPION: 100,
              FINALIST: 65,
              SEMIFINAL: 40,
              QUARTERFINAL: 20,
              ROUND_OF_16: 10,
              PARTICIPATION: 2
            },
            decayType: "FIXED_EXPIRY",
            decayConfig: { validDays: 365 }
          }
        }
      }
    });

    reply.status(201);
    return project;
  });

  app.get("/api/projects/:projectId", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        wccRuleSets: true,
        _count: {
          select: {
            players: true,
            tournaments: true
          }
        }
      }
    });
    if (!project) {
      reply.status(404);
      return { error: "Project not found" };
    }
    return project;
  });

  app.patch("/api/projects/:projectId", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const input = updateProjectSchema.parse(request.body);
    const existing = await prisma.project.findUnique({ where: { id: projectId } });
    if (!existing) {
      reply.status(404);
      return { error: "Project not found" };
    }
    if (input.slug && input.slug !== existing.slug) {
      const duplicated = await prisma.project.findUnique({ where: { slug: input.slug } });
      if (duplicated) {
        reply.status(409);
        return { error: "Project slug already exists" };
      }
    }

    return prisma.project.update({
      where: { id: projectId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.slug !== undefined ? { slug: input.slug } : {}),
        ...(input.description !== undefined ? { description: input.description || null } : {}),
        ...(input.defaultElo !== undefined ? { defaultElo: input.defaultElo } : {}),
        ...(input.scoringConfig !== undefined ? { scoringConfig: { ...readScoringConfig(existing.scoringConfig), ...input.scoringConfig } } : {}),
        ...(input.eloEnabled !== undefined ? { eloEnabled: input.eloEnabled } : {}),
        ...(input.wccEnabled !== undefined ? { wccEnabled: input.wccEnabled } : {})
      }
    });
  });

  app.post("/api/projects/:projectId/recalculate-ratings", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const body = request.body as { asOf?: string } | undefined;
    const query = request.query as { asOf?: string };
    const asOfText = body?.asOf ?? query.asOf;
    const asOf = asOfText ? new Date(asOfText) : new Date();
    if (Number.isNaN(asOf.getTime())) {
      reply.status(400);
      return { error: "Invalid asOf date" };
    }
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: { players: true }
    });
    if (!project) {
      reply.status(404);
      return { error: "Project not found" };
    }
    const scoringConfig = readScoringConfig(project.scoringConfig);

    const matches = await prisma.match.findMany({
      where: {
        tournament: { projectId },
        status: "COMPLETED",
        isBye: false,
        participantAId: { not: null },
        participantBId: { not: null },
        resultType: { not: null }
      },
      orderBy: [{ finishedAt: "asc" }, { createdAt: "asc" }],
      include: {
        tournament: true,
        participantA: true,
        participantB: true
      }
    });
    const wccEvents = await prisma.wccPointEvent.findMany({ where: { projectId }, include: { ruleSet: true } });

    const ratingState = new Map(
      project.players.map((player) => [
        player.id,
        {
          rating: project.defaultElo,
          matchesPlayed: 0,
          wins: 0,
          draws: 0,
          losses: 0,
          currentWcc: 0
        }
      ])
    );
    for (const event of wccEvents) {
      const state = ratingState.get(event.projectPlayerId);
      if (state) {
        const decaySnapshot = event.decaySnapshot as { decayType?: unknown } | null;
        const decayType = readWccDecayType(typeof decaySnapshot?.decayType === "string" ? decaySnapshot.decayType : event.ruleSet?.decayType);
        const decayConfig = (event.decaySnapshot ?? event.ruleSet?.decayConfig ?? {}) as {
          validDays?: number;
          fullDays?: number;
          steps?: Array<{ fromDay: number; multiplier: number }>;
        };
        state.currentWcc += calculateWccEffectivePoints(event.rawPoints, event.effectiveFrom, asOf, decayType, decayConfig);
      }
    }

    const historyRows: Prisma.EloRatingHistoryCreateManyInput[] = [];
    const processedMatchIds: string[] = [];
    for (const match of matches) {
      if (!match.participantA || !match.participantB || match.tournament.status === "CANCELLED") continue;
      const score = scoreFromResult(match.resultType as never);
      if (!score) continue;
      const stateA = ratingState.get(match.participantA.projectPlayerId);
      const stateB = ratingState.get(match.participantB.projectPlayerId);
      if (!stateA || !stateB) continue;

      const [scoreA, scoreB] = score;
      const beforeA = stateA.rating;
      const beforeB = stateB.rating;
      const next = match.tournament.eloEnabled
        ? calculateElo({ ratingA: beforeA, ratingB: beforeB, scoreA, kFactor: scoringConfig.eloKFactor })
        : {
            ratingA: beforeA,
            ratingB: beforeB,
            deltaA: 0,
            deltaB: 0,
            expectedA: 0,
            expectedB: 0
          };

      stateA.rating = next.ratingA;
      stateB.rating = next.ratingB;
      stateA.matchesPlayed += 1;
      stateB.matchesPlayed += 1;
      stateA.wins += scoreA === 1 ? 1 : 0;
      stateA.draws += scoreA === 0.5 ? 1 : 0;
      stateA.losses += scoreA === 0 ? 1 : 0;
      stateB.wins += scoreB === 1 ? 1 : 0;
      stateB.draws += scoreB === 0.5 ? 1 : 0;
      stateB.losses += scoreB === 0 ? 1 : 0;
      processedMatchIds.push(match.id);

      if (match.tournament.eloEnabled) {
        historyRows.push(
          {
            projectId,
            tournamentId: match.tournamentId,
            matchId: match.id,
            projectPlayerId: match.participantA.projectPlayerId,
            opponentProjectPlayerId: match.participantB.projectPlayerId,
            ratingBefore: beforeA,
            ratingAfter: next.ratingA,
            delta: next.deltaA,
            kFactor: scoringConfig.eloKFactor,
            expectedScore: next.expectedA,
            actualScore: scoreA,
            reason: "RECALCULATE"
          },
          {
            projectId,
            tournamentId: match.tournamentId,
            matchId: match.id,
            projectPlayerId: match.participantB.projectPlayerId,
            opponentProjectPlayerId: match.participantA.projectPlayerId,
            ratingBefore: beforeB,
            ratingAfter: next.ratingB,
            delta: next.deltaB,
            kFactor: scoringConfig.eloKFactor,
            expectedScore: next.expectedB,
            actualScore: scoreB,
            reason: "RECALCULATE"
          }
        );
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.eloRatingHistory.deleteMany({ where: { projectId } });
      await tx.match.updateMany({ where: { tournament: { projectId } }, data: { eloProcessedAt: null } });
      for (const [playerId, state] of ratingState) {
        await tx.projectPlayer.update({
          where: { id: playerId },
          data: {
            currentElo: state.rating,
            currentWcc: state.currentWcc,
            matchesPlayed: state.matchesPlayed,
            wins: state.wins,
            draws: state.draws,
            losses: state.losses
          }
        });
      }
      if (historyRows.length > 0) {
        await tx.eloRatingHistory.createMany({ data: historyRows });
      }
      if (processedMatchIds.length > 0) {
        await tx.match.updateMany({ where: { id: { in: processedMatchIds } }, data: { eloProcessedAt: new Date() } });
      }
    });

    return {
      recalculated: true,
      players: ratingState.size,
      matches: processedMatchIds.length,
      eloHistoryRows: historyRows.length,
      wccEvents: wccEvents.length,
      wccAsOf: asOf.toISOString()
    };
  });

  app.get("/api/projects/:projectId/players", async (request) => {
    const { projectId } = request.params as { projectId: string };
    return prisma.projectPlayer.findMany({
      where: { projectId, active: true },
      orderBy: [{ currentElo: "desc" }, { displayName: "asc" }],
      include: { player: true }
    });
  });

  app.post("/api/projects/:projectId/players", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const input = createPlayerSchema.parse(request.body);
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) {
      reply.status(404);
      return { error: "Project not found" };
    }
    if (input.code) {
      const existingCode = await prisma.projectPlayer.findUnique({ where: { projectId_code: { projectId, code: input.code } } });
      if (existingCode) {
        reply.status(409);
        return { error: "Player code already exists in this project" };
      }
    }

    const entry = await prisma
      .$transaction(async (tx) => {
        const player = await tx.player.create({
          data: {
            name: input.name,
            nickname: input.nickname ?? null,
            gender: input.gender ?? null,
            birthDate: input.birthDate ? new Date(input.birthDate) : null,
            country: input.country ?? null,
            region: input.region ?? null,
            club: input.club ?? null,
            contact: input.contact ?? null,
            avatarUrl: input.avatarUrl ?? null,
            note: input.note ?? null
          }
        });

        return tx.projectPlayer.create({
          data: {
            projectId,
            playerId: player.id,
            displayName: input.displayName ?? input.nickname ?? input.name,
            code: input.code ?? null,
            seedRank: input.seedRank ?? null,
            currentElo: project.defaultElo
          },
          include: { player: true }
        });
      })
      .catch((error: unknown) => {
        if (isUniqueConstraintError(error)) {
          reply.status(409);
          return { error: "Player code already exists in this project" };
        }
        throw error;
      });

    reply.status(201);
    return entry;
  });

  app.patch("/api/project-players/:projectPlayerId", async (request, reply) => {
    const { projectPlayerId } = request.params as { projectPlayerId: string };
    const input = updatePlayerSchema.parse(request.body);
    const entry = await prisma.projectPlayer.findUnique({
      where: { id: projectPlayerId },
      include: { player: true, project: true }
    });
    if (!entry) {
      reply.status(404);
      return { error: "Player entry not found" };
    }
    if (input.code) {
      const existingCode = await prisma.projectPlayer.findUnique({
        where: { projectId_code: { projectId: entry.projectId, code: input.code } }
      });
      if (existingCode && existingCode.id !== projectPlayerId) {
        reply.status(409);
        return { error: "Player code already exists in this project" };
      }
    }

    const updated = await prisma
      .$transaction(async (tx) => {
        await tx.player.update({
          where: { id: entry.playerId },
          data: {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.nickname !== undefined ? { nickname: input.nickname || null } : {}),
            ...(input.gender !== undefined ? { gender: input.gender || null } : {}),
            ...(input.birthDate !== undefined ? { birthDate: input.birthDate ? new Date(input.birthDate) : null } : {}),
            ...(input.country !== undefined ? { country: input.country || null } : {}),
            ...(input.region !== undefined ? { region: input.region || null } : {}),
            ...(input.club !== undefined ? { club: input.club || null } : {}),
            ...(input.contact !== undefined ? { contact: input.contact || null } : {}),
            ...(input.avatarUrl !== undefined ? { avatarUrl: input.avatarUrl || null } : {}),
            ...(input.note !== undefined ? { note: input.note || null } : {})
          }
        });

        return tx.projectPlayer.update({
          where: { id: projectPlayerId },
          data: {
            ...(input.displayName !== undefined ? { displayName: input.displayName || input.name || entry.displayName } : {}),
            ...(input.code !== undefined ? { code: input.code || null } : {}),
            ...(input.seedRank !== undefined ? { seedRank: input.seedRank ?? null } : {})
          },
          include: { player: true }
        });
      })
      .catch((error: unknown) => {
        if (isUniqueConstraintError(error)) {
          reply.status(409);
          return { error: "Player code already exists in this project" };
        }
        throw error;
      });

    return updated;
  });

  app.delete("/api/project-players/:projectPlayerId", async (request, reply) => {
    const { projectPlayerId } = request.params as { projectPlayerId: string };
    const entry = await prisma.projectPlayer.findUnique({ where: { id: projectPlayerId } });
    if (!entry) {
      reply.status(404);
      return { error: "Player entry not found" };
    }

    return prisma.projectPlayer.update({
      where: { id: projectPlayerId },
      data: { active: false },
      include: { player: true }
    });
  });

  app.get("/api/project-players/:projectPlayerId/history", async (request, reply) => {
    const { projectPlayerId } = request.params as { projectPlayerId: string };
    const entry = await prisma.projectPlayer.findUnique({ where: { id: projectPlayerId } });
    if (!entry) {
      reply.status(404);
      return { error: "Player entry not found" };
    }

    const matches = await prisma.match.findMany({
      where: {
        status: "COMPLETED",
        isBye: false,
        OR: [{ participantA: { projectPlayerId } }, { participantB: { projectPlayerId } }]
      },
      orderBy: [{ finishedAt: "desc" }, { createdAt: "desc" }],
      include: {
        tournament: true,
        round: true,
        participantA: { include: { projectPlayer: true } },
        participantB: { include: { projectPlayer: true } },
        winner: { include: { projectPlayer: true } }
      }
    });

    return matches.map((match) => {
      const isA = match.participantA?.projectPlayerId === projectPlayerId;
      const opponent = isA ? match.participantB?.projectPlayer : match.participantA?.projectPlayer;
      const ownScore = isA ? match.scoreA : match.scoreB;
      const opponentScore = isA ? match.scoreB : match.scoreA;
      return {
        matchId: match.id,
        tournamentId: match.tournamentId,
        tournamentName: match.tournament.name,
        roundName: match.round?.name ?? null,
        finishedAt: match.finishedAt,
        opponentProjectPlayerId: opponent?.id ?? null,
        opponentDisplayName: opponent?.displayName ?? "轮空",
        score: ownScore !== null && ownScore !== undefined && opponentScore !== null && opponentScore !== undefined ? `${ownScore}:${opponentScore}` : null,
        resultType: match.resultType,
        outcome: outcomeForProjectPlayer(match, projectPlayerId)
      };
    });
  });

  app.get("/api/project-players/:projectPlayerId/rating-history", async (request, reply) => {
    const { projectPlayerId } = request.params as { projectPlayerId: string };
    const entry = await prisma.projectPlayer.findUnique({ where: { id: projectPlayerId } });
    if (!entry) {
      reply.status(404);
      return { error: "Player entry not found" };
    }

    const [elo, wcc] = await Promise.all([
      prisma.eloRatingHistory.findMany({
        where: { projectPlayerId },
        orderBy: { createdAt: "desc" },
        include: {
          tournament: true,
          match: true,
          opponent: true
        }
      }),
      prisma.wccPointEvent.findMany({
        where: { projectPlayerId },
        orderBy: { effectiveFrom: "desc" },
        include: {
          tournament: true,
          ruleSet: true
        }
      })
    ]);

    return {
      elo: elo.map((event) => ({
        id: event.id,
        tournamentId: event.tournamentId,
        tournamentName: event.tournament?.name ?? null,
        matchId: event.matchId,
        opponentProjectPlayerId: event.opponentProjectPlayerId,
        opponentDisplayName: event.opponent?.displayName ?? null,
        ratingBefore: event.ratingBefore,
        ratingAfter: event.ratingAfter,
        delta: event.delta,
        kFactor: event.kFactor,
        expectedScore: event.expectedScore,
        actualScore: event.actualScore,
        reason: event.reason,
        createdAt: event.createdAt
      })),
      wcc: wcc.map((event) => ({
        id: event.id,
        tournamentId: event.tournamentId,
        tournamentName: event.tournament.name,
        ruleSetId: event.ruleSetId,
        ruleSetName: event.ruleSet?.name ?? null,
        finalRank: event.finalRank,
        achievement: event.achievement,
        rawPoints: event.rawPoints,
        effectiveFrom: event.effectiveFrom,
        expiresAt: event.expiresAt
      }))
    };
  });

  app.get("/api/projects/:projectId/wcc-rules", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) {
      reply.status(404);
      return { error: "Project not found" };
    }

    return prisma.wccRuleSet.findMany({
      where: { projectId },
      orderBy: [{ active: "desc" }, { createdAt: "desc" }]
    });
  });

  app.post("/api/projects/:projectId/wcc-rules", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const input = createWccRuleSetSchema.parse(request.body);
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) {
      reply.status(404);
      return { error: "Project not found" };
    }

    const ruleSet = await prisma.$transaction(async (tx) => {
      if (input.active) {
        await tx.wccRuleSet.updateMany({ where: { projectId }, data: { active: false } });
      }

      return tx.wccRuleSet.create({
        data: {
          projectId,
          name: input.name,
          level: input.level,
          pointsTable: input.pointsTable,
          decayType: input.decayType,
          decayConfig: input.decayConfig,
          active: input.active
        }
      });
    });

    reply.status(201);
    return ruleSet;
  });

  app.patch("/api/wcc-rules/:ruleSetId", async (request, reply) => {
    const { ruleSetId } = request.params as { ruleSetId: string };
    const input = updateWccRuleSetSchema.parse(request.body);
    const existing = await prisma.wccRuleSet.findUnique({ where: { id: ruleSetId } });
    if (!existing) {
      reply.status(404);
      return { error: "WCC rule set not found" };
    }

    return prisma.$transaction(async (tx) => {
      if (input.active) {
        await tx.wccRuleSet.updateMany({ where: { projectId: existing.projectId }, data: { active: false } });
      }

      return tx.wccRuleSet.update({
        where: { id: ruleSetId },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.level !== undefined ? { level: input.level } : {}),
          ...(input.pointsTable !== undefined ? { pointsTable: input.pointsTable } : {}),
          ...(input.decayType !== undefined ? { decayType: input.decayType } : {}),
          ...(input.decayConfig !== undefined ? { decayConfig: input.decayConfig } : {}),
          ...(input.active !== undefined ? { active: input.active } : {})
        }
      });
    });
  });
}

function readScoringConfig(value: Prisma.JsonValue | null): { eloKFactor: number } {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const config = value as { eloKFactor?: unknown };
    if (typeof config.eloKFactor === "number" && Number.isInteger(config.eloKFactor) && config.eloKFactor >= 1 && config.eloKFactor <= 100) {
      return { eloKFactor: config.eloKFactor };
    }
  }
  return { eloKFactor: 20 };
}

function readWccDecayType(value?: string | null): "FIXED_EXPIRY" | "STEP" | "LINEAR" {
  if (value === "STEP" || value === "LINEAR") return value;
  return "FIXED_EXPIRY";
}

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "P2002"
  );
}

function outcomeForProjectPlayer(
  match: {
    resultType: string | null;
    winner?: { projectPlayerId: string } | null;
  },
  projectPlayerId: string
): "WIN" | "LOSS" | "DRAW" | "CANCELLED" | "DOUBLE_WALKOVER" | "UNKNOWN" {
  if (match.resultType === "DRAW") return "DRAW";
  if (match.resultType === "CANCELLED") return "CANCELLED";
  if (match.resultType === "DOUBLE_WALKOVER") return "DOUBLE_WALKOVER";
  if (!match.winner) return "UNKNOWN";
  return match.winner.projectPlayerId === projectPlayerId ? "WIN" : "LOSS";
}
