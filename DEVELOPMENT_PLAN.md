# 比赛管理软件开发文档

## 1. 项目目标

本项目目标是从零开发一套可在个人电脑上运行的比赛管理软件，用于管理多个独立比赛项目下的选手、赛事、赛制编排、成绩记录、排名积分和历史数据。

软件需要满足以下核心目标：

- 管理比赛选手，记录选手基础信息、项目归属、参赛历史和积分变化。
- 支持多种赛制，包括淘汰赛、杯赛、小组赛、循环赛、瑞士轮，以及这些赛制的组合。
- 自动完成抽签、种子排序、轮次编排、对阵生成、成绩录入、晋级判定和成绩表展示。
- 建立双积分系统：
  - Elo 分：参考国际象棋 Elo 体系，根据对局双方分差与实际胜负动态调整。
  - WCC 分：参考网球巡回赛积分体系，根据赛事等级、名次和时间衰减计算。
- 支持不同比赛项目，不同项目之间完全独立，选手、赛事、积分、排名互不干涉。
- 当前没有公网服务器，初期必须支持在用户自己的电脑上运行并充当服务器，局域网内设备可以访问。

## 2. 使用场景

### 2.1 单机管理

用户在自己的电脑上启动软件，通过浏览器访问本机地址，例如：

```text
http://localhost:3000
```

适用于个人维护选手、录入比赛、查看积分和测试赛制。

### 2.2 局域网比赛现场

用户电脑作为临时服务器，连接同一个 Wi-Fi 或有线局域网的其他设备可以访问：

```text
http://<用户电脑局域网 IP>:3000
```

适用于比赛现场多人查看赛程、成绩表、选手信息。初期建议只有管理员账号可编辑数据，其他设备只读访问。

### 2.3 离线可用

由于比赛现场网络环境可能不稳定，软件应尽量做到：

- 核心功能不依赖公网。
- 数据存储在本机数据库文件中。
- 前端静态资源由本机服务提供。
- 后续可考虑局域网 PWA 缓存，但第一阶段不强制。

## 3. 推荐技术栈

### 3.1 总体架构

推荐采用本机全栈 Web 应用：

- 前端：React + TypeScript + Vite
- 后端：Node.js + TypeScript + Fastify
- 数据库：SQLite
- ORM：Prisma
- 桌面运行方式：
  - 第一阶段：浏览器访问本机 Web 服务。
  - 后续阶段：可封装为 Tauri 桌面应用。

推荐原因：

- SQLite 不需要单独安装数据库服务，适合个人电脑作为服务器。
- Node.js 生态适合快速开发 Web 应用和复杂业务逻辑。
- TypeScript 有利于维护复杂赛制、积分和数据模型。
- React 适合构建交互复杂的后台管理界面。
- Fastify 性能好、结构清晰、插件生态成熟。
- Prisma 能够提升数据模型可读性，并方便数据库迁移。

### 3.2 前端技术栈

- React：构建页面和组件。
- TypeScript：统一类型定义。
- Vite：开发服务器和构建工具。
- React Router：页面路由。
- TanStack Query：接口请求、缓存、失效刷新。
- Zustand：轻量状态管理，用于当前项目、用户偏好、页面临时状态。
- React Hook Form + Zod：表单处理与校验。
- Tailwind CSS：快速构建一致 UI。
- shadcn/ui 或 Radix UI：对话框、菜单、表格、选择器等基础组件。
- lucide-react：图标。
- Recharts 或 ECharts：积分变化、排名趋势、赛事数据图表。
- dnd-kit：拖拽调整种子、分组、对阵位置。

### 3.3 后端技术栈

- Node.js：运行环境。
- TypeScript：业务逻辑类型安全。
- Fastify：HTTP API 服务。
- Zod：请求参数和响应结构校验。
- Prisma：ORM 和数据库迁移。
- SQLite：本机数据库。
- better-sqlite3：SQLite 驱动。
- pino：结构化日志。
- vitest：单元测试和业务规则测试。
- supertest 或 Fastify inject：API 测试。

### 3.4 数据库技术栈

- SQLite 数据文件：

```text
data/competition-manager.sqlite
```

- 数据库迁移：

```text
prisma/migrations
```

- 本机备份：

```text
backups/competition-manager-YYYY-MM-DD-HH-mm.sqlite
```

### 3.5 后续可选技术

- Tauri：将 Web 应用封装为桌面软件。
- Electron：也可封装桌面端，但资源占用更高。
- WebSocket 或 Server-Sent Events：实时刷新现场成绩。
- Playwright：端到端测试。
- Docker：后续如果迁移到服务器，可以容器化部署。

