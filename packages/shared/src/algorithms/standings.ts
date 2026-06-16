import type { MatchResultType, StandingMatch, StandingParticipant, StandingRow } from "../types.js";

export interface StandingOptions {
  winPoints?: number;
  drawPoints?: number;
  lossPoints?: number;
  byePoints?: number;
}

export function calculateStandings(
  participants: StandingParticipant[],
  matches: StandingMatch[],
  options: StandingOptions = {}
): StandingRow[] {
  const winPoints = options.winPoints ?? 1;
  const drawPoints = options.drawPoints ?? 0.5;
  const lossPoints = options.lossPoints ?? 0;
  const byePoints = options.byePoints ?? winPoints;

  const rows = new Map<string, StandingRow>();
  const opponentIdsByParticipant = new Map<string, string[]>();

  for (const participant of participants) {
    rows.set(participant.id, {
      participantId: participant.id,
      displayName: participant.displayName,
      rank: 0,
      matchesPlayed: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      points: 0,
      scoreFor: 0,
      scoreAgainst: 0,
      scoreDiff: 0,
      buchholz: 0,
      hadBye: false
    });
    opponentIdsByParticipant.set(participant.id, []);
  }

  for (const match of matches) {
    if (match.resultType === "CANCELLED" || match.resultType === "DOUBLE_WALKOVER") continue;

    if (match.isBye && match.resultType === "BYE") {
      const byeParticipantId = match.participantAId ?? match.participantBId;
      const row = byeParticipantId ? rows.get(byeParticipantId) : undefined;
      if (row) {
        row.points += byePoints;
        row.wins += 1;
        row.hadBye = true;
      }
      continue;
    }

    if (!match.participantAId || !match.participantBId || !match.resultType) continue;

    const rowA = rows.get(match.participantAId);
    const rowB = rows.get(match.participantBId);
    if (!rowA || !rowB) continue;

    opponentIdsByParticipant.get(rowA.participantId)?.push(rowB.participantId);
    opponentIdsByParticipant.get(rowB.participantId)?.push(rowA.participantId);

    rowA.matchesPlayed += 1;
    rowB.matchesPlayed += 1;
    rowA.scoreFor += match.scoreA ?? 0;
    rowA.scoreAgainst += match.scoreB ?? 0;
    rowB.scoreFor += match.scoreB ?? 0;
    rowB.scoreAgainst += match.scoreA ?? 0;

    const [pointsA, pointsB] = pointsForResult(match.resultType, winPoints, drawPoints, lossPoints);
    applyResult(rowA, pointsA, winPoints, drawPoints);
    applyResult(rowB, pointsB, winPoints, drawPoints);
  }

  for (const row of rows.values()) {
    row.scoreDiff = row.scoreFor - row.scoreAgainst;
  }

  for (const row of rows.values()) {
    row.buchholz = (opponentIdsByParticipant.get(row.participantId) ?? []).reduce(
      (sum, opponentId) => sum + (rows.get(opponentId)?.points ?? 0),
      0
    );
  }

  const seedById = new Map(participants.map((participant, index) => [participant.id, participant.seed ?? index + 1]));
  return [...rows.values()]
    .sort(
      (a, b) =>
        b.points - a.points ||
        b.buchholz - a.buchholz ||
        b.wins - a.wins ||
        b.scoreDiff - a.scoreDiff ||
        b.scoreFor - a.scoreFor ||
        (seedById.get(a.participantId) ?? 999_999) - (seedById.get(b.participantId) ?? 999_999) ||
        a.displayName.localeCompare(b.displayName)
    )
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

function pointsForResult(
  resultType: MatchResultType,
  winPoints: number,
  drawPoints: number,
  lossPoints: number
): [number, number] {
  switch (resultType) {
    case "A_WIN":
    case "B_WALKOVER":
      return [winPoints, lossPoints];
    case "B_WIN":
    case "A_WALKOVER":
      return [lossPoints, winPoints];
    case "DRAW":
      return [drawPoints, drawPoints];
    default:
      return [0, 0];
  }
}

function applyResult(row: StandingRow, points: number, winPoints: number, drawPoints: number): void {
  row.points += points;
  if (points === winPoints) row.wins += 1;
  else if (points === drawPoints) row.draws += 1;
  else row.losses += 1;
}
