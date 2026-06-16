import { z } from "zod";

const dateStringSchema = z.string().min(1).refine((value) => !Number.isNaN(Date.parse(value)), {
  message: "Invalid date"
});

export const createProjectSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/),
  description: z.string().optional(),
  defaultElo: z.number().int().min(100).max(4000).default(1200),
  scoringConfig: z
    .object({
      eloKFactor: z.number().int().min(1).max(100).default(20)
    })
    .default({ eloKFactor: 20 }),
  eloEnabled: z.boolean().default(true),
  wccEnabled: z.boolean().default(true)
});

export const updateProjectSchema = z
  .object({
    name: z.string().min(1).optional(),
    slug: z.string().min(1).regex(/^[a-z0-9-]+$/).optional(),
    description: z.string().nullable().optional(),
    defaultElo: z.number().int().min(100).max(4000).optional(),
    scoringConfig: z
      .object({
        eloKFactor: z.number().int().min(1).max(100).optional()
      })
      .optional(),
    eloEnabled: z.boolean().optional(),
    wccEnabled: z.boolean().optional()
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one project field is required"
  });

export const createPlayerSchema = z.object({
  name: z.string().min(1),
  nickname: z.string().optional(),
  gender: z.string().optional(),
  birthDate: dateStringSchema.optional(),
  country: z.string().optional(),
  region: z.string().optional(),
  club: z.string().optional(),
  contact: z.string().optional(),
  avatarUrl: z.string().url().optional(),
  note: z.string().optional(),
  displayName: z.string().optional(),
  code: z.string().optional(),
  seedRank: z.number().int().positive().optional()
});

export const updatePlayerSchema = z
  .object({
    name: z.string().min(1).optional(),
    nickname: z.string().nullable().optional(),
    gender: z.string().nullable().optional(),
    birthDate: dateStringSchema.nullable().optional(),
    country: z.string().nullable().optional(),
    region: z.string().nullable().optional(),
    club: z.string().nullable().optional(),
    contact: z.string().nullable().optional(),
    avatarUrl: z.string().url().nullable().optional(),
    note: z.string().nullable().optional(),
    displayName: z.string().nullable().optional(),
    code: z.string().nullable().optional(),
    seedRank: z.number().int().positive().nullable().optional()
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one player field is required"
  });

export const createTournamentSchema = z.object({
  name: z.string().min(1),
  level: z.string().default("WCC_100"),
  format: z.enum(["SINGLE_ELIMINATION", "ROUND_ROBIN", "SWISS", "CUP"]),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  registrationDeadline: z.string().datetime().optional(),
  location: z.string().optional(),
  organizer: z.string().optional(),
  description: z.string().optional(),
  eloEnabled: z.boolean().default(true),
  wccEnabled: z.boolean().default(true),
  config: z
    .object({
      groupCount: z.number().int().min(1).optional(),
      qualifyPerGroup: z.number().int().min(1).optional()
    })
    .optional()
});

export const updateTournamentSchema = z
  .object({
    name: z.string().min(1).optional(),
    level: z.string().optional(),
    startDate: z.string().datetime().nullable().optional(),
    endDate: z.string().datetime().nullable().optional(),
    registrationDeadline: z.string().datetime().nullable().optional(),
    location: z.string().nullable().optional(),
    organizer: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    eloEnabled: z.boolean().optional(),
    wccEnabled: z.boolean().optional(),
    config: z
      .object({
        groupCount: z.number().int().min(1).optional(),
        qualifyPerGroup: z.number().int().min(1).optional()
      })
      .optional()
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one tournament field is required"
  });

const wccPointsTableSchema = z.record(z.string(), z.number().int().min(0));

export const createWccRuleSetSchema = z.object({
  name: z.string().min(1),
  level: z.string().min(1).default("WCC_100"),
  pointsTable: wccPointsTableSchema.default({
    CHAMPION: 100,
    FINALIST: 65,
    SEMIFINAL: 40,
    QUARTERFINAL: 20,
    ROUND_OF_16: 10,
    PARTICIPATION: 2
  }),
  decayType: z.enum(["FIXED_EXPIRY", "STEP", "LINEAR"]).default("FIXED_EXPIRY"),
  decayConfig: z
    .object({
      validDays: z.number().int().positive().optional(),
      fullDays: z.number().int().min(0).optional(),
      steps: z.array(z.object({ fromDay: z.number().int().min(0), multiplier: z.number().min(0).max(1) })).optional()
    })
    .default({ validDays: 365 }),
  active: z.boolean().default(true)
});

export const updateWccRuleSetSchema = createWccRuleSetSchema.partial().refine((value) => Object.keys(value).length > 0, {
  message: "At least one WCC rule field is required"
});

export const addParticipantSchema = z.object({
  projectPlayerId: z.string().min(1),
  seed: z.number().int().positive().optional()
});

export const updateParticipantSchema = z
  .object({
    seed: z.number().int().positive().nullable().optional(),
    checkedIn: z.boolean().optional(),
    registrationStatus: z.enum(["REGISTERED", "CHECKED_IN", "WITHDRAWN"]).optional()
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one participant field is required"
  });

export const recordMatchResultSchema = z.object({
  scoreA: z.number(),
  scoreB: z.number(),
  resultType: z.enum([
    "A_WIN",
    "B_WIN",
    "DRAW",
    "A_WALKOVER",
    "B_WALKOVER",
    "DOUBLE_WALKOVER",
    "BYE",
    "CANCELLED"
  ]),
  games: z
    .array(
      z.object({
        gameNumber: z.number().int().positive(),
        scoreA: z.number().int().min(0).nullable().optional(),
        scoreB: z.number().int().min(0).nullable().optional(),
        winnerSide: z.enum(["A", "B", "DRAW"]).nullable().optional()
      })
    )
    .optional()
});

export const updateMatchSchema = z
  .object({
    tableNumber: z.number().int().positive().nullable().optional(),
    startsAt: dateStringSchema.nullable().optional(),
    status: z.enum(["SCHEDULED", "IN_PROGRESS", "CANCELLED"]).optional()
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one match field is required"
  });

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type CreatePlayerInput = z.infer<typeof createPlayerSchema>;
export type UpdatePlayerInput = z.infer<typeof updatePlayerSchema>;
export type CreateTournamentInput = z.infer<typeof createTournamentSchema>;
export type UpdateTournamentInput = z.infer<typeof updateTournamentSchema>;
export type CreateWccRuleSetInput = z.infer<typeof createWccRuleSetSchema>;
export type UpdateWccRuleSetInput = z.infer<typeof updateWccRuleSetSchema>;
export type AddParticipantInput = z.infer<typeof addParticipantSchema>;
export type UpdateParticipantInput = z.infer<typeof updateParticipantSchema>;
export type RecordMatchResultInput = z.infer<typeof recordMatchResultSchema>;
export type UpdateMatchInput = z.infer<typeof updateMatchSchema>;
