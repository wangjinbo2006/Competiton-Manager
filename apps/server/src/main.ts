import { buildApp } from "./app.js";
import { getEnv } from "./env.js";

const env = getEnv();
const app = buildApp();

try {
  await app.listen({ host: env.host, port: env.port });
  app.log.info(`Competition Manager listening on http://${env.host}:${env.port}`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