## 4. 本机服务器方案

### 4.1 开发运行

开发阶段建议前后端分离启动：

```bash
npm run dev
```

内部可并行启动：

```text
Frontend: http://localhost:5173
Backend:  http://localhost:3001
```

前端通过代理访问后端 API。

### 4.2 生产运行

生产阶段构建前端静态文件，由后端统一提供：

```text
http://localhost:3000
```

推荐脚本：

```bash
npm run build
npm run start
```

后端监听地址建议支持配置：

```env
HOST=0.0.0.0
PORT=3000
DATABASE_URL=file:./data/competition-manager.sqlite
```

当 `HOST=0.0.0.0` 时，局域网其他设备可以通过用户电脑 IP 访问。

### 4.3 macOS 局域网访问注意事项

用户电脑需要：

- 与访问设备在同一局域网。
- 允许防火墙放行 Node.js 或打包后的应用。
- 使用系统网络设置查看本机局域网 IP。
- 比赛现场建议关闭电脑睡眠，避免服务中断。

### 4.4 数据安全

初期所有数据存储在本机 SQLite 文件中，因此必须提供：

- 手动备份功能。
- 启动时自动每日备份。
- 导出数据库文件功能。
- 导出 CSV/Excel 功能。
- 数据导入前自动创建备份。

## 5. 权限与用户角色

第一阶段可以只实现一个本机管理员模式，但数据模型应预留多用户能力。

### 5.1 角色

- 管理员：
  - 管理项目、选手、赛事、积分规则。
  - 创建比赛、抽签、编排、录入结果。
  - 修正成绩和重新计算积分。
- 记分员：
  - 录入比赛结果。
  - 查看赛事和选手。
  - 不可修改积分规则和删除核心数据。
- 观众：
  - 只读查看赛程、对阵、成绩表、排名。

### 5.2 初期登录方案

本机部署初期可采用简单方案：

- 首次启动创建管理员密码。
- Session Cookie 登录。
- 局域网只读页面可选免登录。
- 管理操作必须登录。

## 6. 核心概念

### 6.1 比赛项目

项目是最高隔离单位，例如：

- 国际象棋
- 围棋
- 羽毛球单打
- 乒乓球双打
- 电子游戏项目 A

每个项目拥有独立的：

- 选手列表
- 赛事列表
- Elo 分
- WCC 分
- 排名
- 积分规则
- 赛制模板

同一个现实人物可以同时参加多个项目，但在数据上应通过不同项目下的参赛身份隔离。

### 6.2 选手

选手信息包括：

- 姓名
- 昵称
- 性别
- 出生日期
- 国籍或地区
- 所属队伍或俱乐部
- 联系方式
- 头像
- 备注
- 活跃状态
- 注册时间

在每个项目下还需要记录：

- 项目内显示名
- 项目内编号
- 当前 Elo
- 当前 WCC
- 项目内排名
- 参赛次数
- 胜平负统计
- 近期状态

### 6.3 赛事

赛事是一次具体比赛，例如：

- 2026 春季杯
- 第 3 期积分赛
- 城市公开赛

赛事信息包括：

- 所属项目
- 赛事名称
- 赛事等级
- 赛制类型
- 开始日期
- 结束日期
- 报名截止时间
- 地点
- 主办方
- 状态
- 参赛选手
- 种子规则
- 积分规则
- 是否计入 Elo
- 是否计入 WCC

赛事状态建议：

- 草稿
- 报名中
- 已锁定报名
- 编排中
- 进行中
- 已完成
- 已归档
- 已取消

### 6.4 对局

对局是两名或多名选手之间的一场具体比赛。

基础字段：

- 所属赛事
- 所属阶段
- 所属轮次
- 台号或场地
- 参赛方 A
- 参赛方 B
- 开始时间
- 状态
- 比分
- 胜者
- 结果类型
- 是否弃权
- 是否轮空
- 是否已计入积分

结果类型：

- A 胜
- B 胜
- 平局
- 双方弃权
- A 弃权
- B 弃权
- 取消
- 轮空

## 7. 赛制需求

### 7.1 通用赛制能力

所有赛制都应支持：

- 参赛名单锁定。
- 自动抽签。
- 手动调整签位。
- 种子选手保护。
- 同队回避。
- 同地区回避。
- 轮空处理。
- 轮次生成。
- 对阵表展示。
- 成绩录入。
- 晋级或排名自动计算。
- 异常结果处理。
- 赛后积分结算。

### 7.2 单淘汰赛

适用场景：杯赛、决赛阶段。

功能要求：

