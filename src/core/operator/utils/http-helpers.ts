import { IncomingMessage, ServerResponse } from "node:http";
import { URL } from "node:url";

export interface MultipartPart {
  fileName?: string;
  contentType?: string;
  data: Buffer;
}

export function normalizePrompt(content: string): string {
  return content.trim().toLowerCase().replace(/\s+/g, " ");
}

export function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 255) || "file";
}

export function parseMultipartParts(body: Buffer, boundary: string): MultipartPart[] {
  const parts: MultipartPart[] = [];
  const boundaryBuf = Buffer.from(`--${boundary}`);
  const endBoundaryBuf = Buffer.from(`--${boundary}--`);

  let pos = body.indexOf(boundaryBuf);
  if (pos === -1) return parts;
  pos += boundaryBuf.length;

  while (pos < body.length) {
    if (body[pos] === 0x0d && body[pos + 1] === 0x0a) pos += 2;

    const nextBoundary = body.indexOf(boundaryBuf, pos);
    if (nextBoundary === -1) break;

    const partData = body.subarray(pos, nextBoundary);
    const headerEnd = partData.indexOf(Buffer.from("\r\n\r\n"));
    if (headerEnd === -1) { pos = nextBoundary + boundaryBuf.length; continue; }

    const headerStr = partData.subarray(0, headerEnd).toString("utf-8");
    const fileData = partData.subarray(headerEnd + 4);

    const trimmed = fileData.length >= 2 && fileData[fileData.length - 2] === 0x0d && fileData[fileData.length - 1] === 0x0a
      ? fileData.subarray(0, fileData.length - 2)
      : fileData;

    const fileNameMatch = /filename="([^"]*)"/.exec(headerStr);
    const ctMatch = /Content-Type:\s*([^\r\n]+)/i.exec(headerStr);

    parts.push({
      fileName: fileNameMatch?.[1],
      contentType: ctMatch?.[1]?.trim(),
      data: Buffer.from(trimmed),
    });

    pos = nextBoundary + boundaryBuf.length;
    if (body.subarray(nextBoundary, nextBoundary + endBoundaryBuf.length).equals(endBoundaryBuf)) break;
  }

  return parts;
}

export function deriveSessionTitle(content: string): string {
  return content.trim().replace(/\s+/g, " ").slice(0, 60) || "New Session";
}

export function parseEventFilters(
  url: string,
  fallbackLimit: number,
): {
  limit: number;
  operation: string | null;
  chatSessionId: string | null;
  correlationId: string | null;
} {
  try {
    const parsed = new URL(`http://localhost${url}`);
    const value = Number(parsed.searchParams.get("limit") ?? fallbackLimit);
    const limit = Number.isFinite(value)
      ? Math.max(1, Math.min(500, Math.floor(value)))
      : fallbackLimit;
    const operation = parsed.searchParams.get("operation")?.trim() || null;
    const chatSessionId = parsed.searchParams.get("chatSessionId")?.trim() || null;
    const correlationId = parsed.searchParams.get("correlationId")?.trim() || null;
    return { limit, operation, chatSessionId, correlationId };
  } catch {
    return { limit: fallbackLimit, operation: null, chatSessionId: null, correlationId: null };
  }
}

export function buildSessionConfigDiff(
  beforeProviderId: string | null,
  beforeModel: string | null,
  afterProviderId: string | null,
  afterModel: string | null,
) {
  const changedFields: string[] = [];
  if ((beforeProviderId ?? null) !== (afterProviderId ?? null)) {
    changedFields.push("llmProviderId");
  }
  if ((beforeModel ?? null) !== (afterModel ?? null)) {
    changedFields.push("llmModel");
  }

  return {
    changedFields,
    before: {
      providerId: beforeProviderId ?? null,
      model: beforeModel ?? null,
    },
    after: {
      providerId: afterProviderId ?? null,
      model: afterModel ?? null,
    },
  };
}

export function normalizeSessionPackageStatus(value: unknown): "planned" | "running" | "blocked" | "complete" {
  return value === "running" || value === "blocked" || value === "complete" ? value : "planned";
}

