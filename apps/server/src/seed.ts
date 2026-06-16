import { prisma } from "./db.js";

const project = await prisma.project.upsert({
  where: { slug: "demo-chess" },
  update: {},
  create: {
    name: "演示棋类项目",
    slug: "demo-chess",
    description: "用于本机开发测试的默认项目",
    defaultElo: 1200,
    wccRuleSets: {
      create: {
        name: "默认 WCC 100",
        level: "WCC_100",
        pointsTable: {
          CHAMPION: 100,
          FINALIST: 65,
          SEMIFINAL: 40,
          QUARTERFINAL: 20,
          PARTICIPATION: 2
        },
        decayType: "FIXED_EXPIRY",
        decayConfig: { validDays: 365 }
      }
    }
  }
});

for (let index = 1; index <= 8; index += 1) {
  const existing = await prisma.projectPlayer.findUnique({
    where: { projectId_code: { projectId: project.id, code: `P${index}` } }
  });
  if (existing) continue;

  const player = await prisma.player.create({
    data: {
      name: `选手 ${index}`,
      nickname: `P${index}`
    }
  });
  await prisma.projectPlayer.upsert({
    where: { projectId_playerId: { projectId: project.id, playerId: player.id } },
    update: {},
    create: {
      projectId: project.id,
      playerId: player.id,
      displayName: `选手 ${index}`,
      code: `P${index}`,
      seedRank: index,
      currentElo: 1200 + (8 - index) * 20
    }
  });
}

await prisma.$disconnect();
console.log("Seed data created");
