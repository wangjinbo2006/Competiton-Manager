import type { GeneratedMatch, ParticipantSeed } from "../types.js";

export interface SingleEliminationDraw {
  bracketSize: number;
  rounds: number;
  matches: GeneratedMatch[];
}

export function nextPowerOfTwo(value: number): number {
  if (value < 2) return 2;
  return 2 ** Math.ceil(Math.log2(value));
}

export function generateSingleElimination(participants: ParticipantSeed[]): SingleEliminationDraw {
  const sorted = [...participants].sort((a, b) => (a.seed ?? 999_999) - (b.seed ?? 999_999));
  const bracketSize = nextPowerOfTwo(sorted.length);
  const rounds = Math.log2(bracketSize);
  const slots: Array<ParticipantSeed | null> = Array.from({ length: bracketSize }, () => null);
  const seedPositions = getSeedPositions(bracketSize);

  sorted.forEach((participant, index) => {
    slots[seedPositions[index] ?? index] = participant;
  });

  const matches: GeneratedMatch[] = [];
  for (let index = 0; index < bracketSize; index += 2) {
    const participantA = slots[index];
    const participantB = slots[index + 1];
    matches.push({
      roundNumber: 1,
      name: "首轮",
      participantAId: participantA?.id,
      participantBId: participantB?.id,
      bracketNodeKey: `R1-M${index / 2 + 1}`,
      isBye: Boolean((participantA && !participantB) || (!participantA && participantB))
    });
  }

  for (let round = 2; round <= rounds; round += 1) {
    const count = bracketSize / 2 ** round;
    for (let match = 1; match <= count; match += 1) {
      matches.push({
        roundNumber: round,
        name: roundName(round, rounds),
        bracketNodeKey: `R${round}-M${match}`
      });
    }
  }

  return { bracketSize, rounds, matches };
}

function getSeedPositions(bracketSize: number): number[] {
  const seedOrder = getSeedOrder(bracketSize);
  const positions: number[] = [];
  seedOrder.forEach((seed, slotIndex) => {
    positions[seed - 1] = slotIndex;
  });
  return positions;
}

function getSeedOrder(bracketSize: number): number[] {
  if (bracketSize <= 2) return [1, 2];
  const previous = getSeedOrder(bracketSize / 2);
  return previous.flatMap((seed) => [seed, bracketSize + 1 - seed]);
}

function roundName(round: number, totalRounds: number): string {
  if (round === totalRounds) return "决赛";
  if (round === totalRounds - 1) return "半决赛";
  if (round === totalRounds - 2) return "四分之一决赛";
  return `第 ${round} 轮`;
}
