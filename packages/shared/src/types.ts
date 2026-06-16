export type StageFormat = "SINGLE_ELIMINATION" | "ROUND_ROBIN" | "SWISS" | "CUP";

export type MatchResultType =
  | "A_WIN"
  | "B_WIN"
  | "DRAW"
  | "A_WALKOVER"
  | "B_WALKOVER"
  | "DOUBLE_WALKOVER"
  | "BYE"
  | "CANCELLED";

export interface StandingRow {
  participantId: string;
  displayName: string;
  rank: number;
  matchesPlayed: number;
  wins: number;
  draws: number;
  losses: number;
  points: number;
  scoreFor: number;
  scoreAgainst: number;
  scoreDiff: number;
  buchholz: number;
  hadBye: boolean;
}

export interface ParticipantSeed {
  id: string;
  displayName: string;
  seed?: number | null;
}

export interface GeneratedMatch {
  roundNumber: number;
  name: string;
  participantAId?: string | undefined;
  participantBId?: string | undefined;
  bracketNodeKey?: string | undefined;
  isBye?: boolean | undefined;
}

export interface StandingParticipant {
  id: string;
  displayName: string;
  seed?: number | null;
}

export interface StandingMatch {
  participantAId?: string | null;
  participantBId?: string | null;
  scoreA?: number | null;
  scoreB?: number | null;
  resultType?: MatchResultType | null;
  isBye?: boolean | null;
}

export interface CupGroupAssignment {
  groupName: string;
  order: number;
  participants: ParticipantSeed[];
}
