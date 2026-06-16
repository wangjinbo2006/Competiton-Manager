# Competition Manager

本项目是一个本机运行的比赛管理软件，目标是支持选手管理、多项目隔离、多赛制编排、成绩表、Elo 积分和 WCC 积分。

详细使用说明见 [USER_GUIDE.md](USER_GUIDE.md)。

## 开发运行

```bash
npm install
npm run dev
```

默认地址：

- 前端：`http://localhost:5173`
- 后端：`http://localhost:3001`

## 生产模拟

```bash
npm run db:init
npm run build
npm run start
```

首次进入页面时先创建本机管理员账号。之后新增、抽签、录入成绩、备份/恢复等写操作都需要登录；公开查看项目、赛事和成绩表不需要登录。

本项目默认使用 SQLite 文件数据库，路径来自 `.env` 的 `DATABASE_URL`，没有额外服务器时可直接把当前电脑作为服务端。`npm run dev` 和 `npm run start` 会自动生成 Prisma Client 并初始化本地数据库。

如需局域网访问，设置：

```env
HOST=0.0.0.0
PORT=3000
```