- 根据人数生成最接近的 2 的幂签表。
- 自动分配轮空。
- 支持种子蛇形分布或固定签位分布。
- 胜者自动进入下一轮。
- 支持三四名决赛。
- 支持决赛、半决赛、四分之一决赛等轮次名称。
- 支持手动改判后重新传播晋级关系。

需要处理：

- 8 人、16 人、32 人、64 人签表。
- 非标准人数，例如 10 人、13 人、27 人。
- 轮空选手直接晋级。
- 弃权时对手晋级。

### 7.3 双淘汰赛

适用场景：电竞、桌游、竞技项目。

功能要求：

- 胜者组和败者组。
- 选手首次失败进入败者组。
- 第二次失败淘汰。
- 胜者组冠军与败者组冠军进入总决赛。
- 可选是否需要重置决赛。
- 自动生成败者组落位。

复杂度较高，建议第二阶段实现。

### 7.4 杯赛

杯赛通常是组合赛制：

- 小组赛 + 淘汰赛
- 循环赛 + 淘汰赛
- 瑞士轮 + 淘汰赛

功能要求：

- 一个赛事包含多个阶段。
- 每个阶段有独立赛制。
- 阶段之间可以配置晋级规则。
- 支持小组前 N 名晋级。
- 支持成绩最好的若干名第三名晋级。
- 支持重新抽签或按排名交叉对阵。

示例：

```text
32 人杯赛
阶段 1：8 个小组，每组 4 人单循环
阶段 2：每组前 2 名晋级 16 强淘汰赛
```

### 7.5 单循环赛

适用场景：联赛、小组赛。

功能要求：

- 每名选手与其他选手比赛一次。
- 自动生成轮次。
- 奇数人数自动加入轮空。
- 支持 Berger 编排法。
- 支持主客场或先后手分配。
- 支持按轮次录入成绩。
- 自动生成积分榜。

排名规则应可配置：

- 胜场数
- 积分
- 小分
- 对手分
- 相互战绩
- 净胜局
- 总得分
- 抽签顺序

### 7.6 双循环赛

适用场景：联赛。

功能要求：

- 每对选手比赛两次。
- 第二循环交换主客场或先后手。
- 排名规则同单循环。

### 7.7 瑞士轮

适用场景：人数较多、轮次有限的积分赛。

功能要求：

- 根据轮数配置生成比赛。
- 第一轮可随机、按种子高低配对、上下半区配对。
- 后续轮次按当前积分接近原则配对。
- 尽量避免重复对阵。
- 尽量平衡先后手或主客场。
- 支持同队、同地区回避规则。
- 奇数人数自动轮空。
- 轮空得分可配置。
- 轮空次数限制。
- 支持加速瑞士轮或简化瑞士轮扩展。

瑞士轮排序指标建议：

- 总积分
- Buchholz 对手分
- Sonneborn-Berger 分
- 胜场数
- 累进分
- 直接交锋
- 种子顺序

第一阶段可以实现标准简化瑞士轮：

- 按积分组配对。
- 同分组选手随机或按种子配对。
- 无法配对时向相邻分组浮动。
- 禁止重复对阵。
- 轮空优先给积分最低且未轮空的选手。

### 7.8 积分赛

积分赛不是一种独立赛制，而是赛事目标：

- 可基于单循环、瑞士轮或淘汰赛。
- 赛事完成后产生 Elo 和 WCC 分变化。
- 可加入赛季总排名。

## 8. 成绩和排名规则

### 8.1 对局计分

不同项目需要允许配置对局积分：

- 胜：1 分
- 平：0.5 分
- 负：0 分

或：

- 胜：3 分
- 平：1 分
- 负：0 分

也可以支持项目自定义：

- 大比分
- 小比分
- 局分
- 净胜分
- 回合数

### 8.2 成绩表

需要支持的成绩表：

- 赛事总成绩表。
- 小组积分榜。
- 瑞士轮积分榜。
- 循环赛交叉表。
- 淘汰赛签表。
- 选手历史成绩表。
- 项目总排名表。
- Elo 变化表。
- WCC 积分构成表。

### 8.3 排名判定

排名判定需要可配置优先级。

常见规则：

- 比赛积分高者排名靠前。
- 胜场多者排名靠前。
- 相互战绩优先。
- 小分高者排名靠前。
- 对手分高者排名靠前。
- 净胜局高者排名靠前。
- 总得分高者排名靠前。
- 种子顺序高者排名靠前。
- 抽签决定。

系统应保存每次排名计算时使用的规则，避免未来规则变化影响历史赛事解释。

## 9. Elo 积分系统

### 9.1 基础公式

Elo 期望分：

