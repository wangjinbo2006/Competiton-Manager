import type { Prisma } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import {
  addParticipantSchema,
  assignCupGroups,
  calculateElo,
  calculateStandings,
  createTournamentSchema,
  generateRoundRobin,
  generateSingleElimination,
  generateSwissPairings,
  pointsForRank,
  recordMatchResultSchema,
  scoreFromResult,
  updateMatchSchema,
  updateParticipantSchema,
  updateTournamentSchema
} from "@competition-manager/shared";
import { prisma } from "../db.js";

export function registerTournamentRoutes(app: FastifyInstance) {
  app.get("/api/projects/:projectId/tournaments", async (request) => {
    const { projectId } = request.params as { projectId: string };
    return prisma.tournament.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      include: {
        _count: {
          select: {
            participants: true,
            matches: true
          }
        }
      }
    });
  });

  app.post("/api/projects/:projectId/tournaments", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const input = createTournamentSchema.parse(request.body);
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: { wccRuleSets: { where: { active: true }, take: 1 } }
    });

    if (!project) {
      reply.status(404);
      return { error: "Project not found" };
    }

    const tournament = await prisma.tournament.create({
      data: {
        projectId,
        name: input.name,
        level: input.level,
        format: input.format,
        startDate: input.startDate ? new Date(input.startDate) : null,
        endDate: input.endDate ? new Date(input.endDate) : null,
        registrationDeadline: input.registrationDeadline ? new Date(input.registrationDeadline) : null,
        location: input.location ?? null,
        organizer: input.organizer ?? null,
        description: input.description ?? null,
        eloEnabled: input.eloEnabled,
        wccEnabled: input.wccEnabled,
        wccRuleSetId: project.wccRuleSets[0]?.id ?? null,
        ...(input.config ? { drawConfig: input.config } : {}),
        stages: {
          create: {
            name: input.format === "CUP" ? "分组赛" : "主赛阶段",
            order: 1,
            format: input.format === "CUP" ? "ROUND_ROBIN" : input.format,
            ...(input.config ? { config: input.config } : {})
          }
        }
      },
      include: { stages: true }
    });

    reply.status(201);
    return tournament;
  });

  app.get("/api/tournaments/:tournamentId", async (request, reply) => {
    const { tournamentId } = request.params as { tournamentId: string };
    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: {
        stages: { orderBy: { order: "asc" } },
        rounds: { orderBy: [{ roundNumber: "asc" }, { createdAt: "asc" }] },
        participants: {
          orderBy: [{ seed: "asc" }, { createdAt: "asc" }],
          include: { projectPlayer: { include: { player: true } } }
        },
        matches: {
          orderBy: [{ round: { roundNumber: "asc" } }, { tableNumber: "asc" }],
          include: {
            participantA: { include: { projectPlayer: true } },
            participantB: { include: { projectPlayer: true } },
            winner: { include: { projectPlayer: true } },
            round: true,
            games: { orderBy: { gameNumber: "asc" } }
          }
        }
      }
    });
    if (!tournament) {
      reply.status(404);
      return { error: "Tournament not found" };
    }
    return tournament;
  });

  app.patch("/api/tournaments/:tournamentId", async (request, reply) => {
    const { tournamentId } = request.params as { tournamentId: string };
    const input = updateTournamentSchema.parse(request.body);
    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: { matches: { select: { id: true } }, stages: { orderBy: { order: "asc" }, take: 1 } }
    });
    if (!tournament) {
      reply.status(404);
      return { error: "Tournament not found" };
    }
    if (tournament.matches.length > 0 && input.config) {
      reply.status(400);
      return { error: "Draw config cannot be changed after matches are generated" };
    }

    const updated = await prisma.$transaction(async (tx) => {
      if (input.config && tournament.stages[0]) {
        await tx.tournamentStage.update({
          where: { id: tournament.stages[0].id },
          data: { config: input.config }
        });
      }

      return tx.tournament.update({
        where: { id: tournamentId },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.level !== undefined ? { level: input.level } : {}),
          ...(input.startDate !== undefined ? { startDate: input.startDate ? new Date(input.startDate) : null } : {}),
          ...(input.endDate !== undefined ? { endDate: input.endDate ? new Date(input.endDate) : null } : {}),
          ...(input.registrationDeadline !== undefined
            ? { registrationDeadline: input.registrationDeadline ? new Date(input.registrationDeadline) : null }
            : {}),
          ...(input.location !== undefined ? { location: input.location || null } : {}),
          ...(input.organizer !== undefined ? { organizer: input.organizer || null } : {}),
          ...(input.description !== undefined ? { description: input.description || null } : {}),
          ...(input.eloEnabled !== undefined ? { eloEnabled: input.eloEnabled } : {}),
          ...(input.wccEnabled !== undefined ? { wccEnabled: input.wccEnabled } : {}),
          ...(input.config !== undefined ? { drawConfig: input.config } : {})
        },
        include: { stages: true }
      });
    });

    return updated;
  });

  app.post("/api/tournaments/:tournamentId/cancel", async (request, reply) => {
    const { tournamentId } = request.params as { tournamentId: string };
    const tournament = await prisma.tournament.findUnique({ where: { id: tournamentId } });
    if (!tournament) {
      reply.status(404);
      return { error: "Tournament not found" };
    }
    if (tournament.status === "COMPLETED") {
      reply.status(400);
      return { error: "Completed tournaments cannot be cancelled" };
    }

    return prisma.tournament.update({
      where: { id: tournamentId },
      data: { status: "CANCELLED" }
    });
  });

  app.post("/api/tournaments/:tournamentId/participants", async (request, reply) => {
    const { tournamentId } = request.params as { tournamentId: string };
    const input = addParticipantSchema.parse(request.body);
    const tournament = await prisma.tournament.findUnique({ where: { id: tournamentId } });
    if (!tournament) {
      reply.status(404);
      return { error: "Tournament not found" };
    }
    if (tournament.status === "CANCELLED" || tournament.status === "COMPLETED") {
      reply.status(400);
      return { error: "Participants cannot be changed for cancelled or completed tournaments" };
    }

    const projectPlayer = await prisma.projectPlayer.findUnique({ where: { id: input.projectPlayerId } });
    if (!projectPlayer) {
      reply.status(404);
      return { error: "Project player not found" };
    }
    if (projectPlayer.projectId !== tournament.projectId) {
      reply.status(400);
      return { error: "Player belongs to another project" };
    }
    if (!projectPlayer.active) {
      reply.status(400);
      return { error: "Inactive players cannot be added to tournaments" };
    }

    const participant = await prisma.tournamentParticipant
      .create({
        data: {
          tournamentId,
          projectPlayerId: input.projectPlayerId,
          seed: input.seed ?? null
        },
        include: { projectPlayer: true }
      })
      .catch((error: unknown) => {
        if (isUniqueConstraintError(error)) {
          reply.status(409);
          return { error: "Player is already registered for this tournament" };
        }
        throw error;
      });
    reply.status(201);
    return participant;
  });

  app.patch("/api/tournaments/:tournamentId/participants/:participantId", async (request, reply) => {
    const { tournamentId, participantId } = request.params as { tournamentId: string; participantId: string };
    const input = updateParticipantSchema.parse(request.body);
    const participant = await prisma.tournamentParticipant.findUnique({
      where: { id: participantId },
      include: { tournament: { include: { matches: { select: { id: true } } } } }
    });

    if (!participant || participant.tournamentId !== tournamentId) {
      reply.status(404);
      return { error: "Tournament participant not found" };
    }
    if (participant.tournament.status === "CANCELLED" || participant.tournament.status === "COMPLETED") {
      reply.status(400);
      return { error: "Participants cannot be changed for cancelled or completed tournaments" };
    }
    if (participant.tournament.matches.length > 0) {
      reply.status(400);
      return { error: "Participants cannot be changed after matches are generated" };
    }

    const nextRegistrationStatus =
      input.registrationStatus ?? (input.checkedIn === true ? "CHECKED_IN" : input.checkedIn === false ? "REGISTERED" : undefined);
    const nextCheckedIn =
      input.checkedIn ?? (nextRegistrationStatus === "CHECKED_IN" ? true : nextRegistrationStatus === "WITHDRAWN" ? false : undefined);

    return prisma.tournamentParticipant.update({
      where: { id: participantId },
      data: {
        ...(input.seed !== undefined ? { seed: input.seed } : {}),
        ...(nextCheckedIn !== undefined ? { checkedIn: nextCheckedIn } : {}),
        ...(nextRegistrationStatus !== undefined ? { registrationStatus: nextRegistrationStatus } : {})
      },
      include: { projectPlayer: { include: { player: true } } }
    });
  });

  app.delete("/api/tournaments/:tournamentId/participants/:participantId", async (request, reply) => {
    const { tournamentId, participantId } = request.params as { tournamentId: string; participantId: string };
    const participant = await prisma.tournamentParticipant.findUnique({
      where: { id: participantId },
      include: { tournament: { include: { matches: { select: { id: true } } } } }
    });

    if (!participant || participant.tournamentId !== tournamentId) {
      reply.status(404);
      return { error: "Tournament participant not found" };
    }
    if (participant.tournament.status === "CANCELLED" || participant.tournament.status === "COMPLETED") {
      reply.status(400);
      return { error: "Participants cannot be changed for cancelled or completed tournaments" };
    }
    if (participant.tournament.matches.length > 0) {
      reply.status(400);
      return { error: "Participants cannot be changed after matches are generated" };
    }

    await prisma.tournamentParticipant.delete({ where: { id: participantId } });
    return { deleted: true };
  });

  app.post("/api/tournaments/:tournamentId/draw", async (request, reply) => {
    const { tournamentId } = request.params as { tournamentId: string };
    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: {
        stages: { orderBy: { order: "asc" }, take: 1 },
        participants: {
          orderBy: [{ seed: "asc" }, { createdAt: "asc" }],
          include: { projectPlayer: true }
        }
      }
    });

    if (!tournament || !tournament.stages[0]) {
      reply.status(404);
      return { error: "Tournament not found" };
    }
    if (tournament.status === "CANCELLED" || tournament.status === "COMPLETED") {
      reply.status(400);
      return { error: "Cancelled or completed tournaments cannot be drawn" };
    }

    const stage = tournament.stages[0];
    if (tournament.participants.length < 2) {
      reply.status(400);
      return { error: "At least two participants are required" };
    }

    const participants = tournament.participants.map((participant) => ({
      id: participant.id,
      displayName: participant.projectPlayer.displayName,
      seed: participant.seed
    }));
    if (tournament.format === "CUP") {
      const cupResult = await drawCupGroupStage(tournament, stage.id);
      return cupResult;
    }

    const generated =
      tournament.format === "ROUND_ROBIN"
        ? generateRoundRobin(participants)
        : tournament.format === "SWISS"
          ? generateSwissPairings(participants, [], { roundNumber: 1 })
          : generateSingleElimination(participants).matches;

    const result = await prisma.$transaction(async (tx) => {
      await tx.match.deleteMany({ where: { tournamentId } });
      await tx.round.deleteMany({ where: { tournamentId } });

      const rounds = new Map<number, string>();
      for (const roundNumber of [...new Set(generated.map((match) => match.roundNumber))]) {
        const round = await tx.round.create({
          data: {
            tournamentId,
            stageId: stage.id,
            roundNumber,
            name: generated.find((match) => match.roundNumber === roundNumber)?.name ?? `第 ${roundNumber} 轮`
          }
        });
        rounds.set(roundNumber, round.id);
      }

      for (const [index, match] of generated.entries()) {
        await tx.match.create({
          data: {
            tournamentId,
            stageId: stage.id,
            roundId: rounds.get(match.roundNumber) ?? null,
            bracketNodeKey: match.bracketNodeKey ?? null,
            tableNumber: index + 1,
            participantAId: match.participantAId ?? null,
            participantBId: match.participantBId ?? null,
            isBye: match.isBye ?? false,
            status: match.isBye ? "COMPLETED" : "SCHEDULED",
            resultType: match.isBye ? "BYE" : null,
            winnerParticipantId: match.isBye ? (match.participantAId ?? match.participantBId ?? null) : null
          }
        });
      }

      for (const match of generated.filter((item) => item.isBye && item.bracketNodeKey)) {
        const next = nextBracketSlot(match.bracketNodeKey!);
        if (next) {
          await tx.match.updateMany({
            where: { tournamentId, stageId: stage.id, bracketNodeKey: next.nodeKey },
            data: {
              [next.side === "A" ? "participantAId" : "participantBId"]: match.participantAId ?? match.participantBId ?? null
            }
          });
        }
      }

      return tx.tournament.update({
        where: { id: tournamentId },
        data: { status: "IN_PROGRESS" },
        include: { rounds: true, matches: true }
      });
    });

    return result;
  });

  app.post("/api/tournaments/:tournamentId/generate-knockout-stage", async (request, reply) => {
    const { tournamentId } = request.params as { tournamentId: string };
    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: {
        stages: { orderBy: { order: "asc" } },
        participants: {
          orderBy: [{ seed: "asc" }, { createdAt: "asc" }],
          include: { projectPlayer: true }
        },
        matches: {
          include: { group: true, stage: true }
        }
      }
    });

    if (!tournament) {
      reply.status(404);
      return { error: "Tournament not found" };
    }
    if (tournament.format !== "CUP") {
      reply.status(400);
      return { error: "Knockout stage generation is only supported for cup tournaments" };
    }
    if (tournament.status === "CANCELLED" || tournament.status === "COMPLETED") {
      reply.status(400);
      return { error: "Knockout stage cannot be generated for cancelled or completed tournaments" };
    }

    const groupStage = tournament.stages.find((stage) => stage.order === 1);
    if (!groupStage) {
      reply.status(400);
      return { error: "Cup group stage has not been created" };
    }

    const groupMatches = tournament.matches.filter((match) => match.stageId === groupStage.id);
    if (groupMatches.some((match) => match.status !== "COMPLETED")) {
      reply.status(400);
      return { error: "All group-stage matches must be completed before generating knockout stage" };
    }

    const groups = await prisma.tournamentGroup.findMany({
      where: { stageId: groupStage.id },
      orderBy: { order: "asc" }
    });
    const config = parseCupConfig(tournament.drawConfig);
    const standingsByGroup = groups.map((group) => {
      const matches = groupMatches.filter((match) => match.groupId === group.id);
      const participantIds = new Set(matches.flatMap((match) => [match.participantAId, match.participantBId].filter(Boolean)));
      const participants = tournament.participants.filter((participant) => participantIds.has(participant.id));
      return {
        group,
        standings: calculateTournamentStandings({ participants, matches })
      };
    });
    const qualifiers = standingsByGroup.flatMap((item) =>
      item.standings.slice(0, config.qualifyPerGroup).map((standing) => standing.participantId)
    );
    if (qualifiers.length < 2) {
      reply.status(400);
      return { error: "Not enough qualifiers for knockout stage" };
    }

    const participantById = new Map(tournament.participants.map((participant) => [participant.id, participant]));
    const knockoutParticipants = qualifiers.map((id, index) => ({
      id,
      displayName: participantById.get(id)?.projectPlayer.displayName ?? id,
      seed: index + 1
    }));
    const generated = generateSingleElimination(knockoutParticipants).matches;

    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.tournamentStage.findFirst({ where: { tournamentId, order: 2 } });
      if (existing) {
        await tx.match.deleteMany({ where: { tournamentId, stageId: existing.id } });
        await tx.round.deleteMany({ where: { tournamentId, stageId: existing.id } });
        await tx.tournamentStage.delete({ where: { id: existing.id } });
      }

      const knockoutStage = await tx.tournamentStage.create({
        data: {
          tournamentId,
          name: "淘汰赛",
          order: 2,
          format: "SINGLE_ELIMINATION",
          status: "IN_PROGRESS",
          config: { qualifiers }
        }
      });

      const rounds = new Map<number, string>();
      for (const roundNumber of [...new Set(generated.map((match) => match.roundNumber))]) {
        const round = await tx.round.create({
          data: {
            tournamentId,
            stageId: knockoutStage.id,
            roundNumber,
            name: generated.find((match) => match.roundNumber === roundNumber)?.name ?? `第 ${roundNumber} 轮`
          }
        });
        rounds.set(roundNumber, round.id);
      }

      for (const [index, match] of generated.entries()) {
        await tx.match.create({
          data: {
            tournamentId,
            stageId: knockoutStage.id,
            roundId: rounds.get(match.roundNumber) ?? null,
            bracketNodeKey: match.bracketNodeKey ?? null,
            tableNumber: index + 1,
            participantAId: match.participantAId ?? null,
            participantBId: match.participantBId ?? null,
            isBye: match.isBye ?? false,
            status: match.isBye ? "COMPLETED" : "SCHEDULED",
            resultType: match.isBye ? "BYE" : null,
            winnerParticipantId: match.isBye ? (match.participantAId ?? match.participantBId ?? null) : null
          }
        });
      }

      for (const match of generated.filter((item) => item.isBye && item.bracketNodeKey)) {
        const next = nextBracketSlot(match.bracketNodeKey!);
        if (next) {
          await tx.match.updateMany({
            where: { tournamentId, stageId: knockoutStage.id, bracketNodeKey: next.nodeKey },
            data: {
              [next.side === "A" ? "participantAId" : "participantBId"]: match.participantAId ?? match.participantBId ?? null
            }
          });
        }
      }

      return tx.tournamentStage.findUnique({
        where: { id: knockoutStage.id },
        include: { rounds: { include: { matches: true } } }
      });
    });

    return result;
  });

  app.post("/api/tournaments/:tournamentId/generate-next-round", async (request, reply) => {
    const { tournamentId } = request.params as { tournamentId: string };
    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: {
        stages: { orderBy: { order: "asc" }, take: 1 },
        participants: {
          orderBy: [{ seed: "asc" }, { createdAt: "asc" }],
          include: { projectPlayer: true }
        },
        matches: {
          include: { round: true }
        }
      }
    });

    if (!tournament || !tournament.stages[0]) {
      reply.status(404);
      return { error: "Tournament not found" };
    }
    if (tournament.format !== "SWISS") {
      reply.status(400);
      return { error: "Next round generation is currently supported for Swiss tournaments" };
    }
    if (tournament.status === "CANCELLED" || tournament.status === "COMPLETED") {
      reply.status(400);
      return { error: "Next round cannot be generated for cancelled or completed tournaments" };
    }
    if (tournament.matches.some((match) => match.status !== "COMPLETED")) {
      reply.status(400);
      return { error: "All existing matches must be completed before generating the next Swiss round" };
    }

    const stage = tournament.stages[0];
    const nextRoundNumber = Math.max(0, ...tournament.matches.map((match) => match.round?.roundNumber ?? 0)) + 1;
    const participants = tournament.participants.map((participant) => ({
      id: participant.id,
      displayName: participant.projectPlayer.displayName,
      seed: participant.seed
    }));
    const previousMatches = tournament.matches.map((match) => ({
      participantAId: match.participantAId,
      participantBId: match.participantBId,
      scoreA: match.scoreA,
      scoreB: match.scoreB,
      resultType: match.resultType,
      isBye: match.isBye
    }));
    const generated = generateSwissPairings(participants, previousMatches, { roundNumber: nextRoundNumber });

    const result = await prisma.$transaction(async (tx) => {
      const round = await tx.round.create({
        data: {
          tournamentId,
          stageId: stage.id,
          roundNumber: nextRoundNumber,
          name: `第 ${nextRoundNumber} 轮`
        }
      });

      for (const [index, match] of generated.entries()) {
        await tx.match.create({
          data: {
            tournamentId,
            stageId: stage.id,
            roundId: round.id,
            tableNumber: index + 1,
            participantAId: match.participantAId ?? null,
            participantBId: match.participantBId ?? null,
            isBye: match.isBye ?? false,
            status: match.isBye ? "COMPLETED" : "SCHEDULED",
            resultType: match.isBye ? "BYE" : null,
            winnerParticipantId: match.isBye ? (match.participantAId ?? match.participantBId ?? null) : null
          }
        });
      }

      return tx.round.findUnique({
        where: { id: round.id },
        include: { matches: true }
      });
    });

    return result;
  });

  app.get("/api/tournaments/:tournamentId/standings", async (request, reply) => {
    const { tournamentId } = request.params as { tournamentId: string };
    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: {
        participants: {
          orderBy: [{ seed: "asc" }, { createdAt: "asc" }],
          include: { projectPlayer: true }
        },
        matches: true
      }
    });

    if (!tournament) {
      reply.status(404);
      return { error: "Tournament not found" };
    }

    return calculateTournamentStandings(tournament);
  });

  app.get("/api/tournaments/:tournamentId/crosstable", async (request, reply) => {
    const { tournamentId } = request.params as { tournamentId: string };
    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: {
        participants: {
          orderBy: [{ seed: "asc" }, { createdAt: "asc" }],
          include: { projectPlayer: true }
        },
        matches: {
          where: { isBye: false },
          include: { round: true }
        }
      }
    });

    if (!tournament) {
      reply.status(404);
      return { error: "Tournament not found" };
    }
    if (tournament.format !== "ROUND_ROBIN") {
      reply.status(400);
      return { error: "Crosstable is only available for round-robin tournaments" };
    }

    return buildRoundRobinCrosstable(tournament);
  });

  app.get("/api/tournaments/:tournamentId/bracket", async (request, reply) => {
    const { tournamentId } = request.params as { tournamentId: string };
    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: {
        stages: { where: { format: "SINGLE_ELIMINATION" }, orderBy: { order: "asc" } },
        matches: {
          where: { bracketNodeKey: { not: null } },
          orderBy: [{ round: { roundNumber: "asc" } }, { bracketNodeKey: "asc" }],
          include: {
            participantA: { include: { projectPlayer: true } },
            participantB: { include: { projectPlayer: true } },
            winner: { include: { projectPlayer: true } },
            round: true,
            stage: true
          }
        }
      }
    });

    if (!tournament) {
      reply.status(404);
      return { error: "Tournament not found" };
    }
    if (tournament.stages.length === 0 || tournament.matches.length === 0) {
      reply.status(400);
      return { error: "Bracket is only available after an elimination draw is generated" };
    }

    return buildEliminationBracket(tournament.matches);
  });

  app.patch("/api/matches/:matchId", async (request, reply) => {
    const { matchId } = request.params as { matchId: string };
    const input = updateMatchSchema.parse(request.body);
    const match = await prisma.match.findUnique({
      where: { id: matchId },
      include: { tournament: true, participantA: true, participantB: true }
    });

    if (!match) {
      reply.status(404);
      return { error: "Match not found" };
    }
    if (match.isBye) {
      reply.status(400);
      return { error: "Bye matches cannot be updated" };
    }
    if (match.tournament.status === "CANCELLED" || match.tournament.status === "COMPLETED") {
      reply.status(400);
      return { error: "Matches cannot be updated for cancelled or completed tournaments" };
    }
    if (match.status === "COMPLETED") {
      reply.status(400);
      return { error: "Completed matches cannot be rescheduled" };
    }
    if (input.status === "IN_PROGRESS" && (!match.participantAId || !match.participantBId)) {
      reply.status(400);
      return { error: "Matches without both participants cannot be started" };
    }

    const statusData =
      input.status === "CANCELLED"
        ? { status: "CANCELLED" as const, resultType: "CANCELLED" as const, finishedAt: new Date() }
        : input.status !== undefined
          ? { status: input.status }
          : {};

    return prisma.match.update({
      where: { id: matchId },
      data: {
        ...(input.tableNumber !== undefined ? { tableNumber: input.tableNumber } : {}),
        ...(input.startsAt !== undefined ? { startsAt: input.startsAt ? new Date(input.startsAt) : null } : {}),
        ...statusData
      },
      include: {
        participantA: { include: { projectPlayer: true } },
        participantB: { include: { projectPlayer: true } },
        winner: { include: { projectPlayer: true } },
        round: true
      }
    });
  });

  app.patch("/api/matches/:matchId/result", async (request, reply) => {
    const { matchId } = request.params as { matchId: string };
    const input = recordMatchResultSchema.parse(request.body);
    const match = await prisma.match.findUnique({
      where: { id: matchId },
      include: {
        tournament: { include: { project: true } },
        participantA: { include: { projectPlayer: true } },
        participantB: { include: { projectPlayer: true } }
      }
    });

    if (!match || !match.participantA || !match.participantB) {
      reply.status(404);
      return { error: "Match not found or missing participants" };
    }
    if (match.tournament.status === "CANCELLED" || match.tournament.status === "COMPLETED") {
      reply.status(400);
      return { error: "Results cannot be recorded for cancelled or completed tournaments" };
    }
    if (match.status === "COMPLETED") {
      reply.status(400);
      return { error: "Completed match results cannot be overwritten; recalculate ratings after administrative corrections" };
    }
    if (match.status === "CANCELLED") {
      reply.status(400);
      return { error: "Cancelled match results cannot be recorded" };
    }

    const winnerParticipantId =
      input.resultType === "A_WIN" || input.resultType === "B_WALKOVER"
        ? match.participantAId
        : input.resultType === "B_WIN" || input.resultType === "A_WALKOVER"
          ? match.participantBId
          : null;

    const participantA = match.participantA;
    const participantB = match.participantB;

    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.match.update({
        where: { id: matchId },
        data: {
          scoreA: input.scoreA,
          scoreB: input.scoreB,
          resultType: input.resultType,
          winnerParticipantId,
          status: "COMPLETED",
          finishedAt: new Date()
        }
      });
      await tx.matchGame.deleteMany({ where: { matchId } });
      if (input.games && input.games.length > 0) {
        await tx.matchGame.createMany({
          data: input.games.map((game) => ({
            matchId,
            gameNumber: game.gameNumber,
            scoreA: game.scoreA ?? null,
            scoreB: game.scoreB ?? null,
            winnerSide: game.winnerSide ?? inferGameWinner(game.scoreA, game.scoreB)
          }))
        });
      }

      const score = scoreFromResult(input.resultType);
      if (score && match.tournament.eloEnabled && !match.eloProcessedAt) {
        const [scoreA, scoreB] = score;
        const playerA = participantA.projectPlayer;
        const playerB = participantB.projectPlayer;
        const scoringConfig = readScoringConfig(match.tournament.project.scoringConfig);
        const eloA = calculateElo({
          ratingA: playerA.currentElo,
          ratingB: playerB.currentElo,
          scoreA,
          kFactor: scoringConfig.eloKFactor
        });

        await tx.projectPlayer.update({
          where: { id: playerA.id },
          data: {
            currentElo: eloA.ratingA,
            matchesPlayed: { increment: 1 },
            wins: { increment: scoreA === 1 ? 1 : 0 },
            draws: { increment: scoreA === 0.5 ? 1 : 0 },
            losses: { increment: scoreA === 0 ? 1 : 0 }
          }
        });
        await tx.projectPlayer.update({
          where: { id: playerB.id },
          data: {
            currentElo: eloA.ratingB,
            matchesPlayed: { increment: 1 },
            wins: { increment: scoreB === 1 ? 1 : 0 },
            draws: { increment: scoreB === 0.5 ? 1 : 0 },
            losses: { increment: scoreB === 0 ? 1 : 0 }
          }
        });

        await tx.eloRatingHistory.createMany({
          data: [
            {
              projectId: match.tournament.projectId,
              tournamentId: match.tournamentId,
              matchId: match.id,
              projectPlayerId: playerA.id,
              opponentProjectPlayerId: playerB.id,
              ratingBefore: playerA.currentElo,
              ratingAfter: eloA.ratingA,
              delta: eloA.deltaA,
              kFactor: scoringConfig.eloKFactor,
              expectedScore: eloA.expectedA,
              actualScore: scoreA,
              reason: "MATCH_RESULT"
            },
            {
              projectId: match.tournament.projectId,
              tournamentId: match.tournamentId,
              matchId: match.id,
              projectPlayerId: playerB.id,
              opponentProjectPlayerId: playerA.id,
              ratingBefore: playerB.currentElo,
              ratingAfter: eloA.ratingB,
              delta: eloA.deltaB,
              kFactor: scoringConfig.eloKFactor,
              expectedScore: eloA.expectedB,
              actualScore: scoreB,
              reason: "MATCH_RESULT"
            }
          ]
        });

        await tx.match.update({ where: { id: matchId }, data: { eloProcessedAt: new Date() } });
      }

      if (winnerParticipantId && match.bracketNodeKey) {
        const next = nextBracketSlot(match.bracketNodeKey);
        if (next) {
          await tx.match.updateMany({
            where: { tournamentId: match.tournamentId, stageId: match.stageId, bracketNodeKey: next.nodeKey },
            data: {
              [next.side === "A" ? "participantAId" : "participantBId"]: winnerParticipantId
            }
          });
        }
      }

      return saved;
    });

    return updated;
  });

  app.post("/api/matches/:matchId/reopen", async (request, reply) => {
    const { matchId } = request.params as { matchId: string };
    const match = await prisma.match.findUnique({
      where: { id: matchId },
      include: { tournament: true }
    });

    if (!match) {
      reply.status(404);
      return { error: "Match not found" };
    }
    if (match.isBye) {
      reply.status(400);
      return { error: "Bye matches cannot be reopened" };
    }
    if (match.tournament.status === "CANCELLED" || match.tournament.status === "COMPLETED") {
      reply.status(400);
      return { error: "Results cannot be reopened for cancelled or completed tournaments" };
    }
    if (match.status !== "COMPLETED") {
      reply.status(400);
      return { error: "Only completed matches can be reopened" };
    }

    const next = match.bracketNodeKey ? nextBracketSlot(match.bracketNodeKey) : null;
    const nextMatch = next
      ? await prisma.match.findFirst({
          where: { tournamentId: match.tournamentId, stageId: match.stageId, bracketNodeKey: next.nodeKey }
        })
      : null;
    if (nextMatch?.status === "COMPLETED") {
      reply.status(400);
      return { error: "Downstream bracket match is already completed" };
    }

    const reopened = await prisma.$transaction(async (tx) => {
      if (next && nextMatch) {
        await tx.match.update({
          where: { id: nextMatch.id },
          data: {
            [next.side === "A" ? "participantAId" : "participantBId"]: null
          }
        });
      }

      await tx.eloRatingHistory.deleteMany({ where: { matchId } });
      await tx.matchGame.deleteMany({ where: { matchId } });

      return tx.match.update({
        where: { id: matchId },
        data: {
          scoreA: null,
          scoreB: null,
          resultType: null,
          winnerParticipantId: null,
          status: "SCHEDULED",
          finishedAt: null,
          eloProcessedAt: null
        }
      });
    });

    return { reopened: true, projectId: match.tournament.projectId, match: reopened };
  });

  app.post("/api/tournaments/:tournamentId/complete", async (request, reply) => {
    const { tournamentId } = request.params as { tournamentId: string };
    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: {
        participants: { orderBy: [{ seed: "asc" }, { createdAt: "asc" }], include: { projectPlayer: true } },
        matches: true,
        wccRuleSet: true
      }
    });

    if (!tournament) {
      reply.status(404);
      return { error: "Tournament not found" };
    }
    if (tournament.status === "CANCELLED") {
      reply.status(400);
      return { error: "Cancelled tournaments cannot be completed" };
    }
    if (tournament.status === "COMPLETED") {
      reply.status(400);
      return { error: "Tournament is already completed" };
    }
    if (tournament.matches.length === 0) {
      reply.status(400);
      return { error: "Tournament cannot be completed before matches are generated" };
    }
    const unfinishedMatches = tournament.matches.filter(
      (match) => !match.isBye && (match.status !== "COMPLETED" || !match.participantAId || !match.participantBId)
    );
    if (unfinishedMatches.length > 0) {
      reply.status(400);
      return { error: "All generated non-bye matches must be completed before completing the tournament" };
    }

    const standings = calculateTournamentStandings(tournament);
    const participantById = new Map(tournament.participants.map((participant) => [participant.id, participant]));

    const completed = await prisma.$transaction(async (tx) => {
      await tx.wccPointEvent.deleteMany({ where: { tournamentId } });

      for (const row of standings) {
        const participant = participantById.get(row.participantId);
        if (!participant) continue;
        const rank = row.rank;
        const pointsTable = (tournament.wccRuleSet?.pointsTable as Record<string, number> | undefined) ?? {};
        const rawPoints = tournament.wccEnabled ? pointsForRank(rank, pointsTable) : 0;
        const decayConfig = (tournament.wccRuleSet?.decayConfig as Record<string, unknown> | null) ?? { validDays: 365 };
        const decaySnapshot = {
          decayType: tournament.wccRuleSet?.decayType ?? "FIXED_EXPIRY",
          ...decayConfig
        };

        await tx.tournamentParticipant.update({
          where: { id: participant.id },
          data: { finalRank: rank, finalStandingData: JSON.parse(JSON.stringify(row)), wccPointsAwarded: rawPoints }
        });

        const wccDelta = rawPoints - (participant.wccPointsAwarded ?? 0);

        if (rawPoints > 0 && tournament.wccEnabled) {
          await tx.wccPointEvent.create({
            data: {
              projectId: tournament.projectId,
              tournamentId,
              projectPlayerId: participant.projectPlayerId,
              ruleSetId: tournament.wccRuleSetId,
              finalRank: rank,
              achievement: achievementForRank(rank),
              rawPoints,
              effectiveFrom: tournament.endDate ?? new Date(),
              expiresAt: new Date((tournament.endDate ?? new Date()).getTime() + 365 * 86_400_000),
              decaySnapshot
            }
          });
        }

        if (wccDelta !== 0 && tournament.wccEnabled) {
          await tx.projectPlayer.update({
            where: { id: participant.projectPlayerId },
            data: { currentWcc: { increment: wccDelta } }
          });
        }
      }

      return tx.tournament.update({
        where: { id: tournamentId },
        data: { status: "COMPLETED", endDate: tournament.endDate ?? new Date() }
      });
    });

    return completed;
  });
}

