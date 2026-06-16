import { describe, expect, it } from "vitest";
import { calculateElo } from "./elo.js";
import { assignCupGroups, selectCupQualifiers } from "./cup.js";
import { generateRoundRobin } from "./roundRobin.js";
import { generateSingleElimination } from "./singleElimination.js";
import { calculateStandings } from "./standings.js";
import { generateSwissPairings } from "./swiss.js";
import { calculateWccEffectivePoints, pointsForRank } from "./wcc.js";

describe("core competition algorithms", () => {
  it("calculates Elo deltas for an upset", () => {
    const result = calculateElo({ ratingA: 1200, ratingB: 1400, scoreA: 1, kFactor: 20 });
    expect(result.deltaA).toBeGreaterThan(10);
    expect(result.deltaB).toBeLessThan(-10);
    expect(result.ratingA + result.ratingB).toBe(2600);
  });

  it("generates round robin pairings with byes for odd player counts", () => {
    const matches = generateRoundRobin([
      { id: "a", displayName: "A" },
      { id: "b", displayName: "B" },
      { id: "c", displayName: "C" }
    ]);
    expect(matches.filter((match) => match.isBye)).toHaveLength(3);
    expect(matches.filter((match) => !match.isBye)).toHaveLength(3);
  });

  it("generates a single elimination bracket with byes", () => {
    const draw = generateSingleElimination([
      { id: "a", displayName: "A", seed: 1 },
      { id: "b", displayName: "B", seed: 2 },
      { id: "c", displayName: "C", seed: 3 },
      { id: "d", displayName: "D", seed: 4 },
      { id: "e", displayName: "E", seed: 5 }
    ]);
    const firstRound = draw.matches.filter((match) => match.roundNumber === 1);

    expect(draw.bracketSize).toBe(8);
    expect(draw.matches).toHaveLength(7);
    expect(firstRound.filter((match) => match.isBye)).toHaveLength(3);
    expect(firstRound.filter((match) => match.isBye).map((match) => match.participantAId ?? match.participantBId)).toEqual([
      "a",
      "b",
      "c"
    ]);
    expect(firstRound.some((match) => match.participantAId === "d" && match.participantBId === "e")).toBe(true);
  });

  it("calculates WCC fixed expiry and rank points", () => {
    const eventDate = new Date("2026-01-01T00:00:00.000Z");
    expect(
      calculateWccEffectivePoints(100, eventDate, new Date("2026-06-01T00:00:00.000Z"), "FIXED_EXPIRY", {
        validDays: 365
      })
    ).toBe(100);
    expect(
      calculateWccEffectivePoints(100, eventDate, new Date("2027-06-01T00:00:00.000Z"), "FIXED_EXPIRY", {
        validDays: 365
      })
    ).toBe(0);
    expect(pointsForRank(1, { CHAMPION: 1000, FINALIST: 650 })).toBe(1000);
  });

  it("calculates WCC linear decay after the full-value window", () => {
    const eventDate = new Date("2026-01-01T00:00:00.000Z");
    expect(
      calculateWccEffectivePoints(100, eventDate, new Date("2026-03-01T00:00:00.000Z"), "LINEAR", {
        fullDays: 90,
        validDays: 190
      })
    ).toBe(100);
    expect(
      calculateWccEffectivePoints(100, eventDate, new Date("2026-05-01T00:00:00.000Z"), "LINEAR", {
        fullDays: 90,
        validDays: 190
      })
    ).toBe(70);
    expect(
      calculateWccEffectivePoints(100, eventDate, new Date("2026-08-01T00:00:00.000Z"), "LINEAR", {
        fullDays: 90,
        validDays: 190
      })
    ).toBe(0);
  });

  it("calculates tournament standings from match results", () => {
    const standings = calculateStandings(
      [
        { id: "a", displayName: "A", seed: 1 },
        { id: "b", displayName: "B", seed: 2 },
        { id: "c", displayName: "C", seed: 3 }
      ],
      [
        { participantAId: "a", participantBId: "b", scoreA: 1, scoreB: 0, resultType: "A_WIN" },
        { participantAId: "a", participantBId: "c", scoreA: 0.5, scoreB: 0.5, resultType: "DRAW" },
        { participantAId: "b", isBye: true, resultType: "BYE" }
      ]
    );

    expect(standings.map((row) => [row.participantId, row.points])).toEqual([
      ["a", 1.5],
      ["b", 1],
      ["c", 0.5]
    ]);
    expect(standings[0]?.buchholz).toBe(1.5);
  });

  it("generates swiss pairings while avoiding repeats and assigning a bye", () => {
    const pairings = generateSwissPairings(
      [
        { id: "a", displayName: "A", seed: 1 },
        { id: "b", displayName: "B", seed: 2 },
        { id: "c", displayName: "C", seed: 3 },
        { id: "d", displayName: "D", seed: 4 },
        { id: "e", displayName: "E", seed: 5 }
      ],
      [
        { participantAId: "a", participantBId: "b", scoreA: 1, scoreB: 0, resultType: "A_WIN" },
        { participantAId: "c", participantBId: "d", scoreA: 1, scoreB: 0, resultType: "A_WIN" },
        { participantAId: "e", isBye: true, resultType: "BYE" }
      ],
      { roundNumber: 2 }
    );

    expect(pairings).toHaveLength(3);
    expect(pairings.filter((match) => match.isBye)).toHaveLength(1);
    expect(
      pairings.some(
        (match) =>
          [match.participantAId, match.participantBId].includes("a") &&
          [match.participantAId, match.participantBId].includes("b")
      )
    ).toBe(false);
  });

  it("assigns cup groups and selects qualifiers", () => {
    const groups = assignCupGroups(
      Array.from({ length: 8 }, (_, index) => ({
        id: `p${index + 1}`,
        displayName: `P${index + 1}`,
        seed: index + 1
      })),
      2
    );
    expect(groups.map((group) => group.participants.map((participant) => participant.id))).toEqual([
      ["p1", "p4", "p5", "p8"],
      ["p2", "p3", "p6", "p7"]
    ]);

    const qualifiers = selectCupQualifiers(
      [
        {
          groupName: "A 组",
          rows: [
            { participantId: "p1", displayName: "P1", rank: 1, matchesPlayed: 1, wins: 1, draws: 0, losses: 0, points: 1, scoreFor: 1, scoreAgainst: 0, scoreDiff: 1, buchholz: 0, hadBye: false },
            { participantId: "p4", displayName: "P4", rank: 2, matchesPlayed: 1, wins: 0, draws: 0, losses: 1, points: 0, scoreFor: 0, scoreAgainst: 1, scoreDiff: -1, buchholz: 1, hadBye: false }
          ]
        },
        {
          groupName: "B 组",
          rows: [
            { participantId: "p2", displayName: "P2", rank: 1, matchesPlayed: 1, wins: 1, draws: 0, losses: 0, points: 1, scoreFor: 1, scoreAgainst: 0, scoreDiff: 1, buchholz: 0, hadBye: false },
            { participantId: "p3", displayName: "P3", rank: 2, matchesPlayed: 1, wins: 0, draws: 0, losses: 1, points: 0, scoreFor: 0, scoreAgainst: 1, scoreDiff: -1, buchholz: 1, hadBye: false }
          ]
        }
      ],
      1
    );
    expect(qualifiers.map((row) => row.participantId)).toEqual(["p1", "p2"]);
  });
});