```text
ExpectedA = 1 / (1 + 10 ^ ((RatingB - RatingA) / 400))
ExpectedB = 1 / (1 + 10 ^ ((RatingA - RatingB) / 400))
```

赛后更新：

```text
NewRatingA = RatingA + K * (ScoreA - ExpectedA)
NewRatingB = RatingB + K * (ScoreB - ExpectedB)
```

Score：

- 胜：1
- 平：0.5
- 负：0

### 9.2 K 值规则

需要支持项目级配置。

建议默认规则：

- 新选手前 30 局：K = 40
- 普通选手：K = 20
- 高分选手，例如 Elo >= 2400：K = 10

也可以按赛事等级配置：

- 训练赛：K = 10
- 普通积分赛：K = 20
- 重要赛事：K = 30

最终实际 K 值可以由项目规则决定：

```text
effectiveK = min(playerK, tournamentK)
```

或：

```text
effectiveK = tournamentK
```

具体方案需在项目设置中可选。

### 9.3 多局制处理

如果一场对阵包含多局，例如五局三胜，应支持两种 Elo 计算方式：

- 按整场胜负计算一次。
- 按每一局分别计算。

建议默认按整场计算，避免积分波动过大。

### 9.4 弃权处理

弃权是否计入 Elo 需要可配置。

建议默认：

- 已经开赛后弃权：计入 Elo。
- 未开赛退赛：不计入 Elo。
- 管理员可手动覆盖。

### 9.5 Elo 历史

系统必须保存每次 Elo 变化：

- 选手
- 项目
- 赛事
- 对局
- 变化前分数
- 变化后分数
- 变化值
- 对手
- K 值
- 期望分
- 实际得分
- 计算时间

这样可以：

- 展示积分曲线。
- 重新审计积分。
- 撤销或重算比赛。

### 9.6 Elo 重算

需要提供积分重算能力：

- 按项目从某日期开始重算。
- 按某个赛事之后重算。
- 重算前自动备份。
- 重算日志可查看。

## 10. WCC 积分系统

WCC 分是类似网球比赛的排名积分体系。它不直接根据对手强弱变化，而是根据赛事等级、最终排名和时间衰减决定。

### 10.1 赛事等级

建议默认等级：

- WCC 1000
- WCC 500
- WCC 250
- WCC 100
- WCC 50
- 自定义

每个项目可以配置自己的等级和分值表。

### 10.2 名次得分表

示例 WCC 1000：

| 成绩 | 分数 |
| --- | ---: |
| 冠军 | 1000 |
| 亚军 | 650 |
| 四强 | 400 |
| 八强 | 200 |
| 十六强 | 100 |
| 三十二强 | 50 |
| 参赛 | 10 |

示例 WCC 500：

| 成绩 | 分数 |
| --- | ---: |
| 冠军 | 500 |
| 亚军 | 325 |
| 四强 | 200 |
| 八强 | 100 |
| 十六强 | 50 |
| 参赛 | 5 |

系统应允许管理员编辑每个项目的积分表。

### 10.3 循环赛和瑞士轮名次

对于非淘汰赛，应根据最终排名映射 WCC 分。

示例：

| 最终排名 | 成绩档位 |
| --- | --- |
| 第 1 名 | 冠军 |
| 第 2 名 | 亚军 |
| 第 3-4 名 | 四强 |
| 第 5-8 名 | 八强 |
| 第 9-16 名 | 十六强 |

映射规则必须随赛事保存。

### 10.4 时间衰减

WCC 分需要定期取消或削减较旧赛事分数。建议支持三种模式：

#### 固定有效期模式

赛事积分在一段时间内 100% 有效，到期后直接失效。

示例：

```text
赛事结束后 365 天内有效
超过 365 天计为 0
```

#### 线性衰减模式

赛事积分随时间逐渐减少。

示例：

```text
0-180 天：100%
181-365 天：线性下降到 0
超过 365 天：0
```

#### 阶梯衰减模式

示例：

```text
0-180 天：100%
181-270 天：75%
271-365 天：50%
超过 365 天：0
```

建议第一阶段实现固定有效期和阶梯衰减。

### 10.5 最佳成绩限制

网球积分通常只统计一定数量的最佳赛事。系统应支持：

- 统计全部有效赛事。
- 只统计最近 N 场。
- 只统计有效期内最高 N 场。
- 强制计入指定等级赛事。

第一阶段可默认统计有效期内全部赛事，后续再增加最佳 N 场规则。

### 10.6 WCC 历史

系统需要保存：

- 选手
- 项目
- 赛事
- 名次
- 原始获得分
- 衰减后当前分
- 有效开始日期
- 有效结束日期
- 衰减规则
- 是否当前有效