async function drawCupGroupStage(
  tournament: {
    id: string;
    drawConfig: unknown;
    participants: Array<{ id: string; seed: number | null; projectPlayer: { displayName: string } }>;
  },
  stageId: string
) {
  const config = parseCupConfig(tournament.drawConfig);
  const participants = tournament.participants.map((participant) => ({
    id: participant.id,
    displayName: participant.projectPlayer.displayName,
    seed: participant.seed
  }));
  const groups = assignCupGroups(participants, config.groupCount);

  return prisma.$transaction(async (tx) => {
    await tx.match.deleteMany({ where: { tournamentId: tournament.id } });
    await tx.round.deleteMany({ where: { tournamentId: tournament.id } });
    await tx.tournamentGroup.deleteMany({ where: { stageId } });

    const roundIds = new Map<number, string>();
    const groupRecords = new Map<number, string>();

    for (const group of groups) {
      const record = await tx.tournamentGroup.create({
        data: {
          stageId,
          name: group.groupName,
          order: group.order
        }
      });
      groupRecords.set(group.order, record.id);
    }

    const generatedByGroup = groups.map((group) => ({
      group,
      matches: generateRoundRobin(group.participants)
    }));

    for (const roundNumber of [
      ...new Set(generatedByGroup.flatMap((item) => item.matches.map((match) => match.roundNumber)))
    ]) {
      const round = await tx.round.create({
        data: {
          tournamentId: tournament.id,
          stageId,
          roundNumber,
          name: `小组赛第 ${roundNumber} 轮`
        }
      });
      roundIds.set(roundNumber, round.id);
    }

    let tableNumber = 1;
    for (const item of generatedByGroup) {
      for (const match of item.matches) {
        await tx.match.create({
          data: {
            tournamentId: tournament.id,
            stageId,
            groupId: groupRecords.get(item.group.order) ?? null,
            roundId: roundIds.get(match.roundNumber) ?? null,
            tableNumber,
            participantAId: match.participantAId ?? null,
            participantBId: match.participantBId ?? null,
            isBye: match.isBye ?? false,
            status: match.isBye ? "COMPLETED" : "SCHEDULED",
            resultType: match.isBye ? "BYE" : null,
            winnerParticipantId: match.isBye ? (match.participantAId ?? match.participantBId ?? null) : null
          }
        });
        tableNumber += 1;
      }
    }

    await tx.tournamentStage.update({
      where: { id: stageId },
      data: {
        status: "IN_PROGRESS",
        config: {
          groupCount: config.groupCount,
          qualifyPerGroup: config.qualifyPerGroup
        }
      }
    });

    return tx.tournament.update({
      where: { id: tournament.id },
      data: { status: "IN_PROGRESS" },
      include: {
        stages: true,
        rounds: true,
        matches: true
      }
    });
  });
}

