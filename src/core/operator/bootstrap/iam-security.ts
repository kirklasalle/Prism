import { join, dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolveWorkspaceRoot, workspacePath } from "../../config/workspace-resolver.js";
import { IamStore } from "../../iam/store.js";
import { SessionManager } from "../../iam/sso/session.js";
import { IamRouteHandler } from "../routes/iam-handler.js";
import { Router } from "../routes/index.js";
import { AuthGate } from "../../security/auth.js";
import { RateLimiter } from "../../security/rate-limiter.js";
import { resolveAllowedOrigins, type CorsCsrfConfig } from "../../security/cors-csrf.js";
import type { ActivityBus } from "../../activity/bus.js";

export interface IamSecurityConfig {
  iamStore: IamStore;
  sessionManager: SessionManager;
  iamHandler: IamRouteHandler;
  router: Router;
  authGate: AuthGate;
  rateLimiter: RateLimiter;
  corsCsrfConfig: CorsCsrfConfig;
}

export function bootstrapIamSecurity(port: number, activityBus: ActivityBus): IamSecurityConfig {
  const iamDbPath = join(resolveWorkspaceRoot(), ".prism", "iam.db");
  mkdirSync(dirname(iamDbPath), { recursive: true });
  const iamStore = new IamStore(iamDbPath);
  const sessionManager = new SessionManager(iamStore);
  const iamHandler = new IamRouteHandler({
    iamStore,
    sessionManager,
    defaultTenantId: "default",
    activityBus,
  });
  const router = new Router(iamHandler);

  iamStore.seedDefaultRoles("default");
  const existingUsers = iamStore.listUsers("default");
  if (existingUsers.length === 0) {
    const isProduction = process.env.NODE_ENV === "production";
    if (isProduction) {
      // In production, do NOT seed default evaluation credentials.
      // Operators must use the setup wizard (/setup) to create their admin account.
      console.log(
        "[IAM] No operator accounts found. Visit /setup to create your admin account. " +
        "Default evaluation credentials are disabled in production."
      );
    } else {
      // Development/evaluation mode only — seed convenience accounts.
      // ⚠️  These credentials are for local evaluation only and must not be
      //     used in any internet-facing or production deployment.
      console.warn(
        "[IAM] ⚠️  Seeding default evaluation accounts (admin@prism.ai / admin, " +
        "testing@prism.ai / testing). These are for LOCAL EVALUATION ONLY. " +
        "Run the setup wizard (/setup) to create production-grade credentials."
      );
      const adminUser = iamStore.createUser({
        tenantId: "default",
        email: "admin@prism.ai",
        displayName: "Administrator",
        status: "active",
        attrs: { passwordHash: createHash("sha256").update("admin", "utf-8").digest("hex") },
      });
      const adminRole = iamStore.getRoleByName("default", "admin");
      if (adminRole) iamStore.addMembership(adminUser.id, "default", adminRole.id);

      const testUser = iamStore.createUser({
        tenantId: "default",
        email: "testing@prism.ai",
        displayName: "Test Operator",
        status: "active",
        attrs: { passwordHash: createHash("sha256").update("testing", "utf-8").digest("hex") },
      });
      const operatorRole = iamStore.getRoleByName("default", "operator");
      if (operatorRole) iamStore.addMembership(testUser.id, "default", operatorRole.id);
    }
  }

  // ── Security: Auth gate & rate limiter ──────────────────────────────
  const authDisabled = process.env.PRISM_AUTH_DISABLED === "true";
  if (authDisabled && process.env.NODE_ENV === "production") {
    throw new Error(
      "[SECURITY] PRISM_AUTH_DISABLED=true is not permitted when NODE_ENV=production. " +
      "Remove this environment variable before deploying."
    );
  }
  const authGate = new AuthGate({
    tokenFilePath: workspacePath("state", "admin-token"),
    disabled: authDisabled,
    publicRoutes: [
      "/health", "/api/health", "/favicon.ico", "/.well-known/agent.json", "/metrics", "/api/v1/openapi.json", "/api/openapi.json",
      "/",
      "/api/workspace/characters", "/api/workspace/character-import", "/api/workspace/character-assign",
      "/api/models/gguf", "/api/models/recommended",
      "/api/llm/catalog", "/api/llm/provider-test", "/api/llm/provider-secret", "/api/llm/routing/suggest",
      "/api/browser/profiles",
      "/api/guardian/configure", "/api/guardian/status", "/api/guardian/start",
      "/api/readiness/recheck",
      "/api/v1/telemetry/auth-trace",
    ],
    publicPrefixes: [
      "/public/", "/setup", "/login", "/api/auth/", "/api/iam/sso/", "/api/iam/login", "/scim/v2/",
      "/dashboard", "/simple",
      "/api/setup/",
    ],
  });
  const rateLimiter = new RateLimiter({
    maxRequests: Number(process.env.PRISM_RATE_LIMIT ?? 200),
    windowMs: 60_000,
  });

  const corsCsrfConfig = {
    allowedOrigins: resolveAllowedOrigins(port, process.env),
    logRejections: process.env.PRISM_SECURITY_QUIET !== "true",
  };

  return {
    iamStore,
    sessionManager,
    iamHandler,
    router,
    authGate,
    rateLimiter,
    corsCsrfConfig,
  };
}