WCC 当前总分可以定期计算，也可以查询时动态计算。考虑 SQLite 和数据规模，建议：

- 原始积分事件入库。
- 查询排名时根据日期动态计算衰减。
- 大量数据时再做缓存表。

## 11. 数据模型设计

### 11.1 主要实体

建议数据库实体：

- User
- Project
- Player
- ProjectPlayer
- Team
- Tournament
- TournamentParticipant
- TournamentStage
- TournamentGroup
- Round
- Match
- MatchParticipant
- MatchGame
- Standing
- RankingRule
- EloRating
- EloRatingHistory
- WccRuleSet
- WccPointEvent
- DrawSeed
- AuditLog
- AppSetting
- BackupRecord

### 11.2 Project

字段建议：

- id
- name
- slug
- description
- defaultElo
- eloEnabled
- wccEnabled
- scoringConfig
- rankingConfig
- createdAt
- updatedAt

### 11.3 Player

全局自然人或参赛实体：

- id
- name
- nickname
- gender
- birthDate
- country
- region
- club
- contact
- avatarUrl
- note
- active
- createdAt
- updatedAt

### 11.4 ProjectPlayer

项目内选手身份：

- id
- projectId
- playerId
- displayName
- code
- seedRank
- currentElo
- currentWcc
- matchesPlayed
- wins
- draws
- losses
- active
- joinedAt
- updatedAt

唯一约束：

- projectId + playerId
- projectId + code

### 11.5 Tournament

- id
- projectId
- name
- level
- format
- status
- startDate
- endDate
- registrationDeadline
- location
- organizer
- description
- eloEnabled
- wccEnabled
- wccRuleSetId
- rankingRuleSnapshot
- drawConfig
- createdAt
- updatedAt

### 11.6 TournamentParticipant

- id
- tournamentId
- projectPlayerId
- seed
- registrationStatus
- checkedIn
- finalRank
- finalStandingData
- wccPointsAwarded
- createdAt
- updatedAt

### 11.7 TournamentStage

- id
- tournamentId
- name
- order
- format
- status
- config
- rankingRuleSnapshot
- qualifyRule
- createdAt
- updatedAt

配置示例：

```json
{
  "format": "round_robin",
  "groups": 4,
  "playersPerGroup": 4,
  "qualifyTopN": 2
}
```

### 11.8 Round

- id
- stageId
- name
- roundNumber
- status
- scheduledAt
- createdAt
- updatedAt

### 11.9 Match

- id
- tournamentId
- stageId
- roundId
- groupId
- bracketNodeKey
- tableNumber
- status
- participantAId
- participantBId
- scoreA
- scoreB
- winnerParticipantId
- resultType
- isBye
- isWalkover
- startsAt
- finishedAt
- eloProcessedAt
- createdAt
- updatedAt

### 11.10 MatchGame

用于多局制：

- id
- matchId
- gameNumber
- scoreA
- scoreB
- winnerSide
- detail
- createdAt
- updatedAt

### 11.11 EloRatingHistory

- id
- projectId
- tournamentId
- matchId
- projectPlayerId
- opponentProjectPlayerId
- ratingBefore
- ratingAfter
- delta
- kFactor
- expectedScore
- actualScore
- reason
- createdAt

### 11.12 WccRuleSet

- id
- projectId
- name
- level
- pointsTable
- decayType
- decayConfig
- bestOfConfig
- active
- createdAt
- updatedAt

### 11.13 WccPointEvent

- id
- projectId
- tournamentId
- projectPlayerId
- ruleSetId
- finalRank
- achievement
- rawPoints
- effectiveFrom
- expiresAt
- decaySnapshot
- createdAt

### 11.14 AuditLog

所有关键操作都应记录：

- id
- actorUserId
- action
- entityType
- entityId
- beforeData
- afterData
- createdAt

用于追踪：

- 修改比赛结果
- 删除选手
- 重算积分
- 修改规则
- 导入数据

## 12. 后端 API 设计

API 前缀：

```text
/api
```

### 12.1 项目 API

- `GET /api/projects`：项目列表。
- `POST /api/projects`：创建项目。
- `GET /api/projects/:id`：项目详情。
- `PATCH /api/projects/:id`：更新项目。
- `DELETE /api/projects/:id`：归档或删除项目。
- `GET /api/projects/:id/summary`：项目概览。

### 12.2 选手 API