function parseCupConfig(value: unknown): { groupCount: number; qualifyPerGroup: number } {
  if (value && typeof value === "object") {
    const config = value as { groupCount?: unknown; qualifyPerGroup?: unknown };
    return {
      groupCount: typeof config.groupCount === "number" && config.groupCount > 0 ? Math.floor(config.groupCount) : 2,
      qualifyPerGroup:
        typeof config.qualifyPerGroup === "number" && config.qualifyPerGroup > 0
          ? Math.floor(config.qualifyPerGroup)
          : 2
    };
  }
  return { groupCount: 2, qualifyPerGroup: 2 };
}

function calculateTournamentStandings(tournament: {
  participants: Array<{ id: string; seed: number | null; projectPlayer: { displayName: string } }>;
  matches: Array<{
    participantAId: string | null;
    participantBId: string | null;
    scoreA: number | null;
    scoreB: number | null;
    resultType: string | null;
    isBye: boolean;
  }>;
}) {
  return calculateStandings(
    tournament.participants.map((participant) => ({
      id: participant.id,
      displayName: participant.projectPlayer.displayName,
      seed: participant.seed
    })),
    tournament.matches.map((match) => ({
      participantAId: match.participantAId,
      participantBId: match.participantBId,
      scoreA: match.scoreA,
      scoreB: match.scoreB,
      resultType: match.resultType as never,
      isBye: match.isBye
    }))
  );
}

