import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { IRouteHandler } from "./types.js";
import type { DashboardService } from "../dashboard-service.js";
import { classifyChatTier } from "../chat-tier-classifier.js";
import { getWorkspaceHub } from "../../config/workspace-resolver.js";
import { writePreferences } from "../../config/workspace-resolver.js";

export class ChatHandler implements IRouteHandler {
  match(req: IncomingMessage): boolean {
    const url = req.url ?? "";
    const pathname = url.split("?")[0];
    const method = req.method?.toUpperCase() ?? "GET";

    if (pathname.startsWith("/api/chat")) return true;
    if (pathname.startsWith("/api/session/")) return true;
    if (pathname.startsWith("/api/attachments/")) return true;
    if (pathname.startsWith("/api/auth/gmail/")) return true;
    if (pathname.startsWith("/api/auth/outlook/")) return true;
    if (pathname.startsWith("/api/support/tickets")) return true;
    if (pathname === "/api/identity") return true;
    if (pathname.startsWith("/api/sessions/tab")) return true;
    return false;
  }

  async handle(req: IncomingMessage, res: ServerResponse, service: DashboardService): Promise<void> {
    const rawUrl = req.url ?? "";
    const url = rawUrl.startsWith("/api/v1/") ? "/api/" + rawUrl.substring("/api/v1/".length) : rawUrl;
    const method = req.method?.toUpperCase() ?? "GET";

    const principal = service.getIamHandler().resolvePrincipalFromCookie(req);
    const authDisabled = (process.env.PRISM_AUTH_DISABLED ?? "").toLowerCase() === "true";
    const isAdmin = authDisabled || (principal ? principal.roles.includes("admin") : true);

    // If we have a principal, enforce session ownership/view access on endpoints referencing specific session IDs
    if (principal) {
      let extractedSessionId: string | null = null;
      const m1 = /^\/api\/chat\/sessions\/([^/]+)/.exec(url);
      const m2 = /^\/api\/session\/([^/]+)/.exec(url);
      if (m1) extractedSessionId = decodeURIComponent(m1[1]!);
      else if (m2) extractedSessionId = decodeURIComponent(m2[1]!);

      if (extractedSessionId) {
        const session = service.getChatStore().getSession(extractedSessionId);
        if (session) {
          const hasOwnership = session.operatorEmail === principal.email;

          if (!hasOwnership) {
            res.writeHead(403, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "forbidden", message: "You do not have access to this session." }));
            return;
          }
        }
      }
    }

    // 1. GET /api/chat/stream
    if (method === "GET" && url.startsWith("/api/chat/stream")) {
      const sseId = randomUUID();
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-SSE-Id": sseId,
      });
      res.write(`data: ${JSON.stringify({ type: "connected", sseId })}\n\n`);
      service.sseClients.set(sseId, res);
      req.on("close", () => {
        service.sseClients.delete(sseId);
      });
      return;
    }

    // 2. POST /api/chat
    if (method === "POST" && url === "/api/chat") {
      let body: { prompt?: unknown; sessionId?: unknown };
      try {
        body = await service.readJsonBody<{ prompt?: unknown; sessionId?: unknown }>(req);
      } catch (err) {
        return this.json(res, 400, { error: "invalid_json", message: String((err as Error).message) });
      }
      const prompt = typeof body.prompt === "string" ? body.prompt : "";
      const sessionId = typeof body.sessionId === "string" && body.sessionId.length > 0
        ? body.sessionId
        : `ptac-${randomUUID().slice(0, 8)}`;
      if (prompt.trim().length === 0) {
        return this.json(res, 400, {
          error: "missing_prompt",
          message: "Request body must include a non-empty 'prompt' field.",
        });
      }

      // Check session ownership if it exists
      const session = service.getChatStore().getSession(sessionId);
      if (session && principal && session.operatorEmail !== principal.email) {
        return this.json(res, 403, { error: "forbidden", message: "You do not have access to this session." });
      }

      const classification = classifyChatTier(prompt);

      service.getActivityBus().emit({
        sessionId,
        layer: "governance",
        operation: "chat.tier_classified",
        status: "succeeded",
        details: {
          tier: classification.tier,
          reason_code: classification.reasonCode,
          matched_pattern: classification.matchedPattern,
          prompt_length: prompt.length,
        },
      });

      if (classification.tier === 3) {
        return this.json(res, 200, {
          tier: 3,
          denied: true,
          reason_code: classification.reasonCode,
          matched_pattern: classification.matchedPattern,
          session_id: sessionId,
        });
      }

      if (classification.tier === 2) {
        const newIds = service.enqueueApprovalAndAutoRun(sessionId, prompt, classification);
        return this.json(res, 202, {
          tier: 2,
          approval_pending_ids: newIds,
          reason_code: classification.reasonCode,
          matched_pattern: classification.matchedPattern,
          session_id: sessionId,
        });
      }

      service.getActivityBus().emit({
        sessionId,
        layer: "chat" as any,
        operation: "chat.message.completed",
        status: "succeeded",
        details: {
          prompt,
          response:
            "Acknowledged. Tier-1 capability prompt accepted by the governance layer; "
            + "for a full conversational reply, post to /api/chat/sessions/:id/messages.",
        },
      });

      return this.json(res, 200, {
        tier: 1,
        accepted: true,
        reason_code: classification.reasonCode,
        response:
          "Acknowledged. Tier-1 capability prompt accepted by the governance layer; "
          + "for a full conversational reply, post to /api/chat/sessions/:id/messages.",
        session_id: sessionId,
      });
    }

    // 3. GET /api/chat/sessions
    if (method === "GET" && url === "/api/chat/sessions") {
      let sessions = service.listChatSessions();
      if (principal) {
        sessions = sessions.filter(s =>
          s.operatorEmail === principal.email
        );
      }
      return this.json(res, 200, sessions);
    }

    // 4. POST /api/chat/sessions
    if (method === "POST" && url === "/api/chat/sessions") {
      try {
        const body = await service.readJsonBody<{
          title?: string;
          characterId?: string;
          cacAssignmentId?: string;
          operatorEmail?: string;
          assistantEmail?: string;
        }>(req);
        const operatorEmail = principal ? principal.email : (body.operatorEmail || undefined);
        const session = service.createChatSession({
          title: body.title,
          characterId: body.characterId,
          cacAssignmentId: body.cacAssignmentId,
          operatorEmail,
          assistantEmail: body.assistantEmail,
        });
        return this.json(res, 201, { session });
      } catch (error) {
        const tagged = error as Error & { code?: string };
        if (tagged?.code === "no_default_character") {
          return this.json(res, 409, {
            error: "no_default_character",
            action: "run_wizard",
            message: "No character is bound to this workspace. Run the setup wizard or pass characterId.",
          });
        }
        if (tagged?.code === "character_not_found") {
          return this.json(res, 404, { error: tagged.message });
        }
        return this.json(res, 400, { error: String(error) });
      }
    }

    // 5. POST /api/session/:id/character
    const sessionCharacterMatch = /^\/api\/session\/([^/]+)\/character$/.exec(url);
    if (sessionCharacterMatch && method === "POST") {
      try {
        const sessionId = decodeURIComponent(sessionCharacterMatch[1]!);
        const body = await service.readJsonBody<{
          characterId?: string;
          cacAssignmentId?: string;
          operatorEmail?: string;
          assistantEmail?: string;
        }>(req);
        const characterId = String(body.characterId ?? "").trim();
        if (!characterId) {
          return this.json(res, 400, { error: "characterId is required." });
        }
        const available = service.listWorkspaceCharacters();
        if (!available.some((c) => c.id === characterId)) {
          return this.json(res, 404, { error: `character_not_found: ${characterId}` });
        }
        const executionProfile = (service.status.executionProfileSegment || "individual").toLowerCase();
        let cacAssignmentId = (body.cacAssignmentId ?? "").toString().trim() || null;
        let operatorEmailFinal = body.operatorEmail ?? null;
        let assistantEmailFinal = body.assistantEmail ?? null;

        if (!cacAssignmentId) {
          const rawEmail = (principal && principal.email) ? principal.email : (body.operatorEmail ?? `operator@prism.local`);
          const operatorEmail = String(rawEmail).trim();
          const rawAssistantEmail = body.assistantEmail ?? `${characterId}@prism.local`;
          const assistantEmail = String(rawAssistantEmail).trim();
          try {
            const assignment = service.getCharacterAccountabilityManager().assign({
              characterId,
              prismUserId: "prism-user",
              prismUserEmail: operatorEmail,
              operatorId: "operator",
              operatorEmail,
              clientId: "dashboard",
              sessionId,
              executionProfile,
              workspaceHub: getWorkspaceHub(),
            });
            cacAssignmentId = assignment.assignmentId;
            operatorEmailFinal = assignment.operatorEmail;
            assistantEmailFinal = assistantEmail;
          } catch (err) {
            const e = err as { message?: string };
            return this.json(res, 400, { error: e.message ?? "CAC assignment failed" });
          }
        } else {
          if (!isAdmin && principal) {
            const assignmentInfo = service.getCharacterAccountabilityManager().getAssignmentChain(cacAssignmentId);
            if (assignmentInfo && assignmentInfo.assignment.operatorEmail !== principal.email) {
              return this.json(res, 403, { error: "forbidden", message: "You do not own this assignment." });
            }
          }
          service.getCharacterAccountabilityManager().recordDispatch(cacAssignmentId);
        }

        const session = service.getChatStore().bindSessionCharacter(sessionId, {
          characterId,
          cacAssignmentId,
          executionProfile,
          operatorEmail: operatorEmailFinal,
          assistantEmail: assistantEmailFinal,
        });
        if (!session) {
          return this.json(res, 404, { error: "session_not_found" });
        }
        try {
          writePreferences({ lastUsedCharacterId: characterId });
        } catch { /* non-fatal */ }
        return this.json(res, 200, { session });
      } catch (error) {
        return this.json(res, 400, { error: String(error) });
      }
    }

    // 6. GET /api/chat/sessions/:id/messages
    const chatMessagesMatch = /^\/api\/chat\/sessions\/([^/]+)\/messages$/.exec(url);
    if (chatMessagesMatch && method === "GET") {
      try {
        const sessionId = decodeURIComponent(chatMessagesMatch[1]!);
        const messages = service.getChatMessages(sessionId);
        const enriched = messages.map((m) => {
          const attachments = service.getChatStore().getAttachments(m.messageId);
          return attachments.length ? { ...m, attachments } : m;
        });
        return this.json(res, 200, { messages: enriched });
      } catch (error) {
        return this.json(res, 404, { error: String(error) });
      }
    }

    // 7. POST /api/chat/sessions/:id/messages
    if (chatMessagesMatch && method === "POST") {
      try {
        const sessionId = decodeURIComponent(chatMessagesMatch[1]!);
        const body = await service.readJsonBody<{ content?: string; override?: boolean }>(req);

        if (!body.override && service.usageMetering) {
          const capCheck = service.usageMetering.checkCap();
          if (!capCheck.allowed) {
            return this.json(res, 200, {
              softBlock: true,
              capType: capCheck.capType,
              remainingUsd: capCheck.remainingUsd,
              message: `You have reached your ${capCheck.capType} spending cap. Send with override to proceed anyway.`,
            });
          }
        }

        const turn = await service.submitChatMessage(sessionId, body.content ?? "");
        return this.json(res, 201, turn);
      } catch (error) {
        const message = String(error);
        const status = /unknown chat session/i.test(message) ? 404 : 400;
        return this.json(res, status, { error: message });
      }
    }

    // 8. PATCH /api/chat/sessions/:id
    const chatSessionMatch = /^\/api\/chat\/sessions\/([^/]+)$/.exec(url);
    if (chatSessionMatch && method === "PATCH") {
      try {
        const sessionId = decodeURIComponent(chatSessionMatch[1]!);
        const body = await service.readJsonBody<{ title?: string }>(req);
        if (!body.title?.trim()) return this.json(res, 400, { error: "title is required." });
        service.getChatStore().updateSessionTitle(sessionId, body.title.trim());
        return this.json(res, 200, { updated: true });
      } catch (error) {
        return this.json(res, 404, { error: String(error) });
      }
    }

    // 9. DELETE /api/chat/sessions/:id
    if (chatSessionMatch && method === "DELETE") {
      try {
        const sessionId = decodeURIComponent(chatSessionMatch[1]!);
        service.deleteChatSession(sessionId);
        return this.json(res, 200, { deleted: true });
      } catch (error) {
        return this.json(res, 404, { error: String(error) });
      }
    }

    // 10. POST /api/chat/sessions/:id/messages/:msgId/attachments
    const attachUploadMatch = /^\/api\/chat\/sessions\/([^/]+)\/messages\/([^/]+)\/attachments$/.exec(url);
    if (attachUploadMatch && method === "POST") {
      try {
        const sessionId = decodeURIComponent(attachUploadMatch[1]!);
        const messageId = decodeURIComponent(attachUploadMatch[2]!);
        return await service.handleAttachmentUpload(req, res, sessionId, messageId);
      } catch (error) {
        return this.json(res, 400, { error: String(error) });
      }
    }

    // 11. GET /api/chat/sessions/:id/messages/:msgId/attachments
    if (attachUploadMatch && method === "GET") {
      try {
        const sessionId = decodeURIComponent(attachUploadMatch[1]!);
        const messageId = decodeURIComponent(attachUploadMatch[2]!);
        const attachments = service.getChatStore().getAttachments(messageId);
        return this.json(res, 200, { attachments });
      } catch (error) {
        return this.json(res, 404, { error: String(error) });
      }
    }

    // 12. GET /api/attachments/:id
    const attachServeMatch = /^\/api\/attachments\/([^/]+)$/.exec(url);
    if (attachServeMatch && method === "GET") {
      try {
        const attachmentId = decodeURIComponent(attachServeMatch[1]!);
        return service.serveAttachmentFile(res, attachmentId);
      } catch (error) {
        return this.json(res, 404, { error: String(error) });
      }
    }

    // 13. GET /api/attachments/:id/thumbnail
    const attachThumbMatch = /^\/api\/attachments\/([^/]+)\/thumbnail$/.exec(url);
    if (attachThumbMatch && method === "GET") {
      try {
        const attachmentId = decodeURIComponent(attachThumbMatch[1]!);
        return service.serveAttachmentFile(res, attachmentId, true);
      } catch (error) {
        return this.json(res, 404, { error: String(error) });
      }
    }

    // 14. DELETE /api/attachments/:id
    const attachDeleteMatch = /^\/api\/attachments\/([^/]+)$/.exec(url);
    if (attachDeleteMatch && method === "DELETE") {
      try {
        const attachmentId = decodeURIComponent(attachDeleteMatch[1]!);
        service.getChatStore().deleteAttachment(attachmentId);
        return this.json(res, 200, { deleted: true });
      } catch (error) {
        return this.json(res, 404, { error: String(error) });
      }
    }

    // 15. GET /api/support/tickets
    if (method === "GET" && url === "/api/support/tickets") {
      return this.json(res, 200, service.getChatStore().listSupportTickets());
    }

    // 16. POST /api/support/tickets
    if (method === "POST" && url === "/api/support/tickets") {
      try {
        const body = await service.readJsonBody<{ title?: string; description?: string; source?: string; severity?: string; status?: string; metadata?: any }>(req);
        if (!body.title || !body.description) {
          return this.json(res, 400, { error: "Missing title or description" });
        }
        const ticket = service.getChatStore().createSupportTicket({
          title: body.title,
          description: body.description,
          source: body.source || "user",
          severity: body.severity as any || "low",
          status: body.status as any || "open",
          metadata: body.metadata,
        });
        return this.json(res, 201, ticket);
      } catch (err) {
        return this.json(res, 500, { error: String(err) });
      }
    }

    // 17. POST /api/support/tickets/:id/update
    if (method === "POST" && /^\/api\/support\/tickets\/[^/]+\/update$/.test(url)) {
      try {
        const ticketId = url.split("/")[4] ?? "";
        const body = await service.readJsonBody<{ status?: string; resolutionLog?: string }>(req);
        if (!body.status) {
          return this.json(res, 400, { error: "Missing status field" });
        }
        const ok = service.getChatStore().updateSupportTicket(ticketId, body.status, body.resolutionLog);
        return this.json(res, ok ? 200 : 404, { ok });
      } catch (err) {
        return this.json(res, 500, { error: String(err) });
      }
    }

    // 18. POST /api/support/tickets/:id/delete
    if (method === "POST" && /^\/api\/support\/tickets\/[^/]+\/delete$/.test(url)) {
      try {
        const ticketId = url.split("/")[4] ?? "";
        const ok = service.getChatStore().deleteSupportTicket(ticketId);
        return this.json(res, ok ? 200 : 404, { ok });
      } catch (err) {
        return this.json(res, 500, { error: String(err) });
      }
    }

    // 19. GET /api/auth/gmail/authorize
    if (method === "GET" && url === "/api/auth/gmail/authorize") {
      try {
        const authUrl = await service.getGmailOAuth().getAuthorizationUrl();
        return this.json(res, 200, { authUrl });
      } catch (err: unknown) {
        return this.json(res, 503, { error: (err as Error).message });
      }
    }

    // 20. GET /api/auth/gmail/callback
    if (method === "GET" && url.startsWith("/api/auth/gmail/callback")) {
      const parsed = new URL(url, "http://localhost");
      const code = parsed.searchParams.get("code");
      if (!code) {
        return this.json(res, 400, { error: "Missing code parameter" });
      }
      const result = await service.getGmailOAuth().exchangeCode(code);
      res.writeHead(302, { Location: "/settings?tab=oauth&provider=gmail&connected=" + result.connected });
      res.end();
      return;
    }

    // 21. GET /api/auth/gmail/status
    if (method === "GET" && url === "/api/auth/gmail/status") {
      const status = await service.getGmailOAuth().getStatus();
      return this.json(res, 200, status);
    }

    // 22. DELETE /api/auth/gmail/disconnect
    if (method === "DELETE" && url === "/api/auth/gmail/disconnect") {
      await service.getGmailOAuth().disconnect();
      return this.json(res, 200, { disconnected: true });
    }

    // 23. GET /api/auth/outlook/authorize
    if (method === "GET" && url === "/api/auth/outlook/authorize") {
      try {
        const authUrl = await service.getOutlookOAuth().getAuthorizationUrl();
        return this.json(res, 200, { authUrl });
      } catch (err: unknown) {
        return this.json(res, 503, { error: (err as Error).message });
      }
    }

    // 24. GET /api/auth/outlook/callback
    if (method === "GET" && url.startsWith("/api/auth/outlook/callback")) {
      const parsed = new URL(url, "http://localhost");
      const code = parsed.searchParams.get("code");
      if (!code) {
        return this.json(res, 400, { error: "Missing code parameter" });
      }
      const result = await service.getOutlookOAuth().exchangeCode(code);
      res.writeHead(302, { Location: "/settings?tab=oauth&provider=outlook&connected=" + result.connected });
      res.end();
      return;
    }

    // 25. GET /api/auth/outlook/status
    if (method === "GET" && url === "/api/auth/outlook/status") {
      const status = await service.getOutlookOAuth().getStatus();
      return this.json(res, 200, status);
    }

    // 26. DELETE /api/auth/outlook/disconnect
    if (method === "DELETE" && url === "/api/auth/outlook/disconnect") {
      await service.getOutlookOAuth().disconnect();
      return this.json(res, 200, { disconnected: true });
    }

    // 27. GET /api/identity
    if (method === "GET" && url === "/api/identity") {
      const devIdentity = service.getDevIdentity();
      const op = devIdentity?.getOperator();
      const ag = devIdentity?.getAgent();
      return this.json(res, 200, { operator: op ?? null, agent: ag ?? null });
    }

    // 28. GET /api/sessions/tabs
    if (method === "GET" && url === "/api/sessions/tabs") {
      const tabSessionRegistry = service.getTabSessionRegistry();
      if (!tabSessionRegistry) return this.json(res, 200, { sessions: [] });
      return this.json(res, 200, { sessions: tabSessionRegistry.getSummary() });
    }

    // 29. POST /api/sessions/tab/:id
    if (method === "POST" && url.startsWith("/api/sessions/tab/")) {
      const tabSessionRegistry = service.getTabSessionRegistry();
      if (!tabSessionRegistry) return this.json(res, 503, { error: "Tab sessions not initialized" });
      const tabId = url.replace("/api/sessions/tab/", "").split("?")[0];
      try {
        const session = tabSessionRegistry.getOrCreate(tabId as any);
        return this.json(res, 200, session);
      } catch (err) { return this.json(res, 400, { error: String(err) }); }
    }

    // 30. POST /api/sessions/tab-event/:id
    if (method === "POST" && url.startsWith("/api/sessions/tab-event/")) {
      const tabSessionRegistry = service.getTabSessionRegistry();
      if (!tabSessionRegistry) return this.json(res, 503, { error: "Not initialized" });
      const tabId = url.replace("/api/sessions/tab-event/", "").split("?")[0];
      const session = tabSessionRegistry.recordEvent(tabId as any);
      return this.json(res, 200, { ok: !!session, session });
    }
  }

  private json(res: ServerResponse, status: number, data: any): void {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(data));
  }
}
