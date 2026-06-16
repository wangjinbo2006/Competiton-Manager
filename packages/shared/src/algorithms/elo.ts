export interface EloInput {
  ratingA: number;
  ratingB: number;
  scoreA: number;
  kFactor: number;
}

export interface EloResult {
  expectedA: number;
  expectedB: number;
  ratingA: number;
  ratingB: number;
  deltaA: number;
  deltaB: number;
}

export function expectedScore(rating: number, opponentRating: number): number {
  return 1 / (1 + 10 ** ((opponentRating - rating) / 400));
}

export function calculateElo(input: EloInput): EloResult {
  const expectedA = expectedScore(input.ratingA, input.ratingB);
  const expectedB = expectedScore(input.ratingB, input.ratingA);
  const scoreB = 1 - input.scoreA;
  const deltaA = Math.round(input.kFactor * (input.scoreA - expectedA));
  const deltaB = Math.round(input.kFactor * (scoreB - expectedB));

  return {
    expectedA,
    expectedB,
    ratingA: input.ratingA + deltaA,
    ratingB: input.ratingB + deltaB,
    deltaA,
    deltaB
  };
}

export function scoreFromResult(resultType: string): [number, number] | null {
  switch (resultType) {
    case "A_WIN":
    case "B_WALKOVER":
      return [1, 0];
    case "B_WIN":
    case "A_WALKOVER":
      return [0, 1];
    case "DRAW":
      return [0.5, 0.5];
    default:
      return null;
  }
}