function buildRoundRobinCrosstable(tournament: {
  participants: Array<{ id: string; seed: number | null; projectPlayer: { displayName: string } }>;
  matches: Array<{
    id: string;
    participantAId: string | null;
    participantBId: string | null;
    scoreA: number | null;
    scoreB: number | null;
    resultType: string | null;
    status: string;
    round: { name: string; roundNumber: number } | null;
  }>;
}) {
  const participants = tournament.participants.map((participant) => ({
    participantId: participant.id,
    displayName: participant.projectPlayer.displayName,
    seed: participant.seed
  }));
  const matchesByPair = new Map<string, (typeof tournament.matches)[number]>();

  for (const match of tournament.matches) {
    if (!match.participantAId || !match.participantBId) continue;
    matchesByPair.set(pairKey(match.participantAId, match.participantBId), match);
  }

  return {
    columns: participants,
    rows: participants.map((rowParticipant) => ({
      participantId: rowParticipant.participantId,
      displayName: rowParticipant.displayName,
      seed: rowParticipant.seed,
      cells: participants.map((columnParticipant) =>
        buildCrosstableCell(rowParticipant.participantId, columnParticipant.participantId, matchesByPair)
      )
    }))
  };
}

function buildEliminationBracket(
  matches: Array<{
    id: string;
    bracketNodeKey: string | null;
    scoreA: number | null;
    scoreB: number | null;
    resultType: string | null;
    status: string;
    isBye: boolean;
    round: { name: string; roundNumber: number } | null;
    stage: { id: string; name: string; order: number } | null;
    participantA: { id: string; seed: number | null; projectPlayer: { displayName: string } } | null;
    participantB: { id: string; seed: number | null; projectPlayer: { displayName: string } } | null;
    winner: { id: string; projectPlayer: { displayName: string } } | null;
  }>
) {
  const roundsByKey = new Map<string, { stageId: string | null; stageName: string | null; roundNumber: number; roundName: string; matches: unknown[] }>();

  for (const match of matches) {
    if (!match.bracketNodeKey) continue;
    const parsed = parseBracketNodeKey(match.bracketNodeKey);
    const roundNumber = match.round?.roundNumber ?? parsed?.roundNumber ?? 0;
    const key = `${match.stage?.id ?? "stage"}:${roundNumber}`;
    const round =
      roundsByKey.get(key) ??
      {
        stageId: match.stage?.id ?? null,
        stageName: match.stage?.name ?? null,
        roundNumber,
        roundName: match.round?.name ?? `第 ${roundNumber} 轮`,
        matches: []
      };

    round.matches.push({
      id: match.id,
      bracketNodeKey: match.bracketNodeKey,
      matchNumber: parsed?.matchNumber ?? 0,
      status: match.status,
      resultType: match.resultType,
      isBye: match.isBye,
      scoreA: match.scoreA,
      scoreB: match.scoreB,
      participantA: match.participantA
        ? { id: match.participantA.id, displayName: match.participantA.projectPlayer.displayName, seed: match.participantA.seed }
        : null,
      participantB: match.participantB
        ? { id: match.participantB.id, displayName: match.participantB.projectPlayer.displayName, seed: match.participantB.seed }
        : null,
      winnerParticipantId: match.winner?.id ?? null,
      winnerDisplayName: match.winner?.projectPlayer.displayName ?? null
    });
    roundsByKey.set(key, round);
  }

  const rounds = [...roundsByKey.values()]
    .sort((a, b) => a.roundNumber - b.roundNumber)
    .map((round) => ({
      ...round,
      matches: round.matches.sort((a, b) => {
        const matchA = a as { matchNumber: number };
        const matchB = b as { matchNumber: number };
        return matchA.matchNumber - matchB.matchNumber;
      })
    }));

  return { rounds };
}