- `GET /api/projects/:projectId/players`：项目选手列表。
- `POST /api/projects/:projectId/players`：添加选手到项目。
- `GET /api/project-players/:id`：项目选手详情。
- `PATCH /api/project-players/:id`：更新项目选手信息。
- `DELETE /api/project-players/:id`：停用项目选手。
- `GET /api/project-players/:id/history`：选手参赛历史。
- `GET /api/project-players/:id/rating-history`：积分历史。

### 12.3 赛事 API

- `GET /api/projects/:projectId/tournaments`：赛事列表。
- `POST /api/projects/:projectId/tournaments`：创建赛事。
- `GET /api/tournaments/:id`：赛事详情。
- `PATCH /api/tournaments/:id`：更新赛事。
- `POST /api/tournaments/:id/participants`：添加参赛选手。
- `DELETE /api/tournaments/:id/participants/:participantId`：移除参赛选手。
- `POST /api/tournaments/:id/lock-registration`：锁定报名。
- `POST /api/tournaments/:id/start`：开始赛事。
- `POST /api/tournaments/:id/complete`：完成赛事并结算积分。
- `POST /api/tournaments/:id/archive`：归档赛事。

### 12.4 抽签和编排 API

- `POST /api/tournaments/:id/draw`：自动抽签。
- `PATCH /api/tournaments/:id/draw`：手动调整签位。
- `POST /api/stages/:stageId/generate-rounds`：生成轮次。
- `POST /api/stages/:stageId/generate-next-round`：生成下一轮。
- `GET /api/stages/:stageId/bracket`：淘汰赛签表。
- `GET /api/stages/:stageId/standings`：阶段成绩表。

### 12.5 对局 API

- `GET /api/tournaments/:id/matches`：赛事对局列表。
- `GET /api/rounds/:roundId/matches`：轮次对局列表。
- `PATCH /api/matches/:id/result`：录入或修改结果。
- `PATCH /api/matches/:id/schedule`：调整时间或台号。
- `POST /api/matches/:id/reopen`：重新打开对局结果。
- `GET /api/matches/:id/audit`：对局修改记录。

### 12.6 排名和积分 API

- `GET /api/projects/:projectId/rankings/elo`：Elo 排名。
- `GET /api/projects/:projectId/rankings/wcc`：WCC 排名。
- `GET /api/projects/:projectId/rankings/combined`：综合排名。
- `POST /api/projects/:projectId/ratings/recalculate`：重算积分。
- `GET /api/tournaments/:id/rating-impact`：赛事积分影响。
- `GET /api/tournaments/:id/wcc-awards`：赛事 WCC 分配。

### 12.7 导入导出 API

- `POST /api/import/players`：导入选手。
- `GET /api/export/players.csv`：导出选手。
- `GET /api/export/rankings.csv`：导出排名。
- `GET /api/export/tournament/:id.xlsx`：导出赛事表。
- `POST /api/backups`：创建备份。
- `GET /api/backups`：备份列表。
- `POST /api/backups/:id/restore`：恢复备份。

## 13. 前端页面设计

### 13.1 全局布局

建议使用后台管理式布局：

- 左侧导航栏。
- 顶部项目切换器。
- 主内容区域。
- 右上角用户菜单。

全局导航：

- 项目概览
- 选手
- 赛事
- 编排
- 排名
- 积分规则
- 数据导入导出
- 设置

### 13.2 项目管理页

功能：

- 查看所有项目。
- 创建项目。
- 编辑项目名称和默认规则。
- 进入某个项目工作区。
- 查看项目统计。

统计包括：

- 选手数量。
- 活跃赛事数量。
- 已完成赛事数量。
- 当前 Elo 第一。
- 当前 WCC 第一。

### 13.3 选手管理页

功能：

- 表格展示选手。
- 搜索、筛选、排序。
- 新增选手。
- 批量导入。
- 批量停用。
- 查看选手详情。
- 查看参赛历史。
- 查看 Elo 曲线。
- 查看 WCC 构成。

表格字段：

- 编号
- 姓名
- 昵称
- 队伍
- Elo
- WCC
- 参赛次数
- 胜平负
- 状态

### 13.4 赛事列表页

功能：

- 按状态筛选赛事。
- 创建赛事。
- 查看赛事卡片或表格。
- 复制历史赛事配置。
- 归档赛事。

### 13.5 赛事创建向导

建议分步骤：

1. 基本信息。
2. 选择赛制。
3. 配置阶段。
4. 配置积分规则。
5. 添加参赛选手。
6. 确认并创建。

需要实时校验：

- 参赛人数是否满足赛制。
- WCC 分规则是否存在。
- 瑞士轮轮数是否合理。
- 淘汰赛是否需要轮空。

### 13.6 赛事详情页

标签页：

- 概览
- 参赛名单
- 对阵表
- 轮次
- 成绩表
- 积分影响
- 设置
- 操作记录

