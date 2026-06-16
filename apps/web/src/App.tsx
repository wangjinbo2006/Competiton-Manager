import { Activity, Plus, RefreshCcw, Swords, Trophy, Users } from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";
import { apiDelete, apiGet, apiPatch, apiPost, apiPostText } from "./api.js";
import type {
  AuthUser,
  BackupRecord,
  BracketView,
  Crosstable,
  Match,
  MatchResultType,
  PlayerMatchHistoryItem,
  PlayerRatingHistory,
  Project,
  ProjectPlayer,
  RankingPlayer,
  StandingRow,
  Tournament,
  TournamentFormat,
  WccRuleSet
} from "./types.js";
import type { BracketParticipant } from "./types.js";

const emptyPlayerForm = {
  name: "",
  displayName: "",
  code: "",
  nickname: "",
  gender: "",
  birthDate: "",
  country: "",
  region: "",
  club: "",
  contact: "",
  avatarUrl: "",
  note: "",
  seedRank: ""
};

export function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [players, setPlayers] = useState<ProjectPlayer[]>([]);
  const [historyPlayerId, setHistoryPlayerId] = useState("");
  const [playerMatchHistory, setPlayerMatchHistory] = useState<PlayerMatchHistoryItem[]>([]);
  const [playerRatingHistory, setPlayerRatingHistory] = useState<PlayerRatingHistory | null>(null);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [selectedTournamentId, setSelectedTournamentId] = useState<string>("");
  const [selectedTournament, setSelectedTournament] = useState<Tournament | null>(null);
  const [standings, setStandings] = useState<StandingRow[]>([]);
  const [crosstable, setCrosstable] = useState<Crosstable | null>(null);
  const [bracketView, setBracketView] = useState<BracketView | null>(null);
  const [eloRankings, setEloRankings] = useState<RankingPlayer[]>([]);
  const [wccRankings, setWccRankings] = useState<RankingPlayer[]>([]);
  const [combinedRankings, setCombinedRankings] = useState<RankingPlayer[]>([]);
  const [wccRules, setWccRules] = useState<WccRuleSet[]>([]);
  const [backups, setBackups] = useState<BackupRecord[]>([]);
  const [importCsv, setImportCsv] = useState("name,displayName,code,seedRank\n");
  const [initialized, setInitialized] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [projectName, setProjectName] = useState("本机比赛项目");
  const [projectSlug, setProjectSlug] = useState("local-competition");
  const [projectEditForm, setProjectEditForm] = useState({
    name: "",
    slug: "",
    defaultElo: "1200",
    eloKFactor: "20",
    eloEnabled: true,
    wccEnabled: true
  });
  const [playerForm, setPlayerForm] = useState(emptyPlayerForm);
  const [editingPlayerId, setEditingPlayerId] = useState("");
  const [playerEditForm, setPlayerEditForm] = useState(emptyPlayerForm);
  const [editingWccRuleId, setEditingWccRuleId] = useState("");
  const [wccRuleForm, setWccRuleForm] = useState({
    name: "WCC 100",
    champion: "100",
    finalist: "65",
    semifinal: "40",
    quarterfinal: "20",
    decayType: "FIXED_EXPIRY",
    validDays: "365",
    fullDays: "180",
    steps: "0:1,365:0"
  });
  const [tournamentForm, setTournamentForm] = useState({
    name: "",
    format: "SWISS" as TournamentFormat,
    level: "WCC_100",
    startDate: "",
    endDate: "",
    registrationDeadline: "",
    location: "",
    organizer: "",
    description: "",
    eloEnabled: true,
    wccEnabled: true,
    groupCount: "2",
    qualifyPerGroup: "2"
  });
  const [tournamentEditForm, setTournamentEditForm] = useState({
    name: "",
    level: "WCC_100",
    startDate: "",
    endDate: "",
    registrationDeadline: "",
    location: "",
    organizer: "",
    description: "",
    eloEnabled: true,
    wccEnabled: true,
    groupCount: "2",
    qualifyPerGroup: "2"
  });
  const [resultDrafts, setResultDrafts] = useState<Record<string, { scoreA: string; scoreB: string; resultType: MatchResultType; games: string }>>({});
  const [message, setMessage] = useState("准备就绪");

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId),
    [projects, selectedProjectId]
  );

  async function refreshProjects() {
    const nextProjects = await apiGet<Project[]>("/api/projects");
    setProjects(nextProjects);
    if (user) {
      setBackups(await apiGet<BackupRecord[]>("/api/backups"));
    } else {
      setBackups([]);
    }
    if (!selectedProjectId && nextProjects[0]) setSelectedProjectId(nextProjects[0].id);
  }

  async function refreshAuth() {
    const status = await apiGet<{ initialized: boolean }>("/api/auth/status");
    setInitialized(status.initialized);
    if (!status.initialized) {
      setUser(null);
      return;
    }
    try {
      setUser(await apiGet<AuthUser>("/api/auth/me"));
    } catch {
      setUser(null);
    }
  }

  async function refreshProjectData(projectId = selectedProjectId) {
    if (!projectId) return;
    const [nextPlayers, nextTournaments, nextEloRankings, nextWccRankings, nextCombinedRankings, nextWccRules] = await Promise.all([
      apiGet<ProjectPlayer[]>(`/api/projects/${projectId}/players`),
      apiGet<Tournament[]>(`/api/projects/${projectId}/tournaments`),
      apiGet<RankingPlayer[]>(`/api/projects/${projectId}/rankings/elo`),
      apiGet<RankingPlayer[]>(`/api/projects/${projectId}/rankings/wcc`),
      apiGet<RankingPlayer[]>(`/api/projects/${projectId}/rankings/combined`),
      apiGet<WccRuleSet[]>(`/api/projects/${projectId}/wcc-rules`)
    ]);
    setPlayers(nextPlayers);
    setTournaments(nextTournaments);
    setEloRankings(nextEloRankings);
    setWccRankings(nextWccRankings);
    setCombinedRankings(nextCombinedRankings);
    setWccRules(nextWccRules);
    if (!selectedTournamentId && nextTournaments[0]) setSelectedTournamentId(nextTournaments[0].id);
  }

  async function refreshTournament(tournamentId = selectedTournamentId) {
    if (!tournamentId) {
      setSelectedTournament(null);
      setStandings([]);
      setCrosstable(null);
      setBracketView(null);
      return;
    }
    const [tournament, nextStandings] = await Promise.all([
      apiGet<Tournament>(`/api/tournaments/${tournamentId}`),
      apiGet<StandingRow[]>(`/api/tournaments/${tournamentId}/standings`)
    ]);
    setSelectedTournament(tournament);
    setStandings(nextStandings);
    setCrosstable(tournament.format === "ROUND_ROBIN" ? await apiGet<Crosstable>(`/api/tournaments/${tournamentId}/crosstable`) : null);
    setBracketView(tournament.matches?.some((match) => match.bracketNodeKey) ? await apiGet<BracketView>(`/api/tournaments/${tournamentId}/bracket`) : null);
  }

  useEffect(() => {
    refreshAuth().catch((error: unknown) => setMessage(String(error)));
    refreshProjects().catch((error: unknown) => setMessage(String(error)));
  }, []);

  useEffect(() => {
    refreshProjects().catch((error: unknown) => setMessage(String(error)));
  }, [user?.id]);

  useEffect(() => {
    refreshProjectData().catch((error: unknown) => setMessage(String(error)));
  }, [selectedProjectId]);

  useEffect(() => {
    refreshTournament().catch((error: unknown) => setMessage(String(error)));
  }, [selectedTournamentId]);

  useEffect(() => {
    if (!selectedTournament) return;
    setTournamentEditForm({
      name: selectedTournament.name,
      level: selectedTournament.level ?? "WCC_100",
      startDate: formatDateTimeInput(selectedTournament.startDate),
      endDate: formatDateTimeInput(selectedTournament.endDate),
      registrationDeadline: formatDateTimeInput(selectedTournament.registrationDeadline),
      location: selectedTournament.location ?? "",
      organizer: selectedTournament.organizer ?? "",
      description: selectedTournament.description ?? "",
      eloEnabled: selectedTournament.eloEnabled ?? true,
      wccEnabled: selectedTournament.wccEnabled ?? true,
      groupCount: String(selectedTournament.drawConfig?.groupCount ?? 2),
      qualifyPerGroup: String(selectedTournament.drawConfig?.qualifyPerGroup ?? 2)
    });
  }, [
    selectedTournament?.id,
    selectedTournament?.name,
    selectedTournament?.level,
    selectedTournament?.startDate,
    selectedTournament?.endDate,
    selectedTournament?.registrationDeadline,
    selectedTournament?.location,
    selectedTournament?.organizer,
    selectedTournament?.description,
    selectedTournament?.eloEnabled,
    selectedTournament?.wccEnabled,
    selectedTournament?.drawConfig?.groupCount,
    selectedTournament?.drawConfig?.qualifyPerGroup
  ]);

  useEffect(() => {
    if (!selectedProject) return;
    setProjectEditForm({
      name: selectedProject.name,
      slug: selectedProject.slug,
      defaultElo: String(selectedProject.defaultElo),
      eloKFactor: String(selectedProject.scoringConfig?.eloKFactor ?? 20),
      eloEnabled: selectedProject.eloEnabled ?? true,
      wccEnabled: selectedProject.wccEnabled ?? true
    });
    setTournamentForm((current) => ({
      ...current,
      eloEnabled: selectedProject.eloEnabled ?? true,
      wccEnabled: selectedProject.wccEnabled ?? true
    }));
  }, [
    selectedProject?.id,
    selectedProject?.name,
    selectedProject?.slug,
    selectedProject?.defaultElo,
    selectedProject?.scoringConfig?.eloKFactor,
    selectedProject?.eloEnabled,
    selectedProject?.wccEnabled
  ]);

  async function createDemoProject() {
    if (!user) return;
    const suffix = Math.floor(Math.random() * 10_000);
    const project = await apiPost<Project>("/api/projects", {
      name: `本机测试项目 ${suffix}`,
      slug: `local-demo-${suffix}`,
      defaultElo: 1200,
      scoringConfig: { eloKFactor: 20 },
      eloEnabled: true,
      wccEnabled: true
    });
    setMessage("已创建项目");
    setSelectedProjectId(project.id);
    await refreshProjects();
  }

  async function createProject() {
    if (!user) return;
    const project = await apiPost<Project>("/api/projects", {
      name: projectName.trim(),
      slug: projectSlug.trim(),
      defaultElo: 1200,
      scoringConfig: { eloKFactor: 20 },
      eloEnabled: true,
      wccEnabled: true
    });
    setMessage("已创建项目");
    setSelectedProjectId(project.id);
    await refreshProjects();
  }

  async function updateProject() {
    if (!selectedProjectId || !user || !projectEditForm.name.trim() || !projectEditForm.slug.trim()) return;
    const defaultElo = Number.parseInt(projectEditForm.defaultElo, 10);
    const eloKFactor = Number.parseInt(projectEditForm.eloKFactor, 10);
    await apiPatch(`/api/projects/${selectedProjectId}`, {
      name: projectEditForm.name.trim(),
      slug: projectEditForm.slug.trim(),
      defaultElo: Number.isFinite(defaultElo) ? defaultElo : 1200,
      scoringConfig: { eloKFactor: Number.isFinite(eloKFactor) ? eloKFactor : 20 },
      eloEnabled: projectEditForm.eloEnabled,
      wccEnabled: projectEditForm.wccEnabled
    });
    setMessage("已更新项目设置");
    await refreshProjects();
    await refreshProjectData();
  }

  async function recalculateRatings() {
    if (!selectedProjectId || !user) return;
    const result = await apiPost<{ matches: number; players: number; wccEvents: number }>(`/api/projects/${selectedProjectId}/recalculate-ratings`);
    setMessage(`已重算 ${result.players} 名选手、${result.matches} 场比赛、${result.wccEvents} 条 WCC`);
    await refreshProjectData();
    await refreshTournament();
  }

  async function addPlayer() {
    if (!selectedProjectId || !user) return;
    const index = players.length + 1;
    const name = playerForm.name.trim() || `选手 ${index}`;
    const seedRank = Number.parseInt(playerForm.seedRank, 10);
    await apiPost(`/api/projects/${selectedProjectId}/players`, {
      name,
      displayName: playerForm.displayName.trim() || name,
      code: playerForm.code.trim() || `P${index}`,
      nickname: optionalText(playerForm.nickname),
      gender: optionalText(playerForm.gender),
      birthDate: optionalText(playerForm.birthDate),
      country: optionalText(playerForm.country),
      region: optionalText(playerForm.region),
      club: optionalText(playerForm.club),
      contact: optionalText(playerForm.contact),
      avatarUrl: optionalText(playerForm.avatarUrl),
      note: optionalText(playerForm.note),
      seedRank: Number.isFinite(seedRank) && seedRank > 0 ? seedRank : index
    });
    setPlayerForm(emptyPlayerForm);
    setMessage("已添加选手");
    await refreshProjectData();
  }

  function startEditPlayer(player: ProjectPlayer) {
    setEditingPlayerId(player.id);
    setPlayerEditForm({
      name: player.player?.name ?? player.displayName,
      displayName: player.displayName,
      code: player.code ?? "",
      nickname: player.player?.nickname ?? "",
      gender: player.player?.gender ?? "",
      birthDate: formatDateInput(player.player?.birthDate),
      country: player.player?.country ?? "",
      region: player.player?.region ?? "",
      club: player.player?.club ?? "",
      contact: player.player?.contact ?? "",
      avatarUrl: player.player?.avatarUrl ?? "",
      note: player.player?.note ?? "",
      seedRank: player.seedRank ? String(player.seedRank) : ""
    });
  }

  async function togglePlayerHistory(player: ProjectPlayer) {
    if (historyPlayerId === player.id) {
      setHistoryPlayerId("");
      setPlayerMatchHistory([]);
      setPlayerRatingHistory(null);
      return;
    }

    const [matchHistory, ratingHistory] = await Promise.all([
      apiGet<PlayerMatchHistoryItem[]>(`/api/project-players/${player.id}/history`),
      apiGet<PlayerRatingHistory>(`/api/project-players/${player.id}/rating-history`)
    ]);
    setHistoryPlayerId(player.id);
    setPlayerMatchHistory(matchHistory);
    setPlayerRatingHistory(ratingHistory);
  }

  async function savePlayerEdit() {
    if (!editingPlayerId || !user) return;
    const seedRank = Number.parseInt(playerEditForm.seedRank, 10);
    await apiPatch(`/api/project-players/${editingPlayerId}`, {
      name: playerEditForm.name.trim(),
      displayName: playerEditForm.displayName.trim(),
      code: playerEditForm.code.trim() || null,
      nickname: nullableText(playerEditForm.nickname),
      gender: nullableText(playerEditForm.gender),
      birthDate: nullableText(playerEditForm.birthDate),
      country: nullableText(playerEditForm.country),
      region: nullableText(playerEditForm.region),
      club: nullableText(playerEditForm.club),
      contact: nullableText(playerEditForm.contact),
      avatarUrl: nullableText(playerEditForm.avatarUrl),
      note: nullableText(playerEditForm.note),
      seedRank: Number.isFinite(seedRank) && seedRank > 0 ? seedRank : undefined
    });
    setEditingPlayerId("");
    setMessage("已更新选手");
    await refreshProjectData();
  }

  async function createTournament() {
    if (!selectedProjectId || !user) return;
    const format = tournamentForm.format;
    const groupCount = positiveIntOrDefault(tournamentForm.groupCount, 2);
    const qualifyPerGroup = positiveIntOrDefault(tournamentForm.qualifyPerGroup, 2);
    const tournament = await apiPost<Tournament>(`/api/projects/${selectedProjectId}/tournaments`, {
      name: tournamentForm.name.trim() || `${formatLabel(format)} ${new Date().toLocaleString()}`,
      level: tournamentForm.level.trim() || "WCC_100",
      format,
      startDate: optionalDateTime(tournamentForm.startDate),
      endDate: optionalDateTime(tournamentForm.endDate),
      registrationDeadline: optionalDateTime(tournamentForm.registrationDeadline),
      location: optionalText(tournamentForm.location),
      organizer: optionalText(tournamentForm.organizer),
      description: optionalText(tournamentForm.description),
      eloEnabled: tournamentForm.eloEnabled,
      wccEnabled: tournamentForm.wccEnabled,
      config: format === "CUP" ? { groupCount, qualifyPerGroup } : undefined
    });
    setTournamentForm((current) => ({ ...current, name: "", startDate: "", endDate: "", registrationDeadline: "", location: "", organizer: "", description: "" }));
    setSelectedTournamentId(tournament.id);
    setMessage("已创建赛事");
    await refreshProjectData();
  }

  async function addAllPlayersToTournament() {
    if (!selectedTournamentId || !user) return;
    for (const [index, player] of players.entries()) {
      try {
        await apiPost(`/api/tournaments/${selectedTournamentId}/participants`, {
          projectPlayerId: player.id,
          seed: index + 1
        });
      } catch {
        // 已添加的选手会触发唯一约束，前端批量添加时直接跳过。
      }
    }
    setMessage("已同步参赛名单");
    await refreshTournament();
    await refreshProjectData();
  }

  async function updateTournamentParticipant(participantId: string, input: { seed?: number | null; checkedIn?: boolean; registrationStatus?: string }) {
    if (!selectedTournamentId || !user) return;
    await apiPatch(`/api/tournaments/${selectedTournamentId}/participants/${participantId}`, input);
    setMessage("已更新参赛名单");
    await refreshTournament();
    await refreshProjectData();
  }

  async function updateTournamentParticipantSeed(participantId: string, value: string) {
    const seed = Number.parseInt(value, 10);
    await updateTournamentParticipant(participantId, { seed: Number.isFinite(seed) && seed > 0 ? seed : null });
  }

  async function removeTournamentParticipant(participantId: string) {
    if (!selectedTournamentId || !user) return;
    await apiDelete(`/api/tournaments/${selectedTournamentId}/participants/${participantId}`);
    setMessage("已移除参赛选手");
    await refreshTournament();
    await refreshProjectData();
  }

  async function updateTournamentSettings() {
    if (!selectedTournament || !selectedTournamentId || !user || !tournamentEditForm.name.trim()) return;
    const hasMatches = (selectedTournament.matches ?? []).length > 0;
    const groupCount = positiveIntOrDefault(tournamentEditForm.groupCount, 2);
    const qualifyPerGroup = positiveIntOrDefault(tournamentEditForm.qualifyPerGroup, 2);
    await apiPatch(`/api/tournaments/${selectedTournamentId}`, {
      name: tournamentEditForm.name.trim(),
      level: tournamentEditForm.level.trim() || "WCC_100",
      startDate: nullableDateTime(tournamentEditForm.startDate),
      endDate: nullableDateTime(tournamentEditForm.endDate),
      registrationDeadline: nullableDateTime(tournamentEditForm.registrationDeadline),
      location: nullableText(tournamentEditForm.location),
      organizer: nullableText(tournamentEditForm.organizer),
      description: nullableText(tournamentEditForm.description),
      eloEnabled: tournamentEditForm.eloEnabled,
      wccEnabled: tournamentEditForm.wccEnabled,
      config: selectedTournament.format === "CUP" && !hasMatches ? { groupCount, qualifyPerGroup } : undefined
    });
    setMessage("已更新赛事设置");
    await refreshTournament();
    await refreshProjectData();
  }

  async function cancelTournament() {
    if (!selectedTournamentId || !user) return;
    await apiPost(`/api/tournaments/${selectedTournamentId}/cancel`);
    setMessage("赛事已取消");
    await refreshTournament();
    await refreshProjectData();
  }

  async function drawTournament() {
    if (!selectedTournamentId || !user) return;
    await apiPost(`/api/tournaments/${selectedTournamentId}/draw`);
    setMessage("已完成自动抽签和编排");
    await refreshTournament();
    await refreshProjectData();
  }

  async function generateNextRound() {
    if (!selectedTournamentId || !user) return;
    await apiPost(`/api/tournaments/${selectedTournamentId}/generate-next-round`);
    setMessage("已生成瑞士轮下一轮");
    await refreshTournament();
  }

  async function generateKnockoutStage() {
    if (!selectedTournamentId || !user) return;
    await apiPost(`/api/tournaments/${selectedTournamentId}/generate-knockout-stage`);
    setMessage("已生成杯赛淘汰赛阶段");
    await refreshTournament();
  }

  function resultDraftFor(match: Match) {
    return (
      resultDrafts[match.id] ?? {
        scoreA: match.scoreA != null ? String(match.scoreA) : "1",
        scoreB: match.scoreB != null ? String(match.scoreB) : "0",
        resultType: (match.resultType && match.resultType !== "BYE" ? match.resultType : "A_WIN") as MatchResultType,
        games: formatGameDraft(match)
      }
    );
  }

  function updateResultDraft(match: Match, updates: Partial<{ scoreA: string; scoreB: string; resultType: MatchResultType; games: string }>) {
    const current = resultDraftFor(match);
    const next = { ...current, ...updates };
    if (updates.resultType) {
      const [scoreA, scoreB] = defaultScoreForResult(updates.resultType);
      next.scoreA = String(scoreA);
      next.scoreB = String(scoreB);
    }
    setResultDrafts((drafts) => ({ ...drafts, [match.id]: next }));
  }

  async function recordResult(match: Match) {
    if (!user) return;
    const draft = resultDraftFor(match);
    const scoreA = Number.parseFloat(draft.scoreA);
    const scoreB = Number.parseFloat(draft.scoreB);
    await apiPatch(`/api/matches/${match.id}/result`, {
      scoreA: Number.isFinite(scoreA) ? scoreA : 0,
      scoreB: Number.isFinite(scoreB) ? scoreB : 0,
      resultType: draft.resultType,
      games: parseGameDraft(draft.games)
    });
    setResultDrafts((drafts) => {
      const next = { ...drafts };
      delete next[match.id];
      return next;
    });
    setMessage("已录入成绩并更新 Elo");
    await refreshTournament();
    await refreshProjectData();
  }

  async function reopenMatchResult(match: Match) {
    if (!user || !selectedProjectId) return;
    await apiPost(`/api/matches/${match.id}/reopen`);
    await apiPost(`/api/projects/${selectedProjectId}/recalculate-ratings`);
    setMessage("已撤销赛果并重算积分");
    await refreshTournament();
    await refreshProjectData();
  }

  async function updateMatch(match: Match, input: { tableNumber?: number | null; startsAt?: string | null; status?: string }) {
    if (!user) return;
    await apiPatch(`/api/matches/${match.id}`, input);
    setMessage("已更新对阵安排");
    await refreshTournament();
  }

  async function updateMatchTable(match: Match, value: string) {
    const tableNumber = Number.parseInt(value, 10);
    await updateMatch(match, { tableNumber: Number.isFinite(tableNumber) && tableNumber > 0 ? tableNumber : null });
  }

  async function updateMatchStartsAt(match: Match, value: string) {
    await updateMatch(match, { startsAt: value ? new Date(value).toISOString() : null });
  }

  async function completeTournament() {
    if (!selectedTournamentId || !user) return;
    await apiPost(`/api/tournaments/${selectedTournamentId}/complete`);
    setMessage("赛事已完成并发放 WCC 分");
    await refreshTournament();
    await refreshProjectData();
  }

  async function createBackup() {
    if (!user) return;
    const backup = await apiPost<{ fileName: string }>("/api/backups");
    setMessage(`已创建备份 ${backup.fileName}`);
    setBackups(await apiGet<BackupRecord[]>("/api/backups"));
  }

  async function restoreBackup(backupId: string) {
    if (!user) return;
    await apiPost(`/api/backups/${backupId}/restore`);
    setMessage("已恢复备份，请重启服务后继续使用");
  }

  async function importPlayers() {
    if (!selectedProjectId || !user) return;
    const result = await apiPostText<{ created: number; skipped: Array<{ reason: string }> }>(
      `/api/projects/${selectedProjectId}/import/players`,
      importCsv
    );
    setMessage(`已导入 ${result.created} 名选手，跳过 ${result.skipped.length} 行`);
    await refreshProjectData();
  }

  async function createWccRule() {
    if (!selectedProjectId || !user) return;
    const champion = Number.parseInt(wccRuleForm.champion, 10);
    const finalist = Number.parseInt(wccRuleForm.finalist, 10);
    const semifinal = Number.parseInt(wccRuleForm.semifinal, 10);
    const quarterfinal = Number.parseInt(wccRuleForm.quarterfinal, 10);
    const validDays = Number.parseInt(wccRuleForm.validDays, 10);
    const fullDays = Number.parseInt(wccRuleForm.fullDays, 10);
    const decayType = wccRuleForm.decayType === "STEP" ? "STEP" : wccRuleForm.decayType === "LINEAR" ? "LINEAR" : "FIXED_EXPIRY";
    const payload = {
      name: wccRuleForm.name.trim(),
      level: "WCC_100",
      pointsTable: {
        CHAMPION: Number.isFinite(champion) ? champion : 100,
        FINALIST: Number.isFinite(finalist) ? finalist : 65,
        SEMIFINAL: Number.isFinite(semifinal) ? semifinal : 40,
        QUARTERFINAL: Number.isFinite(quarterfinal) ? quarterfinal : 20,
        ROUND_OF_16: 10,
        PARTICIPATION: 2
      },
      decayType,
      decayConfig:
        decayType === "STEP"
          ? { steps: parseWccSteps(wccRuleForm.steps) }
          : decayType === "LINEAR"
            ? {
                fullDays: Number.isFinite(fullDays) && fullDays >= 0 ? fullDays : 180,
                validDays: Number.isFinite(validDays) && validDays > 0 ? validDays : 365
              }
          : { validDays: Number.isFinite(validDays) && validDays > 0 ? validDays : 365 },
      active: true
    };
    if (editingWccRuleId) {
      await apiPatch(`/api/wcc-rules/${editingWccRuleId}`, payload);
    } else {
      await apiPost(`/api/projects/${selectedProjectId}/wcc-rules`, payload);
    }
    setEditingWccRuleId("");
    setMessage("已保存 WCC 规则");
    await refreshProjectData();
  }

  function startEditWccRule(rule: WccRuleSet) {
    setEditingWccRuleId(rule.id);
    setWccRuleForm({
      name: rule.name,
      champion: String(rule.pointsTable.CHAMPION ?? 100),
      finalist: String(rule.pointsTable.FINALIST ?? 65),
      semifinal: String(rule.pointsTable.SEMIFINAL ?? 40),
      quarterfinal: String(rule.pointsTable.QUARTERFINAL ?? 20),
      decayType: rule.decayType === "STEP" ? "STEP" : rule.decayType === "LINEAR" ? "LINEAR" : "FIXED_EXPIRY",
      validDays: String(rule.decayConfig?.validDays ?? 365),
      fullDays: String(rule.decayConfig?.fullDays ?? 180),
      steps: formatWccSteps(rule.decayConfig?.steps)
    });
  }

  async function setWccRuleActive(rule: WccRuleSet, active: boolean) {
    if (!user) return;
    await apiPatch(`/api/wcc-rules/${rule.id}`, { active });
    setMessage(active ? "已启用 WCC 规则" : "已停用 WCC 规则");
    await refreshProjectData();
  }

  async function deactivatePlayer(playerId: string) {
    if (!user) return;
    await apiDelete(`/api/project-players/${playerId}`);
    setMessage("已停用选手");
    await refreshProjectData();
  }

  async function submitAuth() {
    const endpoint = initialized ? "/api/auth/login" : "/api/auth/setup";
    const nextUser = await apiPost<AuthUser>(endpoint, { username, password });
    setUser(nextUser);
    setInitialized(true);
    setPassword("");
    setMessage(initialized ? "已登录" : "管理员已创建");
  }

  async function logout() {
    await apiPost("/api/auth/logout");
    setUser(null);
    setBackups([]);
    setMessage("已退出");
  }

  const canEditTournamentParticipants = Boolean(
    selectedTournament && user && selectedTournament.status !== "CANCELLED" && selectedTournament.status !== "COMPLETED" && (selectedTournament.matches ?? []).length === 0
  );

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <Trophy size={28} />
          <div>
            <strong>Competition Manager</strong>
            <span>本机服务器模式</span>
          </div>
        </div>
        <button className="primary" onClick={createDemoProject} disabled={!user}>
          <Plus size={16} /> 新建测试项目
        </button>
        <div className="quickForm">
          <strong>创建项目</strong>
          <input value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder="项目名称" />
          <input value={projectSlug} onChange={(event) => setProjectSlug(event.target.value)} placeholder="英文标识" />
          <button onClick={createProject} disabled={!user || !projectName.trim() || !projectSlug.trim()}>
            <Plus size={16} /> 创建
          </button>
        </div>
        <div className="authBox">
          {user ? (
            <>
              <strong>{user.username}</strong>
              <button onClick={logout}>退出</button>
            </>
          ) : (
            <>
              <input value={username} onChange={(event) => setUsername(event.target.value)} />
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
              <button onClick={submitAuth}>{initialized ? "登录" : "初始化"}</button>
            </>
          )}
        </div>
        <label>
          当前项目
          <select value={selectedProjectId} onChange={(event) => setSelectedProjectId(event.target.value)}>
            <option value="">请选择</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
        {selectedProject && (
          <div className="quickForm">
            <strong>项目设置</strong>
            <input value={projectEditForm.name} onChange={(event) => setProjectEditForm({ ...projectEditForm, name: event.target.value })} />
            <input value={projectEditForm.slug} onChange={(event) => setProjectEditForm({ ...projectEditForm, slug: event.target.value })} />
            <input
              value={projectEditForm.defaultElo}
              onChange={(event) => setProjectEditForm({ ...projectEditForm, defaultElo: event.target.value })}
              placeholder="默认 Elo"
            />
            <input
              value={projectEditForm.eloKFactor}
              onChange={(event) => setProjectEditForm({ ...projectEditForm, eloKFactor: event.target.value })}
              placeholder="Elo K 值"
            />
            <label className="checkLine">
              <input
                type="checkbox"
                checked={projectEditForm.eloEnabled}
                onChange={(event) => setProjectEditForm({ ...projectEditForm, eloEnabled: event.target.checked })}
              />
              Elo
            </label>
            <label className="checkLine">
              <input
                type="checkbox"
                checked={projectEditForm.wccEnabled}
                onChange={(event) => setProjectEditForm({ ...projectEditForm, wccEnabled: event.target.checked })}
              />
              WCC
            </label>
            <button onClick={updateProject} disabled={!user || !projectEditForm.name.trim() || !projectEditForm.slug.trim()}>保存项目</button>
            <button onClick={recalculateRatings} disabled={!user}>重算积分</button>
          </div>
        )}
        <p className="status">{message}</p>
      </aside>

      <section className="content">
        <header className="topbar">
          <div>
            <span className="eyebrow">项目概览</span>
            <h1>{selectedProject?.name ?? "还没有项目"}</h1>
          </div>
          <button onClick={() => refreshProjectData()}>
            <RefreshCcw size={16} /> 刷新
          </button>
          <button onClick={createBackup} disabled={!user}>备份</button>
        </header>

        <section className="metrics">
          <Metric icon={<Users size={20} />} label="选手" value={players.length} />
          <Metric icon={<Swords size={20} />} label="赛事" value={tournaments.length} />
          <Metric icon={<Activity size={20} />} label="最高 Elo" value={players[0]?.currentElo ?? "-"} />
        </section>

        <div className="grid">
          <section className="panel">
            <div className="panelHeader">
              <h2>选手</h2>
              <button onClick={addPlayer} disabled={!selectedProjectId || !user}>
                <Plus size={16} /> 添加
              </button>
            </div>
            <div className="formGrid">
              <input value={playerForm.name} onChange={(event) => setPlayerForm({ ...playerForm, name: event.target.value })} placeholder="姓名" />
              <input
                value={playerForm.displayName}
                onChange={(event) => setPlayerForm({ ...playerForm, displayName: event.target.value })}
                placeholder="显示名"
              />
              <input value={playerForm.code} onChange={(event) => setPlayerForm({ ...playerForm, code: event.target.value })} placeholder="编号" />
              <input value={playerForm.nickname} onChange={(event) => setPlayerForm({ ...playerForm, nickname: event.target.value })} placeholder="昵称" />
              <input value={playerForm.gender} onChange={(event) => setPlayerForm({ ...playerForm, gender: event.target.value })} placeholder="性别" />
              <input
                type="date"
                value={playerForm.birthDate}
                onChange={(event) => setPlayerForm({ ...playerForm, birthDate: event.target.value })}
                aria-label="出生日期"
              />
              <input value={playerForm.country} onChange={(event) => setPlayerForm({ ...playerForm, country: event.target.value })} placeholder="国家/地区" />
              <input value={playerForm.region} onChange={(event) => setPlayerForm({ ...playerForm, region: event.target.value })} placeholder="地区/城市" />
              <input value={playerForm.club} onChange={(event) => setPlayerForm({ ...playerForm, club: event.target.value })} placeholder="队伍/俱乐部" />
              <input
                value={playerForm.contact}
                onChange={(event) => setPlayerForm({ ...playerForm, contact: event.target.value })}
                placeholder="联系方式"
              />
              <input
                value={playerForm.avatarUrl}
                onChange={(event) => setPlayerForm({ ...playerForm, avatarUrl: event.target.value })}
                placeholder="头像链接"
              />
              <input
                value={playerForm.seedRank}
                onChange={(event) => setPlayerForm({ ...playerForm, seedRank: event.target.value })}
                placeholder="种子序号"
              />
              <input value={playerForm.note} onChange={(event) => setPlayerForm({ ...playerForm, note: event.target.value })} placeholder="备注" />
            </div>
            <div className="table">
              {players.map((player, index) => (
                <div className="playerBlock" key={player.id}>
                  <div className="row">
                    <span>{index + 1}</span>
                    <strong>{player.displayName}</strong>
                    <span>Elo {player.currentElo}</span>
                    <span>WCC {player.currentWcc}</span>
                    <div className="actions">
                      <button onClick={() => togglePlayerHistory(player)}>{historyPlayerId === player.id ? "收起" : "历史"}</button>
                      <button onClick={() => startEditPlayer(player)} disabled={!user}>编辑</button>
                      <button onClick={() => deactivatePlayer(player.id)} disabled={!user}>停用</button>
                    </div>
                  </div>
                  <div className="playerMeta">
                    {player.player?.nickname && <span>昵称 {player.player.nickname}</span>}
                    {player.player?.gender && <span>性别 {player.player.gender}</span>}
                    {player.player?.birthDate && <span>生日 {formatDateInput(player.player.birthDate)}</span>}
                    {player.player?.country && <span>{player.player.country}</span>}
                    {player.player?.region && <span>{player.player.region}</span>}
                    {player.player?.club && <span>{player.player.club}</span>}
                    {player.player?.contact && <span>{player.player.contact}</span>}
                    {player.seedRank && <span>种子 {player.seedRank}</span>}
                    {player.player?.note && <span>备注 {player.player.note}</span>}
                  </div>
                  {historyPlayerId === player.id && (
                    <div className="historyPanel">
                      <div>
                        <strong>参赛历史</strong>
                        <div className="historyList">
                          {playerMatchHistory.slice(0, 5).map((item) => (
                            <div className="historyItem" key={item.matchId}>
                              <span>{outcomeLabel(item.outcome)}</span>
                              <span>{item.tournamentName}</span>
                              <span>{item.opponentDisplayName}</span>
                              <span>{item.score ?? "-"}</span>
                            </div>
                          ))}
                          {playerMatchHistory.length === 0 && <span className="muted">暂无已完成比赛</span>}
                        </div>
                      </div>
                      <div>
                        <strong>积分历史</strong>
                        <div className="historyList">
                          {(playerRatingHistory?.elo ?? []).slice(0, 3).map((item) => (
                            <div className="historyItem" key={item.id}>
                              <span>Elo</span>
                              <span>{item.tournamentName ?? "比赛"}</span>
                              <span>{`${item.ratingBefore} -> ${item.ratingAfter}`}</span>
                              <span>{signedNumber(item.delta)}</span>
                            </div>
                          ))}
                          {(playerRatingHistory?.wcc ?? []).slice(0, 3).map((item) => (
                            <div className="historyItem" key={item.id}>
                              <span>WCC</span>
                              <span>{item.tournamentName}</span>
                              <span>第 {item.finalRank} 名</span>
                              <span>+{item.rawPoints}</span>
                            </div>
                          ))}
                          {(playerRatingHistory?.elo.length ?? 0) + (playerRatingHistory?.wcc.length ?? 0) === 0 && <span className="muted">暂无积分记录</span>}
                        </div>
                      </div>
                    </div>
                  )}
                  {editingPlayerId === player.id && (
                    <div className="formGrid playerEditRow">
                      <input value={playerEditForm.name} onChange={(event) => setPlayerEditForm({ ...playerEditForm, name: event.target.value })} placeholder="姓名" />
                      <input
                        value={playerEditForm.displayName}
                        onChange={(event) => setPlayerEditForm({ ...playerEditForm, displayName: event.target.value })}
                        placeholder="显示名"
                      />
                      <input value={playerEditForm.code} onChange={(event) => setPlayerEditForm({ ...playerEditForm, code: event.target.value })} placeholder="编号" />
                      <input
                        value={playerEditForm.nickname}
                        onChange={(event) => setPlayerEditForm({ ...playerEditForm, nickname: event.target.value })}
                        placeholder="昵称"
                      />
                      <input
                        value={playerEditForm.gender}
                        onChange={(event) => setPlayerEditForm({ ...playerEditForm, gender: event.target.value })}
                        placeholder="性别"
                      />
                      <input
                        type="date"
                        value={playerEditForm.birthDate}
                        onChange={(event) => setPlayerEditForm({ ...playerEditForm, birthDate: event.target.value })}
                        aria-label="出生日期"
                      />
                      <input
                        value={playerEditForm.country}
                        onChange={(event) => setPlayerEditForm({ ...playerEditForm, country: event.target.value })}
                        placeholder="国家/地区"
                      />
                      <input
                        value={playerEditForm.region}
                        onChange={(event) => setPlayerEditForm({ ...playerEditForm, region: event.target.value })}
                        placeholder="地区/城市"
                      />
                      <input value={playerEditForm.club} onChange={(event) => setPlayerEditForm({ ...playerEditForm, club: event.target.value })} placeholder="队伍/俱乐部" />
                      <input value={playerEditForm.contact} onChange={(event) => setPlayerEditForm({ ...playerEditForm, contact: event.target.value })} placeholder="联系方式" />
                      <input
                        value={playerEditForm.avatarUrl}
                        onChange={(event) => setPlayerEditForm({ ...playerEditForm, avatarUrl: event.target.value })}
                        placeholder="头像链接"
                      />
                      <input
                        value={playerEditForm.seedRank}
                        onChange={(event) => setPlayerEditForm({ ...playerEditForm, seedRank: event.target.value })}
                        placeholder="种子序号"
                      />
                      <input value={playerEditForm.note} onChange={(event) => setPlayerEditForm({ ...playerEditForm, note: event.target.value })} placeholder="备注" />
                      <button onClick={savePlayerEdit} disabled={!user || !playerEditForm.name.trim() || !playerEditForm.displayName.trim()}>保存</button>
                      <button onClick={() => setEditingPlayerId("")}>取消</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>

          <section className="panel">
            <div className="panelHeader">
              <h2>赛事</h2>
              <button onClick={createTournament} disabled={!selectedProjectId || !user}>
                <Plus size={16} /> 创建赛事
              </button>
            </div>
            <div className="formGrid tournamentCreateGrid">
              <input
                value={tournamentForm.name}
                onChange={(event) => setTournamentForm({ ...tournamentForm, name: event.target.value })}
                placeholder="赛事名称"
              />
              <select
                value={tournamentForm.format}
                onChange={(event) => setTournamentForm({ ...tournamentForm, format: event.target.value as TournamentFormat })}
              >
                <option value="SINGLE_ELIMINATION">淘汰赛</option>
                <option value="ROUND_ROBIN">循环赛</option>
                <option value="SWISS">瑞士轮</option>
                <option value="CUP">杯赛</option>
              </select>
              <input
                value={tournamentForm.level}
                onChange={(event) => setTournamentForm({ ...tournamentForm, level: event.target.value })}
                placeholder="赛事等级"
              />
              <input
                type="datetime-local"
                value={tournamentForm.startDate}
                onChange={(event) => setTournamentForm({ ...tournamentForm, startDate: event.target.value })}
              />
              <input
                type="datetime-local"
                value={tournamentForm.endDate}
                onChange={(event) => setTournamentForm({ ...tournamentForm, endDate: event.target.value })}
              />
              <input
                type="datetime-local"
                value={tournamentForm.registrationDeadline}
                onChange={(event) => setTournamentForm({ ...tournamentForm, registrationDeadline: event.target.value })}
              />
              <input
                value={tournamentForm.location}
                onChange={(event) => setTournamentForm({ ...tournamentForm, location: event.target.value })}
                placeholder="地点"
              />
              <input
                value={tournamentForm.organizer}
                onChange={(event) => setTournamentForm({ ...tournamentForm, organizer: event.target.value })}
                placeholder="主办方"
              />
              <input
                value={tournamentForm.description}
                onChange={(event) => setTournamentForm({ ...tournamentForm, description: event.target.value })}
                placeholder="说明"
              />
              {tournamentForm.format === "CUP" && (
                <>
                  <input
                    value={tournamentForm.groupCount}
                    onChange={(event) => setTournamentForm({ ...tournamentForm, groupCount: event.target.value })}
                    placeholder="小组数量"
                  />
                  <input
                    value={tournamentForm.qualifyPerGroup}
                    onChange={(event) => setTournamentForm({ ...tournamentForm, qualifyPerGroup: event.target.value })}
                    placeholder="每组晋级"
                  />
                </>
              )}
              <label className="checkLine">
                <input
                  type="checkbox"
                  checked={tournamentForm.eloEnabled}
                  onChange={(event) => setTournamentForm({ ...tournamentForm, eloEnabled: event.target.checked })}
                />
                Elo
              </label>
              <label className="checkLine">
                <input
                  type="checkbox"
                  checked={tournamentForm.wccEnabled}
                  onChange={(event) => setTournamentForm({ ...tournamentForm, wccEnabled: event.target.checked })}
                />
                WCC
              </label>
            </div>
            <select value={selectedTournamentId} onChange={(event) => setSelectedTournamentId(event.target.value)}>
              <option value="">请选择赛事</option>
              {tournaments.map((tournament) => (
                <option key={tournament.id} value={tournament.id}>
                  {tournament.name}
                </option>
              ))}
            </select>
            {selectedTournament && (
              <div className="opsStack">
                <div className="formGrid tournamentSettingsGrid">
                  <input
                    value={tournamentEditForm.name}
                    onChange={(event) => setTournamentEditForm({ ...tournamentEditForm, name: event.target.value })}
                  />
                  <input
                    value={tournamentEditForm.level}
                    onChange={(event) => setTournamentEditForm({ ...tournamentEditForm, level: event.target.value })}
                  />
                  <input
                    type="datetime-local"
                    value={tournamentEditForm.startDate}
                    onChange={(event) => setTournamentEditForm({ ...tournamentEditForm, startDate: event.target.value })}
                  />
                  <input
                    type="datetime-local"
                    value={tournamentEditForm.endDate}
                    onChange={(event) => setTournamentEditForm({ ...tournamentEditForm, endDate: event.target.value })}
                  />
                  <input
                    type="datetime-local"
                    value={tournamentEditForm.registrationDeadline}
                    onChange={(event) => setTournamentEditForm({ ...tournamentEditForm, registrationDeadline: event.target.value })}
                  />
                  <input
                    value={tournamentEditForm.location}
                    onChange={(event) => setTournamentEditForm({ ...tournamentEditForm, location: event.target.value })}
                    placeholder="地点"
                  />
                  <input
                    value={tournamentEditForm.organizer}
                    onChange={(event) => setTournamentEditForm({ ...tournamentEditForm, organizer: event.target.value })}
                    placeholder="主办方"
                  />
                  <input
                    value={tournamentEditForm.description}
                    onChange={(event) => setTournamentEditForm({ ...tournamentEditForm, description: event.target.value })}
                    placeholder="说明"
                  />
                  {selectedTournament.format === "CUP" && (
                    <>
                      <input
                        value={tournamentEditForm.groupCount}
                        onChange={(event) => setTournamentEditForm({ ...tournamentEditForm, groupCount: event.target.value })}
                        disabled={(selectedTournament.matches ?? []).length > 0}
                      />
                      <input
                        value={tournamentEditForm.qualifyPerGroup}
                        onChange={(event) => setTournamentEditForm({ ...tournamentEditForm, qualifyPerGroup: event.target.value })}
                        disabled={(selectedTournament.matches ?? []).length > 0}
                      />
                    </>
                  )}
                  <label className="checkLine">
                    <input
                      type="checkbox"
                      checked={tournamentEditForm.eloEnabled}
                      onChange={(event) => setTournamentEditForm({ ...tournamentEditForm, eloEnabled: event.target.checked })}
                    />
                    Elo
                  </label>
                  <label className="checkLine">
                    <input
                      type="checkbox"
                      checked={tournamentEditForm.wccEnabled}
                      onChange={(event) => setTournamentEditForm({ ...tournamentEditForm, wccEnabled: event.target.checked })}
                    />
                    WCC
                  </label>
                  <button onClick={updateTournamentSettings} disabled={!user || !tournamentEditForm.name.trim()}>保存</button>
                  <button onClick={cancelTournament} disabled={!user || selectedTournament.status === "COMPLETED"}>取消</button>
                </div>
                <div className="tournamentOps">
                  <button onClick={addAllPlayersToTournament} disabled={!user}>同步选手</button>
                  <button onClick={drawTournament} disabled={!user}>自动抽签</button>
                  <button onClick={generateNextRound} disabled={!user}>下一轮</button>
                  <button onClick={generateKnockoutStage} disabled={!user}>淘汰阶段</button>
                  <button onClick={completeTournament} disabled={!user || !canCompleteTournament(selectedTournament)}>完成赛事</button>
                </div>
                <div className="participantList">
                  {(selectedTournament.participants ?? []).map((participant) => (
                    <div className="participantRow" key={participant.id}>
                      <strong>{participant.projectPlayer.displayName}</strong>
                      <input
                        defaultValue={participant.seed ?? ""}
                        disabled={!canEditTournamentParticipants}
                        onBlur={(event) => updateTournamentParticipantSeed(participant.id, event.currentTarget.value)}
                        placeholder="种子"
                      />
                      <label className="checkLine">
                        <input
                          type="checkbox"
                          checked={participant.checkedIn ?? false}
                          disabled={!canEditTournamentParticipants}
                          onChange={(event) => updateTournamentParticipant(participant.id, { checkedIn: event.currentTarget.checked })}
                        />
                        签到
                      </label>
                      <select
                        value={participant.registrationStatus ?? "REGISTERED"}
                        disabled={!canEditTournamentParticipants}
                        onChange={(event) => updateTournamentParticipant(participant.id, { registrationStatus: event.currentTarget.value })}
                      >
                        <option value="REGISTERED">已报名</option>
                        <option value="CHECKED_IN">已签到</option>
                        <option value="WITHDRAWN">退赛</option>
                      </select>
                      <button onClick={() => removeTournamentParticipant(participant.id)} disabled={!canEditTournamentParticipants}>
                        移除
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        </div>

        <section className="panel">
          <div className="panelHeader">
            <h2>WCC 规则</h2>
            <button onClick={createWccRule} disabled={!selectedProjectId || !user || !wccRuleForm.name.trim()}>
              <Plus size={16} /> 保存
            </button>
          </div>
          <div className="formGrid">
            <input value={wccRuleForm.name} onChange={(event) => setWccRuleForm({ ...wccRuleForm, name: event.target.value })} placeholder="规则名称" />
            <input value={wccRuleForm.champion} onChange={(event) => setWccRuleForm({ ...wccRuleForm, champion: event.target.value })} placeholder="冠军" />
            <input value={wccRuleForm.finalist} onChange={(event) => setWccRuleForm({ ...wccRuleForm, finalist: event.target.value })} placeholder="亚军" />
            <input value={wccRuleForm.semifinal} onChange={(event) => setWccRuleForm({ ...wccRuleForm, semifinal: event.target.value })} placeholder="四强" />
            <input
              value={wccRuleForm.quarterfinal}
              onChange={(event) => setWccRuleForm({ ...wccRuleForm, quarterfinal: event.target.value })}
              placeholder="八强"
            />
            <select value={wccRuleForm.decayType} onChange={(event) => setWccRuleForm({ ...wccRuleForm, decayType: event.target.value })}>
              <option value="FIXED_EXPIRY">固定过期</option>
              <option value="LINEAR">线性削减</option>
              <option value="STEP">阶梯削减</option>
            </select>
            {wccRuleForm.decayType === "STEP" ? (
              <input value={wccRuleForm.steps} onChange={(event) => setWccRuleForm({ ...wccRuleForm, steps: event.target.value })} placeholder="0:1,365:0.5,730:0" />
            ) : wccRuleForm.decayType === "LINEAR" ? (
              <>
                <input value={wccRuleForm.fullDays} onChange={(event) => setWccRuleForm({ ...wccRuleForm, fullDays: event.target.value })} placeholder="满额天数" />
                <input value={wccRuleForm.validDays} onChange={(event) => setWccRuleForm({ ...wccRuleForm, validDays: event.target.value })} placeholder="归零天数" />
              </>
            ) : (
              <input value={wccRuleForm.validDays} onChange={(event) => setWccRuleForm({ ...wccRuleForm, validDays: event.target.value })} placeholder="有效天数" />
            )}
          </div>
          <div className="table">
            {wccRules.map((rule) => (
              <div className="ruleRow" key={rule.id}>
                <strong>{rule.name}</strong>
                <span>{rule.level}</span>
                <span>{rule.pointsTable.CHAMPION ?? 0}</span>
                <span>{formatWccDecay(rule)}</span>
                <span>{rule.active ? "启用" : "停用"}</span>
                <div className="actions">
                  <button onClick={() => startEditWccRule(rule)} disabled={!user}>编辑</button>
                  <button onClick={() => setWccRuleActive(rule, !rule.active)} disabled={!user}>
                    {rule.active ? "停用" : "启用"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        <div className="grid">
          <section className="panel">
            <div className="panelHeader">
              <h2>导入导出</h2>
              <div className="actions">
                <a className={user ? "buttonLink" : "buttonLink disabledLink"} href={selectedProjectId && user ? `/api/projects/${selectedProjectId}/export/players.csv` : "#"}>
                  选手 CSV
                </a>
                <a className={user ? "buttonLink" : "buttonLink disabledLink"} href={selectedProjectId && user ? `/api/projects/${selectedProjectId}/export/rankings.csv` : "#"}>
                  排名 CSV
                </a>
              </div>
            </div>
            <textarea value={importCsv} onChange={(event) => setImportCsv(event.target.value)} />
            <button onClick={importPlayers} disabled={!selectedProjectId || !user}>
              导入选手
            </button>
          </section>

          <section className="panel">
            <div className="panelHeader">
              <h2>备份</h2>
              <button onClick={createBackup} disabled={!user}>创建备份</button>
            </div>
            <div className="table">
              {backups.slice(0, 5).map((backup) => (
                <div className="backupRow" key={backup.id}>
                  <strong>{backup.fileName}</strong>
                  <span>{backup.sizeBytes ?? 0} B</span>
                  <a className={user ? "buttonLink" : "buttonLink disabledLink"} href={user ? `/api/backups/${backup.id}/download` : "#"}>
                    下载
                  </a>
                  <button onClick={() => restoreBackup(backup.id)} disabled={!user}>恢复</button>
                </div>
              ))}
            </div>
          </section>
        </div>

        <section className="panel">
          <div className="panelHeader">
            <h2>对阵与成绩</h2>
            <div className="actions">
              <span>{selectedTournament?.status ?? "未选择赛事"}</span>
              <a
                className={selectedTournamentId && user ? "buttonLink" : "buttonLink disabledLink"}
                href={selectedTournamentId && user ? `/api/tournaments/${selectedTournamentId}/export/matches.csv` : "#"}
              >
                对阵 CSV
              </a>
              <a
                className={selectedTournamentId && user ? "buttonLink" : "buttonLink disabledLink"}
                href={selectedTournamentId && user ? `/api/tournaments/${selectedTournamentId}/export/standings.csv` : "#"}
              >
                成绩 CSV
              </a>
            </div>
          </div>
          <div className="matches">
            {(selectedTournament?.matches ?? []).map((match) => (
              <div className="match" key={match.id}>
                <span>{match.round?.name ?? match.bracketNodeKey ?? "对局"}</span>
                <strong>{match.participantA?.projectPlayer.displayName ?? "待定"}</strong>
                <span>vs</span>
                <strong>{match.participantB?.projectPlayer.displayName ?? (match.isBye ? "轮空" : "待定")}</strong>
                <div className="scheduleControls">
                  <input
                    defaultValue={match.tableNumber ?? ""}
                    disabled={!canEditMatchSchedule(match, selectedTournament)}
                    onBlur={(event) => updateMatchTable(match, event.currentTarget.value)}
                    placeholder="台号"
                  />
                  <input
                    type="datetime-local"
                    defaultValue={formatDateTimeInput(match.startsAt)}
                    disabled={!canEditMatchSchedule(match, selectedTournament)}
                    onBlur={(event) => updateMatchStartsAt(match, event.currentTarget.value)}
                  />
                  <select
                    value={match.status}
                    disabled={!canEditMatchSchedule(match, selectedTournament)}
                    onChange={(event) => updateMatch(match, { status: event.currentTarget.value })}
                  >
                    <option value="SCHEDULED">待赛</option>
                    <option value="IN_PROGRESS">进行中</option>
                    <option value="CANCELLED">取消</option>
                  </select>
                </div>
                <span>{formatResult(match.resultType)} {formatScore(match)}</span>
                {match.participantA && match.participantB && match.status !== "COMPLETED" && match.status !== "CANCELLED" && (
                  <div className="resultControls">
                    <input
                      value={resultDraftFor(match).scoreA}
                      onChange={(event) => updateResultDraft(match, { scoreA: event.target.value })}
                    />
                    <input
                      value={resultDraftFor(match).scoreB}
                      onChange={(event) => updateResultDraft(match, { scoreB: event.target.value })}
                    />
                    <input
                      className="gameDraftInput"
                      value={resultDraftFor(match).games}
                      onChange={(event) => updateResultDraft(match, { games: event.target.value })}
                      placeholder="11-8,9-11"
                    />
                    <select
                      value={resultDraftFor(match).resultType}
                      onChange={(event) => updateResultDraft(match, { resultType: event.target.value as MatchResultType })}
                    >
                      <option value="A_WIN">A 胜</option>
                      <option value="B_WIN">B 胜</option>
                      <option value="DRAW">平局</option>
                      <option value="A_WALKOVER">A 弃权</option>
                      <option value="B_WALKOVER">B 弃权</option>
                      <option value="DOUBLE_WALKOVER">双弃权</option>
                      <option value="CANCELLED">取消</option>
                    </select>
                    <button onClick={() => recordResult(match)} disabled={!user}>录入</button>
                  </div>
                )}
                {match.participantA && match.participantB && match.status === "COMPLETED" && selectedTournament?.status !== "COMPLETED" && (
                  <div className="actions">
                    <span>{formatGames(match)}</span>
                    <button onClick={() => reopenMatchResult(match)} disabled={!user}>撤销</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        {bracketView && (
          <section className="panel">
            <div className="panelHeader">
              <h2>淘汰签表</h2>
              <span>{bracketView.rounds.length} 轮</span>
            </div>
            <div className="bracketWrap">
              <div className="bracketGrid">
                {bracketView.rounds.map((round) => (
                  <div className="bracketRound" key={`${round.stageId ?? "stage"}-${round.roundNumber}`}>
                    <div className="bracketRoundHeader">
                      <strong>{round.roundName}</strong>
                      {round.stageName && <span>{round.stageName}</span>}
                    </div>
                    {round.matches.map((match) => (
                      <div className="bracketMatch" key={match.id}>
                        <span className="bracketNode">{match.bracketNodeKey}</span>
                        <div className={bracketSideClass(match.participantA?.id, match.winnerParticipantId)}>
                          <strong>{formatBracketParticipant(match.participantA)}</strong>
                          <span>{match.scoreA ?? "-"}</span>
                        </div>
                        <div className={bracketSideClass(match.participantB?.id, match.winnerParticipantId)}>
                          <strong>{match.participantB ? formatBracketParticipant(match.participantB) : match.isBye ? "轮空" : "待定"}</strong>
                          <span>{match.scoreB ?? "-"}</span>
                        </div>
                        <span className="bracketStatus">{formatResult(match.resultType ?? undefined)} {match.winnerDisplayName ? `胜者 ${match.winnerDisplayName}` : ""}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        <section className="panel">
          <div className="panelHeader">
            <h2>成绩表</h2>
            <span>{standings.length} 人</span>
          </div>
          <div className="table">
            {standings.map((row) => (
              <div className="standingRow" key={row.participantId}>
                <span>{row.rank}</span>
                <strong>{row.displayName}</strong>
                <span>{row.points} 分</span>
                <span>{row.wins}-{row.draws}-{row.losses}</span>
                <span>BH {row.buchholz}</span>
              </div>
            ))}
          </div>
        </section>

        {crosstable && (
          <section className="panel">
            <div className="panelHeader">
              <h2>循环交叉表</h2>
              <span>{crosstable.rows.length} 人</span>
            </div>
            <div className="crosstableWrap">
              <div className="crosstable" style={{ gridTemplateColumns: `minmax(110px, 1.2fr) repeat(${crosstable.columns.length}, minmax(74px, 1fr))` }}>
                <strong className="crosstableCorner">选手</strong>
                {crosstable.columns.map((column) => (
                  <strong className="crosstableHeader" key={column.participantId} title={column.displayName}>
                    {column.displayName}
                  </strong>
                ))}
                {crosstable.rows.map((row) => (
                  <Fragment key={row.participantId}>
                    <strong className="crosstableName" key={`${row.participantId}-name`} title={row.displayName}>
                      {row.displayName}
                    </strong>
                    {row.cells.map((cell) => (
                      <span
                        className={`crosstableCell result-${cell.result.toLowerCase()}`}
                        key={`${row.participantId}-${cell.opponentParticipantId}`}
                        title={cell.roundName ?? undefined}
                      >
                        {cell.label || "-"}
                      </span>
                    ))}
                  </Fragment>
                ))}
              </div>
            </div>
          </section>
        )}

        <div className="grid">
          <section className="panel">
            <div className="panelHeader">
              <h2>综合排名</h2>
              <span>{combinedRankings.length} 人</span>
            </div>
            <div className="table">
              {combinedRankings.slice(0, 10).map((player) => (
                <div className="rankingRow" key={player.id}>
                  <span>{player.rank}</span>
                  <strong>{player.displayName}</strong>
                  <span>{player.combinedScore ?? "-"}</span>
                  <span>E{player.eloRank ?? "-"} W{player.wccRank ?? "-"}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="panel">
            <div className="panelHeader">
              <h2>Elo 排名</h2>
              <span>{eloRankings.length} 人</span>
            </div>
            <div className="table">
              {eloRankings.slice(0, 10).map((player) => (
                <div className="rankingRow" key={player.id}>
                  <span>{player.rank}</span>
                  <strong>{player.displayName}</strong>
                  <span>{player.currentElo}</span>
                  <span>{player.matchesPlayed} 场</span>
                </div>
              ))}
            </div>
          </section>

          <section className="panel">
            <div className="panelHeader">
              <h2>WCC 排名</h2>
              <span>{wccRankings.length} 人</span>
            </div>
            <div className="table">
              {wccRankings.slice(0, 10).map((player) => (
                <div className="rankingRow" key={player.id}>
                  <span>{player.rank}</span>
                  <strong>{player.displayName}</strong>
                  <span>{player.effectiveWcc ?? player.currentWcc}</span>
                  <span>{player.currentWcc} 原始</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}

function positiveIntOrDefault(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function optionalText(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed || undefined;
}

function nullableText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed || null;
}

function formatDateInput(value?: string): string {
  if (!value) return "";
  return value.slice(0, 10);
}

function optionalDateTime(value: string): string | undefined {
  return value ? new Date(value).toISOString() : undefined;
}

function nullableDateTime(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}

function formatDateTimeInput(value?: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function signedNumber(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function outcomeLabel(outcome: PlayerMatchHistoryItem["outcome"]): string {
  if (outcome === "WIN") return "胜";
  if (outcome === "LOSS") return "负";
  if (outcome === "DRAW") return "平";
  if (outcome === "CANCELLED") return "取消";
  if (outcome === "DOUBLE_WALKOVER") return "双弃权";
  return "未知";
}

function parseWccSteps(value: string): Array<{ fromDay: number; multiplier: number }> {
  const steps = value
    .split(",")
    .map((part) => {
      const [fromDayText, multiplierText] = part.split(":").map((item) => item.trim());
      const fromDay = Number.parseInt(fromDayText ?? "", 10);
      const multiplier = Number.parseFloat(multiplierText ?? "");
      if (!Number.isFinite(fromDay) || fromDay < 0 || !Number.isFinite(multiplier)) return null;
      return { fromDay, multiplier: Math.min(1, Math.max(0, multiplier)) };
    })
    .filter((step): step is { fromDay: number; multiplier: number } => Boolean(step))
    .sort((a, b) => a.fromDay - b.fromDay);

  return steps.length > 0 ? steps : [{ fromDay: 0, multiplier: 1 }];
}

function formatWccSteps(steps?: Array<{ fromDay: number; multiplier: number }>): string {
  if (!steps || steps.length === 0) return "0:1,365:0";
  return [...steps]
    .sort((a, b) => a.fromDay - b.fromDay)
    .map((step) => `${step.fromDay}:${step.multiplier}`)
    .join(",");
}

function formatWccDecay(rule: WccRuleSet): string {
  if (rule.decayType === "STEP") return `阶梯 ${formatWccSteps(rule.decayConfig?.steps)}`;
  if (rule.decayType === "LINEAR") return `线性 ${rule.decayConfig?.fullDays ?? 0}-${rule.decayConfig?.validDays ?? 365} 天`;
  return `${rule.decayConfig?.validDays ?? 365} 天`;
}

function defaultScoreForResult(resultType: MatchResultType): [number, number] {
  if (resultType === "B_WIN" || resultType === "A_WALKOVER") return [0, 1];
  if (resultType === "DRAW") return [0.5, 0.5];
  if (resultType === "DOUBLE_WALKOVER" || resultType === "CANCELLED") return [0, 0];
  return [1, 0];
}

function formatResult(resultType?: Match["resultType"]): string {
  if (!resultType) return "";
  if (resultType === "A_WIN") return "A 胜";
  if (resultType === "B_WIN") return "B 胜";
  if (resultType === "DRAW") return "平局";
  if (resultType === "A_WALKOVER") return "A 弃权";
  if (resultType === "B_WALKOVER") return "B 弃权";
  if (resultType === "DOUBLE_WALKOVER") return "双弃权";
  if (resultType === "CANCELLED") return "取消";
  if (resultType === "BYE") return "轮空";
  return resultType;
}

function formatScore(match: Match): string {
  if (match.scoreA == null || match.scoreB == null) return "";
  return `${match.scoreA}:${match.scoreB}`;
}

function formatGameDraft(match: Match): string {
  return (match.games ?? []).map((game) => `${game.scoreA ?? ""}-${game.scoreB ?? ""}`).join(",");
}

function formatGames(match: Match): string {
  const text = formatGameDraft(match);
  return text ? `分局 ${text}` : "";
}

function formatBracketParticipant(participant?: BracketParticipant | null): string {
  if (!participant) return "待定";
  return participant.seed ? `${participant.seed}. ${participant.displayName}` : participant.displayName;
}

function bracketSideClass(participantId?: string | null, winnerParticipantId?: string | null): string {
  return participantId && participantId === winnerParticipantId ? "bracketSide winner" : "bracketSide";
}

function parseGameDraft(value: string): Array<{ gameNumber: number; scoreA: number | null; scoreB: number | null }> {
  return value
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item, index) => {
      const [scoreAText, scoreBText] = item.split(/[-:]/).map((part) => part.trim());
      const scoreA = Number.parseInt(scoreAText ?? "", 10);
      const scoreB = Number.parseInt(scoreBText ?? "", 10);
      return {
        gameNumber: index + 1,
        scoreA: Number.isFinite(scoreA) ? scoreA : null,
        scoreB: Number.isFinite(scoreB) ? scoreB : null
      };
    });
}

function canCompleteTournament(tournament: Tournament): boolean {
  const matches = tournament.matches ?? [];
  if (matches.length === 0 || tournament.status === "COMPLETED" || tournament.status === "CANCELLED") return false;
  return matches.every((match) => match.isBye || (match.status === "COMPLETED" && match.participantA && match.participantB));
}

function canEditMatchSchedule(match: Match, tournament: Tournament | null): boolean {
  if (!tournament) return false;
  return !match.isBye && match.status !== "COMPLETED" && tournament.status !== "COMPLETED" && tournament.status !== "CANCELLED";
}

function formatLabel(format: TournamentFormat) {
  if (format === "SINGLE_ELIMINATION") return "淘汰赛";
  if (format === "ROUND_ROBIN") return "循环赛";
  if (format === "CUP") return "杯赛";
  return "瑞士轮";
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="metric">
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