function parseBracketNodeKey(bracketNodeKey: string): { roundNumber: number; matchNumber: number } | null {
  const match = /^R(\d+)-M(\d+)$/.exec(bracketNodeKey);
  if (!match) return null;
  return { roundNumber: Number(match[1]), matchNumber: Number(match[2]) };
}

function buildCrosstableCell(
  rowParticipantId: string,
  columnParticipantId: string,
  matchesByPair: Map<
    string,
    {
      id: string;
      participantAId: string | null;
      participantBId: string | null;
      scoreA: number | null;
      scoreB: number | null;
      resultType: string | null;
      status: string;
      round: { name: string; roundNumber: number } | null;
    }
  >
) {
  if (rowParticipantId === columnParticipantId) {
    return { opponentParticipantId: columnParticipantId, result: "SELF", label: "-", status: "SELF" };
  }

  const match = matchesByPair.get(pairKey(rowParticipantId, columnParticipantId));
  if (!match) {
    return { opponentParticipantId: columnParticipantId, result: "MISSING", label: "", status: "MISSING" };
  }

  const rowIsA = match.participantAId === rowParticipantId;
  const scoreFor = rowIsA ? match.scoreA : match.scoreB;
  const scoreAgainst = rowIsA ? match.scoreB : match.scoreA;
  const result = resultFromPerspective(match.resultType, rowIsA);
  const scoreLabel = scoreFor !== null && scoreAgainst !== null ? `${scoreFor}-${scoreAgainst}` : "";
  const resultLabel =
    result === "PENDING" ? "待赛" : result === "CANCELLED" ? "取消" : result === "DOUBLE_WALKOVER" ? "双弃" : result;

  return {
    opponentParticipantId: columnParticipantId,
    matchId: match.id,
    roundName: match.round?.name ?? null,
    roundNumber: match.round?.roundNumber ?? null,
    status: match.status,
    result,
    scoreFor,
    scoreAgainst,
    label: scoreLabel ? `${resultLabel} ${scoreLabel}` : resultLabel
  };
}

