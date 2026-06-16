import type { FastifyInstance } from "fastify";
import { calculateWccEffectivePoints } from "@competition-manager/shared";
import { prisma } from "../db.js";

export function registerRankingRoutes(app: FastifyInstance) {
  app.get("/api/projects/:projectId/rankings/elo", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    if (!(await ensureProject(projectId))) {
      reply.status(404);
      return { error: "Project not found" };
    }
    const players = await prisma.projectPlayer.findMany({
      where: { projectId, active: true },
      orderBy: [{ currentElo: "desc" }, { displayName: "asc" }],
      include: { player: true }
    });
    return players.map((player, index) => ({ rank: index + 1, ...player }));
  });

  app.get("/api/projects/:projectId/rankings/wcc", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    if (!(await ensureProject(projectId))) {
      reply.status(404);
      return { error: "Project not found" };
    }
    const query = request.query as { asOf?: string };
    const asOf = query.asOf ? new Date(query.asOf) : new Date();
    const players = await prisma.projectPlayer.findMany({
      where: { projectId, active: true },
      include: {
        player: true,
        wccEvents: {
          include: { ruleSet: true }
        }
      }
    });

    return withEffectiveWcc(players, asOf)
      .sort((a, b) => b.effectiveWcc - a.effectiveWcc || a.displayName.localeCompare(b.displayName))
      .map((player, index) => ({ rank: index + 1, ...player }));
  });

  app.get("/api/projects/:projectId/rankings/combined", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    if (!(await ensureProject(projectId))) {
      reply.status(404);
      return { error: "Project not found" };
    }
    const query = request.query as { asOf?: string };
    const asOf = query.asOf ? new Date(query.asOf) : new Date();
    const players = await prisma.projectPlayer.findMany({
      where: { projectId, active: true },
      include: {
        player: true,
        wccEvents: {
          include: { ruleSet: true }
        }
      }
    });

    const withWcc = withEffectiveWcc(players, asOf);
    const eloOrder = [...withWcc].sort((a, b) => b.currentElo - a.currentElo || a.displayName.localeCompare(b.displayName));
    const wccOrder = [...withWcc].sort((a, b) => b.effectiveWcc - a.effectiveWcc || a.displayName.localeCompare(b.displayName));
    const eloRankById = new Map(eloOrder.map((player, index) => [player.id, index + 1]));
    const wccRankById = new Map(wccOrder.map((player, index) => [player.id, index + 1]));

    return withWcc
      .map((player) => {
        const eloRank = eloRankById.get(player.id) ?? withWcc.length;
        const wccRank = wccRankById.get(player.id) ?? withWcc.length;
        return {
          ...player,
          eloRank,
          wccRank,
          combinedScore: eloRank + wccRank
        };
      })
      .sort(
        (a, b) =>
          a.combinedScore - b.combinedScore ||
          a.eloRank - b.eloRank ||
          b.effectiveWcc - a.effectiveWcc ||
          a.displayName.localeCompare(b.displayName)
      )
      .map((player, index) => ({ rank: index + 1, ...player }));
  });
}

async function ensureProject(projectId: string): Promise<boolean> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true }
  });
  return Boolean(project);
}

type PlayerWithWccEvents = Awaited<ReturnType<typeof prisma.projectPlayer.findMany>>[number] & {
  wccEvents: Array<{
    rawPoints: number;
    effectiveFrom: Date;
    decaySnapshot: unknown;
    ruleSet: {
      decayType: string;
      decayConfig: unknown;
    } | null;
  }>;
};

function withEffectiveWcc<T extends PlayerWithWccEvents>(players: T[], asOf: Date) {
  return players.map((player) => {
    const effectiveWcc = player.wccEvents.reduce((sum, event) => {
      const decaySnapshot = event.decaySnapshot as { decayType?: unknown } | null;
      const decayType = readWccDecayType(typeof decaySnapshot?.decayType === "string" ? decaySnapshot.decayType : event.ruleSet?.decayType);
      const decayConfig = (event.decaySnapshot ?? event.ruleSet?.decayConfig ?? {}) as {
        validDays?: number;
        fullDays?: number;
        steps?: Array<{ fromDay: number; multiplier: number }>;
      };
      return sum + calculateWccEffectivePoints(event.rawPoints, event.effectiveFrom, asOf, decayType, decayConfig);
    }, 0);

    return {
      ...player,
      effectiveWcc
    };
  });
}

function readWccDecayType(value?: string | null): "FIXED_EXPIRY" | "STEP" | "LINEAR" {
  if (value === "STEP" || value === "LINEAR") return value;
  return "FIXED_EXPIRY";
}
