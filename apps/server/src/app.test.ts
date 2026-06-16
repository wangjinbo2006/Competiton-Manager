import Database from "better-sqlite3";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let app: Awaited<ReturnType<typeof import("./app.js").buildApp>>;
let prisma: typeof import("./db.js").prisma;
let tempDir: string;
let authCookie = "";

describe("server app", () => {
  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "competition-manager-test-"));
    const dbPath = path.join(tempDir, "test.sqlite");
    process.env.DATABASE_URL = `file:${dbPath}`;
    initializeDatabase(dbPath);

    const appModule = await import("./app.js");
    const dbModule = await import("./db.js");
    app = appModule.buildApp();
    prisma = dbModule.prisma;
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
    fs.rmSync(tempDir, { force: true, recursive: true });
  });

  it("returns health status", async () => {
    const response = await app.inject({ method: "GET", url: "/api/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      name: "competition-manager"
    });
  });

  it("runs a Swiss tournament workflow, import/export, WCC ranking, and backup operations", async () => {
    const unauthorized = await app.inject({ method: "POST", url: "/api/projects", payload: { name: "未授权", slug: "nope" } });
    expect(unauthorized.statusCode).toBe(401);

    const setup = await app.inject({
      method: "POST",
      url: "/api/auth/setup",
      payload: { username: "admin", password: "password123" }
    });
    expect(setup.statusCode).toBe(201);
    authCookie = setup.headers["set-cookie"] as string;
    expect(authCookie).toContain("cm_session=");

    const me = await injectJson<{ username: string }>("GET", "/api/auth/me");
    expect(me.username).toBe("admin");
    const startupBackups = await injectJson<Array<{ id: string; fileName: string; filePath: string; sizeBytes: number }>>("GET", "/api/backups");
    const dailyBackup = startupBackups.find((backup) => backup.fileName.startsWith("auto-daily-"));
    expect(dailyBackup?.sizeBytes).toBeGreaterThan(0);
    expect(fs.existsSync(dailyBackup!.filePath)).toBe(true);
    const { ensureDailyBackup } = await import("./routes/backups.js");
    const secondDailyBackup = await ensureDailyBackup();
    expect(secondDailyBackup.created).toBe(false);
    const backupsAfterSecondDaily = await injectJson<Array<{ fileName: string }>>("GET", "/api/backups");
    expect(backupsAfterSecondDaily.filter((backup) => backup.fileName.startsWith("auto-daily-"))).toHaveLength(1);

    const project = await injectJson<{ id: string }>("POST", "/api/projects", {
      name: "测试项目",
      slug: "test-project",
      defaultElo: 1200,
      eloEnabled: true,
      wccEnabled: true
    });
    await expectMissingProjectRanking("elo");
    await expectMissingProjectRanking("wcc");
    await expectMissingProjectRanking("combined");

    const updatedProject = await injectJson<{ name: string; defaultElo: number; scoringConfig: { eloKFactor: number } }>("PATCH", `/api/projects/${project.id}`, {
      name: "测试项目（更新）",
      defaultElo: 1250,
      scoringConfig: { eloKFactor: 32 }
    });
    expect(updatedProject.name).toBe("测试项目（更新）");
    expect(updatedProject.defaultElo).toBe(1250);
    expect(updatedProject.scoringConfig.eloKFactor).toBe(32);

    const customRule = await injectJson<{ id: string; active: boolean; pointsTable: Record<string, number> }>(
      "POST",
      `/api/projects/${project.id}/wcc-rules`,
      {
        name: "测试 WCC 200",
        level: "WCC_200",
        pointsTable: {
          CHAMPION: 200,
          FINALIST: 120,
          SEMIFINAL: 60,
          QUARTERFINAL: 30,
          ROUND_OF_16: 10,
          PARTICIPATION: 3
        },
        decayType: "FIXED_EXPIRY",
        decayConfig: { validDays: 365 },
        active: true
      }
    );
    expect(customRule.active).toBe(true);
    expect(customRule.pointsTable.CHAMPION).toBe(200);
    const updatedRule = await injectJson<{ id: string; name: string; pointsTable: Record<string, number>; decayType: string; decayConfig: { fullDays?: number; validDays?: number } }>(
      "PATCH",
      `/api/wcc-rules/${customRule.id}`,
      {
        name: "测试 WCC 210",
        pointsTable: {
          CHAMPION: 210,
          FINALIST: 120,
          SEMIFINAL: 60,
          QUARTERFINAL: 30,
          ROUND_OF_16: 10,
          PARTICIPATION: 3
        },
        decayType: "LINEAR",
        decayConfig: {
          fullDays: 180,
          validDays: 365
        },
        active: true
      }
    );
    expect(updatedRule.name).toBe("测试 WCC 210");
    expect(updatedRule.pointsTable.CHAMPION).toBe(210);
    expect(updatedRule.decayType).toBe("LINEAR");
    expect(updatedRule.decayConfig).toMatchObject({ fullDays: 180, validDays: 365 });
    const rules = await injectJson<Array<{ id: string; active: boolean }>>("GET", `/api/projects/${project.id}/wcc-rules`);
    expect(rules.filter((rule) => rule.active)).toHaveLength(1);

    const players = [];
    for (let index = 1; index <= 5; index += 1) {
      players.push(
        await injectJson<{ id: string }>("POST", `/api/projects/${project.id}/players`, {
          name: `测试选手 ${index}`,
          nickname: index === 1 ? "一号昵称" : undefined,
          gender: index === 1 ? "女" : undefined,
          birthDate: index === 1 ? "1998-03-12" : undefined,
          country: index === 1 ? "中国" : undefined,
          region: index === 1 ? "上海" : undefined,
          displayName: `测试选手 ${index}`,
          code: `T${index}`,
          club: index === 1 ? "初始俱乐部" : undefined,
          contact: index === 1 ? "player1@example.com" : undefined,
          avatarUrl: index === 1 ? "https://example.com/avatar-1.png" : undefined,
          note: index === 1 ? "左手持拍" : undefined,
          seedRank: index
        })
      );
    }

    const updatedPlayer = await injectJson<{
      displayName: string;
      player: { nickname: string; gender: string; birthDate: string; country: string; region: string; club: string; contact: string; avatarUrl: string; note: string };
    }>(
      "PATCH",
      `/api/project-players/${players[0]!.id}`,
      {
        displayName: "测试一号",
        nickname: "一号",
        gender: "男",
        birthDate: "1999-05-20",
        country: "中国",
        region: "北京",
        club: "测试俱乐部",
        contact: "updated@example.com",
        avatarUrl: "https://example.com/updated-avatar.png",
        note: "资料已更新"
      }
    );
    expect(updatedPlayer.displayName).toBe("测试一号");
    expect(updatedPlayer.player.nickname).toBe("一号");
    expect(updatedPlayer.player.gender).toBe("男");
    expect(updatedPlayer.player.birthDate).toContain("1999-05-20");
    expect(updatedPlayer.player.country).toBe("中国");
    expect(updatedPlayer.player.region).toBe("北京");
    expect(updatedPlayer.player.club).toBe("测试俱乐部");
    expect(updatedPlayer.player.contact).toBe("updated@example.com");
    expect(updatedPlayer.player.avatarUrl).toBe("https://example.com/updated-avatar.png");
    expect(updatedPlayer.player.note).toBe("资料已更新");

    const duplicateUpdate = await injectStatus("PATCH", `/api/project-players/${players[1]!.id}`, {
      code: "T1"
    });
    expect(duplicateUpdate.statusCode).toBe(409);
    const missingHistory = await injectStatus("GET", "/api/project-players/not-found/history");
    expect(missingHistory.statusCode).toBe(404);
    const missingRatingHistory = await injectStatus("GET", "/api/project-players/not-found/rating-history");
    expect(missingRatingHistory.statusCode).toBe(404);

    const inactivePlayerId = players[4]!.id;
    const inactivePlayer = await injectJson<{ active: boolean }>("DELETE", `/api/project-players/${inactivePlayerId}`);
    expect(inactivePlayer.active).toBe(false);
    const activePlayers = await injectJson<Array<{ id: string }>>("GET", `/api/projects/${project.id}/players`);
    expect(activePlayers).toHaveLength(4);

    const replacement = await injectJson<{ id: string }>("POST", `/api/projects/${project.id}/players`, {
      name: "测试选手 5",
      displayName: "测试选手 5",
      code: "T5B",
      seedRank: 5
    });
    players[4] = replacement;

    const tournament = await injectJson<{
      id: string;
      startDate: string;
      endDate: string;
      registrationDeadline: string;
      location: string;
      organizer: string;
      description: string;
    }>("POST", `/api/projects/${project.id}/tournaments`, {
      name: "测试瑞士轮",
      level: "WCC_100",
      format: "SWISS",
      startDate: "2026-06-20T09:00:00.000Z",
      endDate: "2026-06-20T18:00:00.000Z",
      registrationDeadline: "2026-06-19T12:00:00.000Z",
      location: "测试赛场",
      organizer: "测试主办方",
      description: "测试赛事说明",
      eloEnabled: true,
      wccEnabled: true
    });
    expect(new Date(tournament.startDate).toISOString()).toBe("2026-06-20T09:00:00.000Z");
    expect(new Date(tournament.endDate).toISOString()).toBe("2026-06-20T18:00:00.000Z");
    expect(new Date(tournament.registrationDeadline).toISOString()).toBe("2026-06-19T12:00:00.000Z");
    expect(tournament).toMatchObject({
      location: "测试赛场",
      organizer: "测试主办方",
      description: "测试赛事说明"
    });

    const renamedTournament = await injectJson<{
      name: string;
      registrationDeadline: string;
      location: string;
      organizer: string;
      description: string;
    }>("PATCH", `/api/tournaments/${tournament.id}`, {
      name: "测试瑞士轮（改名）",
      registrationDeadline: "2026-06-18T10:00:00.000Z",
      location: "更新赛场",
      organizer: "更新主办方",
      description: "更新说明"
    });
    expect(renamedTournament.name).toBe("测试瑞士轮（改名）");
    expect(new Date(renamedTournament.registrationDeadline).toISOString()).toBe("2026-06-18T10:00:00.000Z");
    expect(renamedTournament).toMatchObject({
      location: "更新赛场",
      organizer: "更新主办方",
      description: "更新说明"
    });

    const inactiveRegistration = await injectStatus("POST", `/api/tournaments/${tournament.id}/participants`, {
      projectPlayerId: inactivePlayerId,
      seed: 99
    });
    expect(inactiveRegistration.statusCode).toBe(400);

    for (const [index, player] of players.entries()) {
      await injectJson("POST", `/api/tournaments/${tournament.id}/participants`, {
        projectPlayerId: player.id,
        seed: index + 1
      });
    }

    const tournamentWithParticipants = await injectJson<{
      participants: Array<{ id: string; projectPlayer: { id: string }; seed: number | null; checkedIn: boolean; registrationStatus: string }>;
    }>("GET", `/api/tournaments/${tournament.id}`);
    const firstParticipant = tournamentWithParticipants.participants[0]!;
    const updatedParticipant = await injectJson<{ seed: number; checkedIn: boolean; registrationStatus: string }>(
      "PATCH",
      `/api/tournaments/${tournament.id}/participants/${firstParticipant.id}`,
      {
        seed: 10,
        checkedIn: true
      }
    );
    expect(updatedParticipant.seed).toBe(10);
    expect(updatedParticipant.checkedIn).toBe(true);
    expect(updatedParticipant.registrationStatus).toBe("CHECKED_IN");

    const removedParticipant = tournamentWithParticipants.participants[4]!;
    const removeResult = await injectJson<{ deleted: boolean }>(
      "DELETE",
      `/api/tournaments/${tournament.id}/participants/${removedParticipant.id}`
    );
    expect(removeResult.deleted).toBe(true);
    const afterRemoval = await injectJson<{ participants: Array<{ id: string }> }>("GET", `/api/tournaments/${tournament.id}`);
    expect(afterRemoval.participants).toHaveLength(4);
    await injectJson("POST", `/api/tournaments/${tournament.id}/participants`, {
      projectPlayerId: removedParticipant.projectPlayer.id,
      seed: 5
    });

    await injectJson("POST", `/api/tournaments/${tournament.id}/draw`);
    const drawn = await injectJson<{ matches: Array<{ id: string; isBye: boolean; participantAId?: string; participantBId?: string }> }>(
      "GET",
      `/api/tournaments/${tournament.id}`
    );

    expect(drawn.matches).toHaveLength(3);
    expect(drawn.matches.filter((match) => match.isBye)).toHaveLength(1);
    const removeAfterDraw = await injectStatus("DELETE", `/api/tournaments/${tournament.id}/participants/${firstParticipant.id}`);
    expect(removeAfterDraw.statusCode).toBe(400);

    const firstPlayableSwissMatch = drawn.matches.find((item) => !item.isBye);
    const firstByeSwissMatch = drawn.matches.find((item) => item.isBye);
    const scheduledAt = "2026-06-20T10:00:00.000Z";
    const updatedMatchSchedule = await injectJson<{ tableNumber: number; startsAt: string; status: string }>(
      "PATCH",
      `/api/matches/${firstPlayableSwissMatch!.id}`,
      {
        tableNumber: 8,
        startsAt: scheduledAt,
        status: "IN_PROGRESS"
      }
    );
    expect(updatedMatchSchedule.tableNumber).toBe(8);
    expect(new Date(updatedMatchSchedule.startsAt).toISOString()).toBe(scheduledAt);
    expect(updatedMatchSchedule.status).toBe("IN_PROGRESS");
    const updateByeMatch = await injectStatus("PATCH", `/api/matches/${firstByeSwissMatch!.id}`, { tableNumber: 9 });
    expect(updateByeMatch.statusCode).toBe(400);
    const cancelledMatch = await injectJson<{ status: string; resultType: string }>("PATCH", `/api/matches/${firstPlayableSwissMatch!.id}`, {
      status: "CANCELLED"
    });
    expect(cancelledMatch).toMatchObject({ status: "CANCELLED", resultType: "CANCELLED" });
    const recordCancelledMatch = await injectStatus("PATCH", `/api/matches/${firstPlayableSwissMatch!.id}/result`, {
      scoreA: 1,
      scoreB: 0,
      resultType: "A_WIN"
    });
    expect(recordCancelledMatch.statusCode).toBe(400);
    await injectJson("PATCH", `/api/matches/${firstPlayableSwissMatch!.id}`, { status: "SCHEDULED" });

    for (const match of drawn.matches.filter((item) => !item.isBye)) {
      await injectJson("PATCH", `/api/matches/${match.id}/result`, {
        scoreA: 1,
        scoreB: 0,
        resultType: "A_WIN",
        ...(match.id === firstPlayableSwissMatch!.id
          ? {
              games: [
                { gameNumber: 1, scoreA: 11, scoreB: 8 },
                { gameNumber: 2, scoreA: 9, scoreB: 11 },
                { gameNumber: 3, scoreA: 11, scoreB: 6 }
              ]
            }
          : {})
      });
    }
    const swissWithGames = await injectJson<{ matches: Array<{ id: string; games?: Array<{ gameNumber: number; scoreA: number; scoreB: number; winnerSide: string }> }> }>(
      "GET",
      `/api/tournaments/${tournament.id}`
    );
    const savedGames = swissWithGames.matches.find((match) => match.id === firstPlayableSwissMatch!.id)?.games ?? [];
    expect(savedGames.map((game) => [game.gameNumber, game.scoreA, game.scoreB, game.winnerSide])).toEqual([
      [1, 11, 8, "A"],
      [2, 9, 11, "B"],
      [3, 11, 6, "A"]
    ]);
    const overwriteCompletedMatch = await injectStatus("PATCH", `/api/matches/${firstPlayableSwissMatch!.id}/result`, {
      scoreA: 0,
      scoreB: 1,
      resultType: "B_WIN"
    });
    expect(overwriteCompletedMatch.statusCode).toBe(400);

    const nextRound = await injectJson<{ matches: Array<{ id: string; isBye: boolean }> }>(
      "POST",
      `/api/tournaments/${tournament.id}/generate-next-round`
    );
    expect(nextRound.matches).toHaveLength(3);

    const standings = await injectJson<Array<{ rank: number; points: number; participantId: string }>>(
      "GET",
      `/api/tournaments/${tournament.id}/standings`
    );
    expect(standings[0]?.rank).toBe(1);
    expect(standings[0]?.points).toBeGreaterThanOrEqual(1);

    const exportedMatches = await injectText("GET", `/api/tournaments/${tournament.id}/export/matches.csv`);
    expect(exportedMatches).toContain("tournament,round,bracketNode,table,playerA,playerB");
    expect(exportedMatches).toContain("测试瑞士轮（改名）");
    expect(exportedMatches).toContain("A_WIN");
    expect(exportedMatches).toContain("11-8 9-11 11-6");
    const exportedStandings = await injectText("GET", `/api/tournaments/${tournament.id}/export/standings.csv`);
    expect(exportedStandings).toContain("rank,displayName,matchesPlayed,wins,draws,losses,points,buchholz");
    expect(exportedStandings).toContain("测试一号");
    const missingTournamentExport = await injectStatus("GET", "/api/tournaments/not-found/export/matches.csv");
    expect(missingTournamentExport.statusCode).toBe(404);

    const backup = await injectJson<{ id: string; filePath: string; sizeBytes: number }>("POST", "/api/backups");
    expect(backup.sizeBytes).toBeGreaterThan(0);
    expect(fs.existsSync(backup.filePath)).toBe(true);
    const downloadedBackup = await app.inject({
      method: "GET",
      url: `/api/backups/${backup.id}/download`,
      headers: withAuth()
    });
    expect(downloadedBackup.statusCode).toBe(200);
    expect(downloadedBackup.headers["content-type"]).toContain("application/vnd.sqlite3");
    expect(downloadedBackup.headers["content-disposition"]).toContain(".sqlite");
    expect(downloadedBackup.rawPayload.subarray(0, 16).toString()).toBe("SQLite format 3\u0000");
    const missingBackupDownload = await injectStatus("GET", "/api/backups/not-found/download");
    expect(missingBackupDownload.statusCode).toBe(404);

    const importResult = await injectJson<{ created: number; skipped: unknown[]; backup: { id: string; fileName: string; sizeBytes: number } }>(
      "POST",
      `/api/projects/${project.id}/import/players`,
      "name,displayName,code,nickname,gender,birthDate,country,region,club,contact,avatarUrl,note,seedRank\nCSV 选手,CSV 选手,C100,CSV昵称,女,2000-01-02,中国,广州,CSV俱乐部,csv@example.com,https://example.com/csv.png,CSV备注,99\n",
      { "content-type": "text/csv; charset=utf-8" }
    );
    expect(importResult.created).toBe(1);
    expect(importResult.skipped).toHaveLength(0);
    expect(importResult.backup.fileName).toMatch(/^pre-import-/);
    expect(importResult.backup.sizeBytes).toBeGreaterThan(0);
    const backupsAfterImport = await injectJson<Array<{ id: string; fileName: string }>>("GET", "/api/backups");
    expect(backupsAfterImport.some((item) => item.id === importResult.backup.id)).toBe(true);

    const invalidDateImport = await injectJson<{ created: number; skipped: Array<{ reason: string }> }>(
      "POST",
      `/api/projects/${project.id}/import/players`,
      "name,code,birthDate\n坏日期选手,C101,not-a-date\n",
      { "content-type": "text/csv; charset=utf-8" }
    );
    expect(invalidDateImport.created).toBe(0);
    expect(invalidDateImport.skipped[0]?.reason).toBe("Invalid birthDate");

    const exportedPlayers = await injectText("GET", `/api/projects/${project.id}/export/players.csv`);
    expect(exportedPlayers).toContain("CSV 选手");
    expect(exportedPlayers).toContain("birthDate");
    expect(exportedPlayers).toContain("CSV昵称");
    expect(exportedPlayers).toContain("2000-01-02");
    expect(exportedPlayers).toContain("csv@example.com");

    for (const match of nextRound.matches.filter((item) => !item.isBye)) {
      await injectJson("PATCH", `/api/matches/${match.id}/result`, {
        scoreA: 1,
        scoreB: 0,
        resultType: "A_WIN"
      });
    }
    await injectJson("POST", `/api/tournaments/${tournament.id}/complete`);

    const playerHistory = await injectJson<Array<{ tournamentName: string; opponentDisplayName: string; outcome: string; score: string | null }>>(
      "GET",
      `/api/project-players/${players[0]!.id}/history`
    );
    expect(playerHistory.length).toBeGreaterThan(0);
    expect(playerHistory[0]).toMatchObject({
      tournamentName: "测试瑞士轮（改名）",
      opponentDisplayName: expect.any(String),
      outcome: expect.any(String)
    });
    const ratingHistory = await injectJson<{ elo: Array<{ ratingBefore: number; ratingAfter: number; delta: number; kFactor: number }>; wcc: Array<{ rawPoints: number; finalRank: number }> }>(
      "GET",
      `/api/project-players/${players[0]!.id}/rating-history`
    );
    expect(ratingHistory.elo.length).toBeGreaterThan(0);
    expect(ratingHistory.wcc.length).toBeGreaterThan(0);
    expect(ratingHistory.elo[0]).toMatchObject({ ratingBefore: expect.any(Number), ratingAfter: expect.any(Number), delta: expect.any(Number), kFactor: 32 });
    expect(ratingHistory.wcc[0]).toMatchObject({ rawPoints: expect.any(Number), finalRank: expect.any(Number) });

    const currentWcc = await injectJson<Array<{ rank: number; effectiveWcc: number }>>(
      "GET",
      `/api/projects/${project.id}/rankings/wcc?asOf=2026-06-16T00:00:00.000Z`
    );
    expect(currentWcc[0]?.effectiveWcc).toBe(210);

    await prisma.projectPlayer.updateMany({
      where: { projectId: project.id },
      data: { currentElo: 9999, currentWcc: 9999, matchesPlayed: 0, wins: 0, draws: 0, losses: 0 }
    });
    const recalculated = await injectJson<{ recalculated: boolean; players: number; matches: number; eloHistoryRows: number; wccEvents: number }>(
      "POST",
      `/api/projects/${project.id}/recalculate-ratings`
    );
    expect(recalculated).toMatchObject({ recalculated: true, players: 7, matches: 4, eloHistoryRows: 8, wccEvents: 5 });
    const recalculatedRatingHistory = await injectJson<{ elo: Array<{ kFactor: number }> }>(
      "GET",
      `/api/project-players/${players[0]!.id}/rating-history`
    );
    expect(recalculatedRatingHistory.elo.every((event) => event.kFactor === 32)).toBe(true);
    const recalculatedWcc = await injectJson<Array<{ effectiveWcc: number }>>(
      "GET",
      `/api/projects/${project.id}/rankings/wcc?asOf=2026-06-16T00:00:00.000Z`
    );
    expect(recalculatedWcc[0]?.effectiveWcc).toBe(210);
    const reducedWcc = await injectJson<Array<{ effectiveWcc: number }>>(
      "GET",
      `/api/projects/${project.id}/rankings/wcc?asOf=2027-03-20T00:00:00.000Z`
    );
    expect(reducedWcc[0]?.effectiveWcc).toBe(106);
    const expiredLinearWcc = await injectJson<Array<{ effectiveWcc: number }>>(
      "GET",
      `/api/projects/${project.id}/rankings/wcc?asOf=2027-06-21T00:00:00.000Z`
    );
    expect(expiredLinearWcc[0]?.effectiveWcc).toBe(0);
    await injectJson("POST", `/api/projects/${project.id}/recalculate-ratings`, {
      asOf: "2027-03-20T00:00:00.000Z"
    });
    const playersAfterWccDecay = await injectJson<Array<{ currentWcc: number }>>("GET", `/api/projects/${project.id}/players`);
    expect(Math.max(...playersAfterWccDecay.map((player) => player.currentWcc))).toBe(106);
    const recalculatedElo = await injectJson<Array<{ currentElo: number; matchesPlayed: number }>>(
      "GET",
      `/api/projects/${project.id}/rankings/elo`
    );
    expect(recalculatedElo[0]?.currentElo).toBeLessThan(9999);
    expect(recalculatedElo.some((row) => row.matchesPlayed > 0)).toBe(true);
    const combinedRankings = await injectJson<Array<{ rank: number; combinedScore: number; eloRank: number; wccRank: number; effectiveWcc: number }>>(
      "GET",
      `/api/projects/${project.id}/rankings/combined?asOf=2026-06-16T00:00:00.000Z`
    );
    expect(combinedRankings[0]).toMatchObject({
      rank: 1,
      combinedScore: expect.any(Number),
      eloRank: expect.any(Number),
      wccRank: expect.any(Number),
      effectiveWcc: expect.any(Number)
    });

    const expiredWcc = await injectJson<Array<{ rank: number; effectiveWcc: number }>>(
      "GET",
      `/api/projects/${project.id}/rankings/wcc?asOf=2030-06-16T00:00:00.000Z`
    );
    expect(expiredWcc.every((row) => row.effectiveWcc === 0)).toBe(true);

    const cupProject = await injectJson<{ id: string }>("POST", "/api/projects", {
      name: "杯赛测试项目",
      slug: "cup-test-project",
      defaultElo: 1200,
      eloEnabled: true,
      wccEnabled: true
    });
    const cupPlayers = [];
    for (let index = 1; index <= 8; index += 1) {
      cupPlayers.push(
        await injectJson<{ id: string }>("POST", `/api/projects/${cupProject.id}/players`, {
          name: `杯赛选手 ${index}`,
          displayName: `杯赛选手 ${index}`,
          code: `CUP${index}`,
          seedRank: index
        })
      );
    }
    const cup = await injectJson<{ id: string }>("POST", `/api/projects/${cupProject.id}/tournaments`, {
      name: "测试杯赛",
      level: "WCC_100",
      format: "CUP",
      eloEnabled: true,
      wccEnabled: true,
      config: { groupCount: 2, qualifyPerGroup: 2 }
    });
    const cancellableCup = await injectJson<{ id: string }>("POST", `/api/projects/${cupProject.id}/tournaments`, {
      name: "取消用杯赛",
      level: "WCC_100",
      format: "CUP",
      eloEnabled: true,
      wccEnabled: true,
      config: { groupCount: 2, qualifyPerGroup: 2 }
    });
    const cancelledCup = await injectJson<{ id: string; status: string }>("POST", `/api/tournaments/${cancellableCup.id}/cancel`);
    expect(cancelledCup.status).toBe("CANCELLED");
    const addToCancelled = await injectStatus("POST", `/api/tournaments/${cancellableCup.id}/participants`, {
      projectPlayerId: cupPlayers[0]!.id,
      seed: 1
    });
    expect(addToCancelled.statusCode).toBe(400);
    for (const [index, player] of cupPlayers.entries()) {
      await injectJson("POST", `/api/tournaments/${cup.id}/participants`, {
        projectPlayerId: player.id,
        seed: index + 1
      });
    }
    await injectJson("POST", `/api/tournaments/${cup.id}/draw`);
    const cupDrawn = await injectJson<{
      matches: Array<{ id: string; isBye: boolean; groupId?: string; participantAId?: string | null; participantBId?: string | null }>;
    }>("GET", `/api/tournaments/${cup.id}`);
    const groupMatches = cupDrawn.matches.filter((match) => match.groupId);
    expect(groupMatches).toHaveLength(12);
    expect(new Set(groupMatches.map((match) => match.groupId)).size).toBe(2);

    for (const match of groupMatches.filter((item) => !item.isBye)) {
      await injectJson("PATCH", `/api/matches/${match.id}/result`, {
        scoreA: 1,
        scoreB: 0,
        resultType: "A_WIN"
      });
    }
    const knockout = await injectJson<{ rounds: Array<{ matches: Array<{ id: string }> }> }>(
      "POST",
      `/api/tournaments/${cup.id}/generate-knockout-stage`
    );
    expect(knockout.rounds.flatMap((round) => round.matches)).toHaveLength(3);
    const cupWithKnockout = await injectJson<{
      matches: Array<{
        id: string;
        bracketNodeKey?: string | null;
        participantAId?: string | null;
        participantBId?: string | null;
      }>;
    }>("GET", `/api/tournaments/${cup.id}`);
    const semifinals = cupWithKnockout.matches.filter((match) => match.bracketNodeKey?.startsWith("R1-"));
    expect(semifinals).toHaveLength(2);
    for (const match of semifinals) {
      await injectJson("PATCH", `/api/matches/${match.id}/result`, {
        scoreA: 1,
        scoreB: 0,
        resultType: "A_WIN"
      });
    }
    const cupFinalReady = await injectJson<{
      matches: Array<{
        bracketNodeKey?: string | null;
        participantAId?: string | null;
        participantBId?: string | null;
      }>;
    }>("GET", `/api/tournaments/${cup.id}`);
    const final = cupFinalReady.matches.find((match) => match.bracketNodeKey === "R2-M1");
    expect(final?.participantAId).toBeTruthy();
    expect(final?.participantBId).toBeTruthy();

    const eliminationProject = await injectJson<{ id: string }>("POST", "/api/projects", {
      name: "单淘汰测试项目",
      slug: "single-elimination-test-project",
      defaultElo: 1200,
      eloEnabled: true,
      wccEnabled: true
    });
    const eliminationPlayers = [];
    for (let index = 1; index <= 5; index += 1) {
      eliminationPlayers.push(
        await injectJson<{ id: string }>("POST", `/api/projects/${eliminationProject.id}/players`, {
          name: `单淘汰选手 ${index}`,
          displayName: `单淘汰选手 ${index}`,
          code: `SE${index}`,
          seedRank: index
        })
      );
    }
    const elimination = await injectJson<{ id: string }>("POST", `/api/projects/${eliminationProject.id}/tournaments`, {
      name: "测试单淘汰",
      level: "WCC_100",
      format: "SINGLE_ELIMINATION",
      eloEnabled: true,
      wccEnabled: true
    });
    const crossProjectRegistration = await injectStatus("POST", `/api/tournaments/${elimination.id}/participants`, {
      projectPlayerId: cupPlayers[0]!.id,
      seed: 1
    });
    expect(crossProjectRegistration.statusCode).toBe(400);
    for (const [index, player] of eliminationPlayers.entries()) {
      await injectJson("POST", `/api/tournaments/${elimination.id}/participants`, {
        projectPlayerId: player.id,
        seed: index + 1
      });
    }
    await injectJson("POST", `/api/tournaments/${elimination.id}/draw`);
    const eliminationDrawn = await injectJson<{
      matches: Array<{
        id: string;
        bracketNodeKey?: string | null;
        isBye: boolean;
        participantAId?: string | null;
        participantBId?: string | null;
      }>;
    }>("GET", `/api/tournaments/${elimination.id}`);
    const eliminationFirstRound = eliminationDrawn.matches.filter((match) => match.bracketNodeKey?.startsWith("R1-"));
    expect(eliminationFirstRound).toHaveLength(4);
    expect(eliminationFirstRound.filter((match) => match.isBye)).toHaveLength(3);
    const eliminationBracket = await injectJson<{
      rounds: Array<{
        roundNumber: number;
        roundName: string;
        matches: Array<{ bracketNodeKey: string; matchNumber: number; isBye: boolean; participantA?: { displayName: string } | null }>;
      }>;
    }>("GET", `/api/tournaments/${elimination.id}/bracket`);
    expect(eliminationBracket.rounds.map((round) => [round.roundNumber, round.matches.length])).toEqual([
      [1, 4],
      [2, 2],
      [3, 1]
    ]);
    expect(eliminationBracket.rounds[0]?.matches[0]?.bracketNodeKey).toBe("R1-M1");
    expect(eliminationBracket.rounds[2]?.matches[0]?.bracketNodeKey).toBe("R3-M1");

    const playableFirstRound = eliminationFirstRound.find((match) => !match.isBye);
    expect(playableFirstRound?.participantAId).toBeTruthy();
    expect(playableFirstRound?.participantBId).toBeTruthy();
    await injectJson("PATCH", `/api/matches/${playableFirstRound!.id}/result`, {
      scoreA: 1,
      scoreB: 0,
      resultType: "A_WIN",
      games: [
        { gameNumber: 1, scoreA: 21, scoreB: 18 },
        { gameNumber: 2, scoreA: 21, scoreB: 15 }
      ]
    });
    const prematureEliminationComplete = await injectStatus("POST", `/api/tournaments/${elimination.id}/complete`);
    expect(prematureEliminationComplete.statusCode).toBe(400);
    const eliminationSemifinalReady = await injectJson<{
      matches: Array<{
        id: string;
        bracketNodeKey?: string | null;
        participantAId?: string | null;
        participantBId?: string | null;
        games?: Array<{ gameNumber: number }>;
      }>;
    }>("GET", `/api/tournaments/${elimination.id}`);
    expect(eliminationSemifinalReady.matches.find((match) => match.id === playableFirstRound!.id)?.games).toHaveLength(2);
    const eliminationSemifinals = eliminationSemifinalReady.matches.filter((match) =>
      match.bracketNodeKey?.startsWith("R2-")
    );
    expect(eliminationSemifinals.every((match) => match.participantAId && match.participantBId)).toBe(true);
    const reopenedElimination = await injectJson<{ reopened: boolean; match: { status: string } }>(
      "POST",
      `/api/matches/${playableFirstRound!.id}/reopen`
    );
    expect(reopenedElimination).toMatchObject({ reopened: true, match: { status: "SCHEDULED" } });
    const reopenedBracket = await injectJson<{
      matches: Array<{
        id: string;
        bracketNodeKey?: string | null;
        participantAId?: string | null;
        participantBId?: string | null;
        games?: Array<{ gameNumber: number }>;
      }>;
    }>("GET", `/api/tournaments/${elimination.id}`);
    expect(reopenedBracket.matches.find((match) => match.id === playableFirstRound!.id)?.games).toHaveLength(0);
    const reopenedSemifinals = reopenedBracket.matches.filter((match) => match.bracketNodeKey?.startsWith("R2-"));
    expect(reopenedSemifinals.some((match) => !match.participantAId || !match.participantBId)).toBe(true);
    await injectJson("POST", `/api/projects/${eliminationProject.id}/recalculate-ratings`);
    await injectJson("PATCH", `/api/matches/${playableFirstRound!.id}/result`, {
      scoreA: 1,
      scoreB: 0,
      resultType: "A_WIN"
    });
    const eliminationSemifinalReadyAgain = await injectJson<{
      matches: Array<{
        id: string;
        bracketNodeKey?: string | null;
        participantAId?: string | null;
        participantBId?: string | null;
      }>;
    }>("GET", `/api/tournaments/${elimination.id}`);
    const eliminationSemifinalsAgain = eliminationSemifinalReadyAgain.matches.filter((match) =>
      match.bracketNodeKey?.startsWith("R2-")
    );
    expect(eliminationSemifinalsAgain.every((match) => match.participantAId && match.participantBId)).toBe(true);
    for (const match of eliminationSemifinalsAgain) {
      await injectJson("PATCH", `/api/matches/${match.id}/result`, {
        scoreA: 1,
        scoreB: 0,
        resultType: "A_WIN"
      });
    }
    const eliminationFinalReady = await injectJson<{
      matches: Array<{
        id: string;
        bracketNodeKey?: string | null;
        participantAId?: string | null;
        participantBId?: string | null;
      }>;
    }>("GET", `/api/tournaments/${elimination.id}`);
    const eliminationFinal = eliminationFinalReady.matches.find((match) => match.bracketNodeKey === "R3-M1");
    expect(eliminationFinal?.participantAId).toBeTruthy();
    expect(eliminationFinal?.participantBId).toBeTruthy();
    await injectJson("PATCH", `/api/matches/${eliminationFinal!.id}/result`, {
      scoreA: 1,
      scoreB: 0,
      resultType: "A_WIN"
    });
    const completedEliminationBracket = await injectJson<{
      rounds: Array<{ matches: Array<{ bracketNodeKey: string; winnerDisplayName?: string | null; resultType?: string | null }> }>;
    }>("GET", `/api/tournaments/${elimination.id}/bracket`);
    expect(
      completedEliminationBracket.rounds
        .flatMap((round) => round.matches)
        .find((match) => match.bracketNodeKey === "R3-M1")
    ).toMatchObject({ resultType: "A_WIN", winnerDisplayName: expect.any(String) });
    const completedElimination = await injectJson<{ status: string }>("POST", `/api/tournaments/${elimination.id}/complete`);
    expect(completedElimination.status).toBe("COMPLETED");

    const roundRobinProject = await injectJson<{ id: string }>("POST", "/api/projects", {
      name: "循环赛测试项目",
      slug: "round-robin-test-project",
      defaultElo: 1200,
      eloEnabled: true,
      wccEnabled: true
    });
    const roundRobinPlayers = [];
    for (let index = 1; index <= 4; index += 1) {
      roundRobinPlayers.push(
        await injectJson<{ id: string }>("POST", `/api/projects/${roundRobinProject.id}/players`, {
          name: `循环赛选手 ${index}`,
          displayName: `循环赛选手 ${index}`,
          code: `RR${index}`,
          seedRank: index
        })
      );
    }
    const roundRobin = await injectJson<{ id: string }>("POST", `/api/projects/${roundRobinProject.id}/tournaments`, {
      name: "测试循环赛",
      level: "WCC_100",
      format: "ROUND_ROBIN",
      eloEnabled: true,
      wccEnabled: true
    });
    for (const [index, player] of roundRobinPlayers.entries()) {
      await injectJson("POST", `/api/tournaments/${roundRobin.id}/participants`, {
        projectPlayerId: player.id,
        seed: index + 1
      });
    }
    await injectJson("POST", `/api/tournaments/${roundRobin.id}/draw`);
    const roundRobinDrawn = await injectJson<{
      rounds: Array<{ id: string }>;
      matches: Array<{ id: string; isBye: boolean; participantAId?: string | null; participantBId?: string | null }>;
    }>("GET", `/api/tournaments/${roundRobin.id}`);
    expect(roundRobinDrawn.rounds).toHaveLength(3);
    expect(roundRobinDrawn.matches).toHaveLength(6);
    expect(roundRobinDrawn.matches.some((match) => match.isBye)).toBe(false);
    for (const match of roundRobinDrawn.matches) {
      await injectJson("PATCH", `/api/matches/${match.id}/result`, {
        scoreA: 1,
        scoreB: 0,
        resultType: "A_WIN"
      });
    }
    const roundRobinStandings = await injectJson<Array<{ rank: number; matchesPlayed: number; points: number }>>(
      "GET",
      `/api/tournaments/${roundRobin.id}/standings`
    );
    expect(roundRobinStandings).toHaveLength(4);
    expect(roundRobinStandings.every((row) => row.matchesPlayed === 3)).toBe(true);
    expect(roundRobinStandings[0]?.points).toBeGreaterThan(roundRobinStandings[3]?.points ?? 0);
    const roundRobinCrosstable = await injectJson<{
      columns: Array<{ participantId: string; displayName: string }>;
      rows: Array<{
        participantId: string;
        cells: Array<{ opponentParticipantId: string; result: string; label: string; status: string; scoreFor?: number | null; scoreAgainst?: number | null }>;
      }>;
    }>("GET", `/api/tournaments/${roundRobin.id}/crosstable`);
    expect(roundRobinCrosstable.columns).toHaveLength(4);
    expect(roundRobinCrosstable.rows).toHaveLength(4);
    expect(roundRobinCrosstable.rows[0]?.cells).toHaveLength(4);
    expect(roundRobinCrosstable.rows[0]?.cells[0]).toMatchObject({ result: "SELF", label: "-" });
    expect(roundRobinCrosstable.rows.flatMap((row) => row.cells).filter((cell) => cell.result === "SELF")).toHaveLength(4);
    expect(roundRobinCrosstable.rows.flatMap((row) => row.cells).filter((cell) => cell.status === "COMPLETED")).toHaveLength(12);
    expect(roundRobinCrosstable.rows.flatMap((row) => row.cells).some((cell) => cell.label.includes("1-0"))).toBe(true);
    const swissCrosstable = await injectStatus("GET", `/api/tournaments/${tournament.id}/crosstable`);
    expect(swissCrosstable.statusCode).toBe(400);
    const roundRobinBracket = await injectStatus("GET", `/api/tournaments/${roundRobin.id}/bracket`);
    expect(roundRobinBracket.statusCode).toBe(400);
    const completedRoundRobin = await injectJson<{ status: string }>("POST", `/api/tournaments/${roundRobin.id}/complete`);
    expect(completedRoundRobin.status).toBe("COMPLETED");

    const backups = await injectJson<Array<{ id: string }>>("GET", "/api/backups");
    expect(backups.length).toBeGreaterThan(0);

    const restore = await injectJson<{ restored: boolean; restartRequired: boolean }>(
      "POST",
      `/api/backups/${backups[0]!.id}/restore`
    );
    expect(restore).toMatchObject({ restored: true, restartRequired: true });
  });
});