function resultFromPerspective(resultType: string | null, rowIsA: boolean): string {
  if (!resultType) return "PENDING";
  if (resultType === "DRAW") return "D";
  if (resultType === "CANCELLED") return "CANCELLED";
  if (resultType === "DOUBLE_WALKOVER") return "DOUBLE_WALKOVER";
  if (resultType === "A_WIN" || resultType === "B_WALKOVER") return rowIsA ? "W" : "L";
  if (resultType === "B_WIN" || resultType === "A_WALKOVER") return rowIsA ? "L" : "W";
  return "PENDING";
}

function pairKey(participantAId: string, participantBId: string): string {
  return [participantAId, participantBId].sort().join(":");
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

function achievementForRank(rank: number): string {
  if (rank <= 1) return "CHAMPION";
  if (rank === 2) return "FINALIST";
  if (rank <= 4) return "SEMIFINAL";
  if (rank <= 8) return "QUARTERFINAL";
  if (rank <= 16) return "ROUND_OF_16";
  if (rank <= 32) return "ROUND_OF_32";
  return "PARTICIPATION";
}

function nextBracketSlot(bracketNodeKey: string): { nodeKey: string; side: "A" | "B" } | null {
  const match = /^R(\d+)-M(\d+)$/.exec(bracketNodeKey);
  if (!match) return null;
  const round = Number.parseInt(match[1]!, 10);
  const matchNumber = Number.parseInt(match[2]!, 10);
  if (!Number.isFinite(round) || !Number.isFinite(matchNumber)) return null;
  return {
    nodeKey: `R${round + 1}-M${Math.ceil(matchNumber / 2)}`,
    side: matchNumber % 2 === 1 ? "A" : "B"
  };
}

function inferGameWinner(scoreA: number | null | undefined, scoreB: number | null | undefined): string | null {
  if (scoreA === null || scoreA === undefined || scoreB === null || scoreB === undefined) return null;
  if (scoreA > scoreB) return "A";
  if (scoreB > scoreA) return "B";
  return "DRAW";
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002";
}
