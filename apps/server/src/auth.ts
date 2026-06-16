import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import crypto from "node:crypto";
import { z } from "zod";
import { prisma } from "./db.js";

const sessionCookieName = "cm_session";
const sessionTtlMs = 7 * 24 * 60 * 60 * 1000;

const setupSchema = z.object({
  username: z.string().min(1).default("admin"),
  password: z.string().min(8)
});

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1)
});

export function registerAuthRoutes(app: FastifyInstance) {
  app.get("/api/auth/status", async () => {
    const adminCount = await prisma.user.count();
    return { initialized: adminCount > 0 };
  });

  app.post("/api/auth/setup", async (request, reply) => {
    const existingUsers = await prisma.user.count();
    if (existingUsers > 0) {
      reply.status(409);
      return { error: "Admin user already exists" };
    }

    const input = setupSchema.parse(request.body);
    const user = await prisma.user.create({
      data: {
        username: input.username,
        passwordHash: hashPassword(input.password),
        role: "ADMIN"
      }
    });

    setSessionCookie(reply, user.id);
    reply.status(201);
    return { id: user.id, username: user.username, role: user.role };
  });

  app.post("/api/auth/login", async (request, reply) => {
    const input = loginSchema.parse(request.body);
    const user = await prisma.user.findUnique({ where: { username: input.username } });
    if (!user || !verifyPassword(input.password, user.passwordHash)) {
      reply.status(401);
      return { error: "Invalid username or password" };
    }

    setSessionCookie(reply, user.id);
    return { id: user.id, username: user.username, role: user.role };
  });

  app.post("/api/auth/logout", async (_request, reply) => {
    reply.header("set-cookie", `${sessionCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    return { ok: true };
  });

  app.get("/api/auth/me", async (request, reply) => {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      reply.status(401);
      return { error: "Not authenticated" };
    }
    return { id: user.id, username: user.username, role: user.role };
  });
}

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  const user = await getAuthenticatedUser(request);
  if (!user || user.role !== "ADMIN") {
    reply.status(401).send({ error: "Admin login required" });
  }
}

export function needsAdmin(request: FastifyRequest): boolean {
  const url = request.raw.url ?? "";
  if (!url.startsWith("/api/")) return false;
  if (url.startsWith("/api/auth/") || url.startsWith("/api/health")) return false;
  if (url.startsWith("/api/backups")) return true;
  if (url.includes("/export/")) return true;
  return !["GET", "HEAD", "OPTIONS"].includes(request.method);
}

async function getAuthenticatedUser(request: FastifyRequest) {
  const token = parseCookie(request.headers.cookie ?? "")[sessionCookieName];
  const session = token ? verifySessionToken(token) : null;
  if (!session) return null;

  return prisma.user.findUnique({ where: { id: session.userId } });
}

function setSessionCookie(reply: FastifyReply, userId: string): void {
  const token = signSessionToken({ userId, expiresAt: Date.now() + sessionTtlMs });
  reply.header(
    "set-cookie",
    `${sessionCookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(sessionTtlMs / 1000)}`
  );
}

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("base64url");
  const hash = crypto.pbkdf2Sync(password, salt, 210_000, 32, "sha256").toString("base64url");
  return `pbkdf2_sha256$210000$${salt}$${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [scheme, iterationsText, salt, expected] = stored.split("$");
  if (scheme !== "pbkdf2_sha256" || !iterationsText || !salt || !expected) return false;
  const iterations = Number.parseInt(iterationsText, 10);
  const actual = crypto.pbkdf2Sync(password, salt, iterations, 32, "sha256").toString("base64url");
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

function signSessionToken(payload: { userId: string; expiresAt: number }): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", sessionSecret()).update(body).digest("base64url");
  return `${body}.${signature}`;
}

function verifySessionToken(token: string): { userId: string; expiresAt: number } | null {
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  const expected = crypto.createHmac("sha256", sessionSecret()).update(body).digest("base64url");
  if (signature.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;

  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { userId: string; expiresAt: number };
  return payload.expiresAt > Date.now() ? payload : null;
}

function sessionSecret(): string {
  return process.env.SESSION_SECRET ?? "competition-manager-local-dev-secret";
}

function parseCookie(header: string): Record<string, string> {
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        return index < 0 ? [part, ""] : [part.slice(0, index), part.slice(index + 1)];
      })
  );
}