async function injectJson<T = unknown>(
  method: string,
  url: string,
  payload?: unknown,
  headers?: Record<string, string>
): Promise<T> {
  const response = await app.inject({
    method,
    url,
    payload,
    headers: withAuth(headers)
  } as never);
  expect(response.statusCode).toBeGreaterThanOrEqual(200);
  expect(response.statusCode).toBeLessThan(300);
  return response.json() as T;
}

async function injectText(method: string, url: string, payload?: unknown): Promise<string> {
  const response = await app.inject({
    method,
    url,
    payload,
    headers: withAuth()
  } as never);
  expect(response.statusCode).toBeGreaterThanOrEqual(200);
  expect(response.statusCode).toBeLessThan(300);
  return response.body;
}

async function injectStatus(method: string, url: string, payload?: unknown) {
  return app.inject({
    method,
    url,
    payload,
    headers: withAuth()
  } as never);
}

async function expectMissingProjectRanking(kind: "elo" | "wcc" | "combined") {
  const response = await injectStatus("GET", `/api/projects/not-found/rankings/${kind}`);
  expect(response.statusCode).toBe(404);
  expect(response.json()).toMatchObject({ error: "Project not found" });
}

function withAuth(headers: Record<string, string> = {}): Record<string, string> {
  return authCookie ? { ...headers, cookie: authCookie } : headers;
}

function initializeDatabase(dbPath: string): void {
  const repoRoot = findRepoRoot();
  const sql = execFileSync(
    "npx",
    ["prisma", "migrate", "diff", "--from-empty", "--to-schema", "prisma/schema.prisma", "--script"],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, DATABASE_URL: `file:${dbPath}` }
    }
  );
  const db = new Database(dbPath);
  db.exec(sql);
  db.close();
}

function findRepoRoot(): string {
  let current = process.cwd();
  while (true) {
    if (fs.existsSync(path.join(current, "prisma/schema.prisma"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return process.cwd();
    current = parent;
  }
}