不同赛制展示不同主体：

- 淘汰赛：签表。
- 循环赛：轮次列表 + 积分榜 + 交叉表。
- 瑞士轮：当前轮次 + 积分榜 + 配对记录。
- 杯赛：阶段导航。

### 13.7 抽签与编排页

功能：

- 显示参赛名单。
- 设置种子。
- 一键自动抽签。
- 拖拽调整签位。
- 标记同队或同地区回避。
- 预览对阵。
- 确认生成。

抽签后应提示：

- 轮空数量。
- 种子分布。
- 回避规则是否全部满足。
- 无法满足的冲突。

### 13.8 成绩录入页

功能：

- 按轮次展示对局。
- 快速录入比分。
- 支持键盘操作。
- 支持批量保存。
- 支持标记弃权。
- 支持撤销和重新打开。
- 显示结果是否计入 Elo。

比赛现场应尽量减少点击，录入流程要快。

### 13.9 排名页

标签：

- Elo 排名。
- WCC 排名。
- 综合视图。

功能：

- 搜索选手。
- 查看排名变化。
- 查看积分构成。
- 导出 CSV。
- 按日期查看历史排名。

### 13.10 积分规则页

功能：

- 编辑 Elo 默认分。
- 编辑 K 值规则。
- 编辑 WCC 等级。
- 编辑 WCC 分值表。
- 编辑衰减规则。
- 编辑排名判定规则。
- 预览规则效果。

### 13.11 设置与备份页

功能：

- 管理管理员密码。
- 数据库备份。
- 数据库恢复。
- 自动备份设置。
- 导出全部数据。
- 查看系统版本。
- 查看服务地址。

## 14. 赛制算法设计

### 14.1 抽签算法

输入：

- 参赛者列表。
- 种子列表。
- 回避规则。
- 赛制配置。

输出：

- 签位列表。
- 冲突报告。
- 轮空列表。

步骤：

1. 根据赛制确定签位数量。
2. 分配种子位置。
3. 随机打乱非种子选手。
4. 按回避规则尝试放置。
5. 多次尝试后选择冲突最少方案。
6. 保存随机种子，保证可复现。

### 14.2 淘汰赛签表算法

核心数据结构：

```text
BracketNode
- nodeKey
- round
- position
- participantA
- participantB
- winnerToNodeKey
```

需要支持：

- 生成完整树。
- 处理轮空。
- 结果录入后推进胜者。
- 修改结果后清理受影响后续节点。

### 14.3 循环赛编排算法

使用圆桌轮转法：

- 如果人数为奇数，添加 BYE。
- 固定一个选手。
- 其他选手每轮旋转。
- 每轮生成对阵。
- 调整先后手平衡。

### 14.4 瑞士轮配对算法

第一阶段简化算法：

1. 根据当前积分排序。
2. 按积分分组。
3. 从高分组到低分组配对。
4. 同分组内避免重复对阵。
5. 无法配对时向下浮动选手。
6. 奇数人数时给最低分且未轮空者轮空。
7. 保存配对原因和浮动记录。

后续高级算法：

- 回溯搜索。
- 最大匹配。
- 颜色平衡约束。
- FIDE 瑞士轮规则扩展。

## 15. 数据一致性要求

### 15.1 事务

以下操作必须使用数据库事务：

- 生成抽签。
- 生成轮次。
- 录入对局结果并推进晋级。
- 完成赛事并结算积分。
- 重算积分。
- 恢复备份。
- 批量导入。

### 15.2 历史快照

以下规则需要在赛事开始或完成时保存快照：

- 排名规则。
- Elo 规则。
- WCC 规则。
- 抽签配置。
- 赛制阶段配置。

原因：未来管理员修改规则时，不应改变历史赛事的解释。

### 15.3 不可直接删除核心数据

建议对核心对象使用软删除或归档：

- 项目
- 选手
- 赛事
- 对局
- 积分历史

真正删除只用于测试数据或管理员明确清理。

## 16. 测试策略

### 16.1 单元测试

重点覆盖：

- Elo 计算。
- WCC 衰减计算。
- 淘汰赛生成。
- 循环赛轮转。
- 瑞士轮配对。
- 排名规则排序。
- 弃权和轮空处理。

### 16.2 API 测试

重点覆盖：

- 创建项目。
- 导入选手。
- 创建赛事。
- 自动抽签。
- 录入结果。
- 完成赛事。
- 查询排名。

### 16.3 前端测试

重点覆盖：

- 赛事创建向导。
- 成绩录入流程。
- 签表显示。
- 排名页面。

