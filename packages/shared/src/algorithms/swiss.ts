import type { GeneratedMatch, StandingMatch, StandingParticipant } from "../types.js";
import { calculateStandings } from "./standings.js";

export interface SwissPairingOptions {
  roundNumber: number;
  byePoints?: number;
}

export function generateSwissPairings(
  participants: StandingParticipant[],
  previousMatches: StandingMatch[],
  options: SwissPairingOptions
): GeneratedMatch[] {
  const standings = calculateStandings(
    participants,
    previousMatches,
    options.byePoints === undefined ? {} : { byePoints: options.byePoints }
  );
  const alreadyPlayed = buildPlayedSet(previousMatches);
  const unpaired = [...standings];
  const matches: GeneratedMatch[] = [];

  if (unpaired.length % 2 === 1) {
    const byeIndex = findByeIndex(unpaired);
    const [byePlayer] = unpaired.splice(byeIndex, 1);
    if (byePlayer) {
      matches.push({
        roundNumber: options.roundNumber,
        name: `第 ${options.roundNumber} 轮`,
        participantAId: byePlayer.participantId,
        isBye: true
      });
    }
  }

  while (unpaired.length > 0) {
    const player = unpaired.shift();
    if (!player) break;

    let opponentIndex = unpaired.findIndex((candidate) => !alreadyPlayed.has(pairKey(player.participantId, candidate.participantId)));
    if (opponentIndex < 0) opponentIndex = 0;
    const opponent = unpaired.splice(opponentIndex, 1)[0];
    if (!opponent) break;

    matches.push({
      roundNumber: options.roundNumber,
      name: `第 ${options.roundNumber} 轮`,
      participantAId: player.participantId,
      participantBId: opponent.participantId
    });
  }

  return matches;
}

function findByeIndex(rows: ReturnType<typeof calculateStandings>): number {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    if (!rows[index]?.hadBye) return index;
  }
  return rows.length - 1;
}

function buildPlayedSet(matches: StandingMatch[]): Set<string> {
  const played = new Set<string>();
  for (const match of matches) {
    if (match.participantAId && match.participantBId) {
      played.add(pairKey(match.participantAId, match.participantBId));
    }
  }
  return played;
}

function pairKey(a: string, b: string): string {
  return [a, b].sort().join("::");
}
