export interface Project {
  id: string;
  name: string;
  slug: string;
  description?: string;
  defaultElo: number;
  scoringConfig?: {
    eloKFactor?: number;
  };
  eloEnabled?: boolean;
  wccEnabled?: boolean;
  _count?: {
    players: number;
    tournaments: number;
  };
}

export interface ProjectPlayer {
  id: string;
  displayName: string;
  code?: string;
  seedRank?: number;
  currentElo: number;
  currentWcc: number;
  matchesPlayed: number;
  wins: number;
  draws: number;
  losses: number;
  active?: boolean;
  player?: {
    name: string;
    nickname?: string;
    gender?: string;
    birthDate?: string;
    country?: string;
    region?: string;
    club?: string;
    contact?: string;
    avatarUrl?: string;
    note?: string;
  };
}

export interface PlayerMatchHistoryItem {
  matchId: string;
  tournamentId: string;
  tournamentName: string;
  roundName?: string | null;
  finishedAt?: string | null;
  opponentProjectPlayerId?: string | null;
  opponentDisplayName: string;
  score?: string | null;
  resultType?: MatchResultType | "DOUBLE_WALKOVER" | "CANCELLED" | null;
  outcome: "WIN" | "LOSS" | "DRAW" | "CANCELLED" | "DOUBLE_WALKOVER" | "UNKNOWN";
}

export interface PlayerRatingHistory {
  elo: Array<{
    id: string;
    tournamentId?: string | null;
    tournamentName?: string | null;
    matchId?: string | null;
    opponentProjectPlayerId?: string | null;
    opponentDisplayName?: string | null;
    ratingBefore: number;
    ratingAfter: number;
    delta: number;
    kFactor: number;
    expectedScore: number;
    actualScore: number;
    reason?: string | null;
    createdAt: string;
  }>;
  wcc: Array<{
    id: string;
    tournamentId: string;
    tournamentName: string;
    ruleSetId?: string | null;
    ruleSetName?: string | null;
    finalRank: number;
    achievement: string;
    rawPoints: number;
    effectiveFrom: string;
    expiresAt?: string | null;
  }>;
}

export interface RankingPlayer extends ProjectPlayer {
  rank: number;
  effectiveWcc?: number;
  eloRank?: number;
  wccRank?: number;
  combinedScore?: number;
}

export interface Tournament {
  id: string;
  name: string;
  format: TournamentFormat;
  status: string;
  level?: string;
  startDate?: string | null;
  endDate?: string | null;
  registrationDeadline?: string | null;
  location?: string;
  organizer?: string;
  description?: string;
  eloEnabled?: boolean;
  wccEnabled?: boolean;
  drawConfig?: TournamentConfig;
  participants?: TournamentParticipant[];
  matches?: Match[];
  _count?: {
    participants: number;
    matches: number;
  };
}

export type TournamentFormat = "SINGLE_ELIMINATION" | "ROUND_ROBIN" | "SWISS" | "CUP";

export interface TournamentConfig {
  groupCount?: number;
  qualifyPerGroup?: number;
}

export type MatchResultType =
  | "A_WIN"
  | "B_WIN"
  | "DRAW"
  | "A_WALKOVER"
  | "B_WALKOVER"
  | "DOUBLE_WALKOVER"
  | "CANCELLED";

export interface TournamentParticipant {
  id: string;
  projectPlayerId: string;
  seed?: number;
  checkedIn?: boolean;
  registrationStatus?: "REGISTERED" | "CHECKED_IN" | "WITHDRAWN";
  finalRank?: number;
  wccPointsAwarded?: number;
  projectPlayer: ProjectPlayer;
}

export interface Match {
  id: string;
  round?: {
    name: string;
    roundNumber: number;
  };
  bracketNodeKey?: string;
  tableNumber?: number;
  status: string;
  startsAt?: string | null;
  finishedAt?: string | null;
  scoreA?: number;
  scoreB?: number;
  resultType?: MatchResultType | "BYE";
  isBye: boolean;
  participantA?: TournamentParticipant;
  participantB?: TournamentParticipant;
  winner?: TournamentParticipant;
  games?: MatchGame[];
}

export interface MatchGame {
  id: string;
  gameNumber: number;
  scoreA?: number | null;
  scoreB?: number | null;
  winnerSide?: "A" | "B" | "DRAW" | null;
}

export interface StandingRow {
  participantId: string;
  displayName: string;
  rank: number;
  matchesPlayed: number;
  wins: number;
  draws: number;
  losses: number;
  points: number;
  buchholz: number;
}

export interface Crosstable {
  columns: CrosstableParticipant[];
  rows: CrosstableRow[];
}

export interface CrosstableParticipant {
  participantId: string;
  displayName: string;
  seed?: number | null;
}

export interface CrosstableRow extends CrosstableParticipant {
  cells: CrosstableCell[];
}

export interface CrosstableCell {
  opponentParticipantId: string;
  matchId?: string;
  roundName?: string | null;
  roundNumber?: number | null;
  status: string;
  result: "SELF" | "MISSING" | "PENDING" | "W" | "L" | "D" | "CANCELLED" | "DOUBLE_WALKOVER";
  scoreFor?: number | null;
  scoreAgainst?: number | null;
  label: string;
}

export interface BracketView {
  rounds: BracketRound[];
}

export interface BracketRound {
  stageId?: string | null;
  stageName?: string | null;
  roundNumber: number;
  roundName: string;
  matches: BracketMatch[];
}

export interface BracketMatch {
  id: string;
  bracketNodeKey: string;
  matchNumber: number;
  status: string;
  resultType?: MatchResultType | "BYE" | "DOUBLE_WALKOVER" | "CANCELLED" | null;
  isBye: boolean;
  scoreA?: number | null;
  scoreB?: number | null;
  participantA?: BracketParticipant | null;
  participantB?: BracketParticipant | null;
  winnerParticipantId?: string | null;
  winnerDisplayName?: string | null;
}

export interface BracketParticipant {
  id: string;
  displayName: string;
  seed?: number | null;
}

export interface BackupRecord {
  id: string;
  fileName: string;
  filePath: string;
  sizeBytes?: number;
  createdAt: string;
}

export interface AuthUser {
  id: string;
  username: string;
  role: string;
}

export interface WccRuleSet {
  id: string;
  name: string;
  level: string;
  pointsTable: Record<string, number>;
  decayType: string;
  decayConfig?: {
    validDays?: number;
    fullDays?: number;
    steps?: Array<{ fromDay: number; multiplier: number }>;
  };
  active: boolean;
}
