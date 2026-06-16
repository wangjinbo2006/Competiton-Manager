export type WccDecayType = "FIXED_EXPIRY" | "STEP" | "LINEAR";

export interface WccDecayConfig {
  validDays?: number;
  fullDays?: number;
  steps?: Array<{ fromDay: number; multiplier: number }>;
}

export function calculateWccEffectivePoints(
  rawPoints: number,
  eventDate: Date,
  asOf: Date,
  decayType: WccDecayType,
  config: WccDecayConfig = {}
): number {
  const ageMs = asOf.getTime() - eventDate.getTime();
  const ageDays = Math.floor(ageMs / 86_400_000);

  if (ageDays < 0) {
    return rawPoints;
  }

  if (decayType === "FIXED_EXPIRY") {
    const validDays = config.validDays ?? 365;
    return ageDays <= validDays ? rawPoints : 0;
  }

  if (decayType === "LINEAR") {
    const fullDays = config.fullDays ?? 0;
    const validDays = Math.max(config.validDays ?? 365, fullDays);
    if (ageDays <= fullDays) return rawPoints;
    if (ageDays >= validDays) return 0;
    const decayWindow = validDays - fullDays;
    const remaining = (validDays - ageDays) / decayWindow;
    return Math.round(rawPoints * Math.max(0, Math.min(1, remaining)));
  }

  const steps = [...(config.steps ?? [])].sort((a, b) => b.fromDay - a.fromDay);
  const matched = steps.find((step) => ageDays >= step.fromDay);
  return Math.round(rawPoints * (matched?.multiplier ?? 1));
}

export function achievementFromRank(rank: number): string {
  if (rank <= 1) return "CHAMPION";
  if (rank === 2) return "FINALIST";
  if (rank <= 4) return "SEMIFINAL";
  if (rank <= 8) return "QUARTERFINAL";
  if (rank <= 16) return "ROUND_OF_16";
  if (rank <= 32) return "ROUND_OF_32";
  return "PARTICIPATION";
}

export function pointsForRank(rank: number, pointsTable: Record<string, number>): number {
  return pointsTable[achievementFromRank(rank)] ?? pointsTable.PARTICIPATION ?? 0;
}
