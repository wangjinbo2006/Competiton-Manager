import type { CupGroupAssignment, ParticipantSeed, StandingRow } from "../types.js";

export function assignCupGroups(participants: ParticipantSeed[], groupCount: number): CupGroupAssignment[] {
  const sorted = [...participants].sort((a, b) => (a.seed ?? 999_999) - (b.seed ?? 999_999));
  const groups: CupGroupAssignment[] = Array.from({ length: groupCount }, (_, index) => ({
    groupName: `${String.fromCharCode(65 + index)} 组`,
    order: index + 1,
    participants: []
  }));

  sorted.forEach((participant, index) => {
    const cycle = Math.floor(index / groupCount);
    const offset = index % groupCount;
    const groupIndex = cycle % 2 === 0 ? offset : groupCount - 1 - offset;
    groups[groupIndex]?.participants.push(participant);
  });

  return groups;
}

export function selectCupQualifiers(
  groupStandings: Array<{ groupName: string; rows: StandingRow[] }>,
  qualifyPerGroup: number
): StandingRow[] {
  return groupStandings
    .flatMap((group) => group.rows.slice(0, qualifyPerGroup).map((row) => ({ ...row, displayName: row.displayName })))
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        b.points - a.points ||
        b.buchholz - a.buchholz ||
        b.scoreDiff - a.scoreDiff ||
        a.displayName.localeCompare(b.displayName)
    );
}
