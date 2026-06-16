import type { GeneratedMatch, ParticipantSeed } from "../types.js";

export function generateRoundRobin(participants: ParticipantSeed[], doubleRound = false): GeneratedMatch[] {
  const players = [...participants].sort((a, b) => (a.seed ?? 999_999) - (b.seed ?? 999_999));
  const hasBye = players.length % 2 === 1;
  const entries: Array<ParticipantSeed | null> = hasBye ? [...players, null] : players;
  const rounds = entries.length - 1;
  const matchesPerRound = entries.length / 2;
  const generated: GeneratedMatch[] = [];
  let rotating = entries.slice(1);

  for (let round = 1; round <= rounds; round += 1) {
    const current = [entries[0]!, ...rotating];
    for (let index = 0; index < matchesPerRound; index += 1) {
      const left = current[index] ?? null;
      const right = current[current.length - 1 - index] ?? null;
      if (!left || !right) {
        const participant = left ?? right;
        if (participant) {
          generated.push({
            roundNumber: round,
            name: `第 ${round} 轮`,
            participantAId: participant.id,
            isBye: true
          });
        }
        continue;
      }
      const swapHome = round % 2 === 0;
      generated.push({
        roundNumber: round,
        name: `第 ${round} 轮`,
        participantAId: swapHome ? right.id : left.id,
        participantBId: swapHome ? left.id : right.id
      });
    }
    rotating = [rotating[rotating.length - 1]!, ...rotating.slice(0, rotating.length - 1)];
  }

  if (!doubleRound) {
    return generated;
  }

  const secondLeg = generated
    .filter((match) => !match.isBye)
    .map((match) => ({
      ...match,
      roundNumber: match.roundNumber + rounds,
      name: `第 ${match.roundNumber + rounds} 轮`,
      participantAId: match.participantBId,
      participantBId: match.participantAId
    }));

  return [...generated, ...secondLeg];
}