### 16.4 端到端测试

模拟完整流程：

1. 创建项目。
2. 添加 16 名选手。
3. 创建淘汰赛。
4. 自动抽签。
5. 录入所有结果。
6. 完成赛事。
7. 检查 Elo 和 WCC 排名。

## 17. 开发阶段规划

### 17.1 第一阶段：基础可用版本

目标：能在本机运行，完成单项目基本比赛管理。

功能：

- 项目管理。
- 选手管理。
- SQLite 数据库。
- 创建赛事。
- 单淘汰赛。
- 单循环赛。
- 基础成绩录入。
- Elo 计算。
- WCC 固定有效期。
- 排名页面。
- 手动备份。

### 17.2 第二阶段：完整赛制版本

功能：

- 瑞士轮。
- 杯赛多阶段。
- 小组赛 + 淘汰赛。
- WCC 阶梯衰减。
- 积分重算。
- 导入导出。
- 操作日志。
- 更完整的排名规则。

### 17.3 第三阶段：现场比赛增强

功能：

- 局域网只读访问。
- 观众页面。
- 实时刷新。
- 快速记分界面。
- 打印签表和成绩表。
- 选手二维码或公开链接。

### 17.4 第四阶段：桌面化和高级能力

功能：

- Tauri 桌面封装。
- 自动更新。
- 高级瑞士轮算法。
- 双淘汰赛。
- 数据云同步预留。
- 多用户权限。

## 18. 推荐目录结构

```text
Competition-Manager/
  package.json
  README.md
  DEVELOPMENT_PLAN.md
  .env.example
  prisma/
    schema.prisma
    migrations/
  data/
    .gitkeep
  backups/
    .gitkeep
  apps/
    web/
      index.html
      src/
        main.tsx
        app/
        pages/
        components/
        features/
        routes/
        styles/
    server/
      src/
        main.ts
        app.ts
        routes/
        services/
        repositories/
        domain/
        algorithms/
        schemas/
        utils/
  packages/
    shared/
      src/
        types/
        schemas/
        constants/
  tests/
    e2e/
```

## 19. 关键领域模块

后端建议按领域组织：

- `projects`：项目管理。
- `players`：选手管理。
- `tournaments`：赛事生命周期。
- `draws`：抽签。
- `pairings`：编排。
- `matches`：对局和成绩。
- `standings`：成绩表和排名规则。
- `ratings`：Elo 和 WCC。
- `imports`：数据导入。
- `exports`：数据导出。
- `backups`：备份恢复。
- `audit`：操作日志。

算法模块建议纯函数化，方便测试：

- `generateSingleEliminationBracket`
- `generateRoundRobinRounds`
- `generateSwissPairings`
- `calculateStandings`
- `calculateEloChange`
- `calculateWccEffectivePoints`

## 20. 风险和注意事项

### 20.1 瑞士轮复杂度

瑞士轮完整规则很复杂，第一阶段应实现可解释、可测试的简化版本，后续逐步增强。

### 20.2 积分重算

积分系统必须能追溯，否则一旦录错成绩很难修复。需要尽早设计积分历史表和重算流程。

### 20.3 历史规则快照

不要只保存当前规则，否则旧赛事会被新规则影响。赛事开始或结算时必须保存规则快照。

### 20.4 本机服务器可靠性

用户电脑作为服务器时，风险包括：

- 电脑睡眠。
- IP 变化。
- 防火墙阻止访问。
- 数据库文件损坏。
- 误删数据。

因此备份和导出功能优先级很高。

### 20.5 数据并发

SQLite 支持本机轻量并发，但大量设备同时写入不适合。初期应限制写操作主要由管理员完成，观众页面只读。

## 21. 最小可行产品定义

第一版 MVP 应完成：

- 本机启动 Web 应用。
- 创建项目。
- 添加和编辑选手。
- 创建单淘汰赛。
- 自动抽签。
- 录入比赛结果。
- 展示签表和最终名次。
- 根据结果更新 Elo。
- 根据最终名次发放 WCC 分。
- 查看项目 Elo 和 WCC 排名。
- 手动备份 SQLite 数据库。

只要这些功能稳定，就可以开始用真实小型比赛验证。

## 22. 后续实现优先级建议

建议开发顺序：

1. 初始化项目结构和数据库。
2. 实现项目与选手管理。
3. 实现单淘汰赛完整闭环。
4. 实现 Elo 和 WCC 基础积分。
5. 实现排名页面。
6. 实现循环赛。
7. 实现备份和导入导出。
8. 实现瑞士轮。
9. 实现杯赛多阶段。
10. 优化局域网观众访问和现场录分体验。

