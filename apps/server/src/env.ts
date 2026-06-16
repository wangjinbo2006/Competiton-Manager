export interface AppEnv {
  host: string;
  port: number;
  databaseUrl: string;
}

export function getEnv(): AppEnv {
  return {
    host: process.env.HOST ?? "127.0.0.1",
    port: Number(process.env.PORT ?? 3001),
    databaseUrl: process.env.DATABASE_URL ?? "file:./data/competition-manager.sqlite"
  };
}
