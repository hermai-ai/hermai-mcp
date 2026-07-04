#!/usr/bin/env node

import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const DEFAULT_API_BASE = "https://api.hermai.ai";
const SERVER_VERSION = "1.1.0";

// Hosted fetch lanes can be slow (warm browser cold-solves run tens of
// seconds). Give /v1/fetch a long, bounded, env-overridable timeout
// instead of inheriting the runtime default.
const DEFAULT_FETCH_TIMEOUT_MS = 120_000;

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

type SchemaRequestArgs = {
  domain: string;
  task: string;
  read_or_write: "read" | "write" | "read_write";
  auth_shape: string;
  output_shape: string;
  failure_mode: string;
  source_url?: string;
  requester_agent?: string;
  requester_contact?: string;
  idempotency_key?: string;
};

type FetchSchemaArgs = {
  site: string;
  endpoint: string;
  params?: Record<string, unknown>;
};

type ApiClientOptions = {
  apiBase?: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
};

export class HermaiApiClient {
  private readonly apiBase: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ApiClientOptions = {}) {
    this.apiBase = trimTrailingSlash(options.apiBase || env("HERMAI_API_BASE", "HERMAI_PLATFORM_URL") || DEFAULT_API_BASE);
    this.apiKey = options.apiKey || env("HERMAI_API_KEY", "HERMAI_PLATFORM_KEY") || "";
    this.fetchImpl = options.fetchImpl || fetch;
  }

  hasApiKey(): boolean {
    return this.apiKey.length > 0;
  }

  private async send(
    method: string,
    path: string,
    body: unknown,
    headers: Record<string, string>,
    timeoutMs?: number,
  ): Promise<{ ok: boolean; status: number; text: string; decoded: unknown }> {
    const init: RequestInit = {
      method,
      headers: {
        ...headers,
      },
    };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
      (init.headers as Record<string, string>)["Content-Type"] = "application/json";
    }
    if (this.apiKey) {
      (init.headers as Record<string, string>).Authorization = `Bearer ${this.apiKey}`;
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    if (timeoutMs && timeoutMs > 0) {
      const controller = new AbortController();
      timer = setTimeout(() => controller.abort(), timeoutMs);
      init.signal = controller.signal;
    }

    try {
      const response = await this.fetchImpl(`${this.apiBase}${path}`, init);
      const text = await response.text();
      const decoded = text ? parseJson(text, response.status, method, path) : undefined;
      return { ok: response.ok, status: response.status, text, decoded };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`Hermai API ${method} ${path} timed out after ${timeoutMs}ms`);
      }
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<unknown> {
    const { ok, status, text, decoded } = await this.send(method, path, body, headers);

    if (!ok) {
      throw new Error(`Hermai API ${method} ${path} returned ${status}: ${text}`);
    }

    if (isRecord(decoded) && typeof decoded.success === "boolean") {
      if (!decoded.success) {
        throw new Error(`Hermai API error: ${JSON.stringify(decoded.error ?? decoded)}`);
      }
      if ("data" in decoded) {
        return decoded.data;
      }
    }
    return decoded;
  }

  // callEnvelope returns the full {success, data, error, meta, warnings}
  // envelope without unwrapping data, so callers can surface meta
  // (credits, latency, cached) and structured failures. A success:false
  // response is returned, not thrown — the caller decides how to present it.
  async callEnvelope(
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
    timeoutMs?: number,
  ): Promise<Record<string, unknown>> {
    const { status, text, decoded } = await this.send(method, path, body, headers, timeoutMs);

    if (isRecord(decoded) && typeof decoded.success === "boolean") {
      return decoded;
    }

    throw new Error(`Hermai API ${method} ${path} returned ${status}: ${text}`);
  }
}

export function createServer(client = new HermaiApiClient()): McpServer {
  const server = new McpServer({
    name: "hermai-mcp",
    version: SERVER_VERSION,
  });

  server.registerTool(
    "lookup_schema",
    {
      title: "Look up a Hermai schema",
      description: "Search Hermai for a schema by domain, task, category, or verification state. Read-only.",
      inputSchema: {
        domain: z.string().optional().describe("Exact domain, for example allbirds.com."),
        task: z.string().optional().describe("Natural-language task or workflow description."),
        category: z.string().optional().describe("Optional schema category filter."),
        verified: z.boolean().optional().describe("Only return verified schemas."),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args) => apiTool(() => lookupSchema(client, args)),
  );

  server.registerTool(
    "list_public_schemas",
    {
      title: "List public Hermai schemas",
      description: "List public schemas in the Hermai registry with optional filters. Read-only.",
      inputSchema: {
        q: z.string().optional().describe("Free-text search query."),
        category: z.string().optional().describe("Optional category filter."),
        verified: z.boolean().optional().describe("Only return verified schemas."),
        sort: z.string().optional().describe("Sort order, for example trending, recently_verified, or recent."),
        limit: z.number().int().min(1).max(50).optional().describe("Maximum number of schemas to return."),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args) => apiTool(() => listPublicSchemas(client, args)),
  );

  server.registerTool(
    "submit_schema_request",
    {
      title: "Submit a schema request",
      description:
        "Submit the six-field intake for a missing or brittle browser workflow. Never include cookies, API keys, or private session data.",
      inputSchema: {
        domain: z.string().min(1).describe("Exact domain that agents need data from."),
        task: z.string().min(1).describe("Recurring task the agent is trying to perform."),
        read_or_write: z.enum(["read", "write", "read_write"]).describe("Whether the workflow reads data, writes data, or both."),
        auth_shape: z.string().min(1).describe("Authentication shape, for example public, anonymous, login required, OAuth, or owner-approved."),
        output_shape: z.string().min(1).describe("Specific fields or JSON shape the agent needs."),
        failure_mode: z.string().min(1).describe("What breaks today: selector drift, timeout, captcha, stale values, API shape change, etc."),
        source_url: z.string().optional().describe("Optional public thread, issue, or page where this request came from."),
        requester_agent: z.string().optional().describe("Optional agent or builder identifier."),
        requester_contact: z.string().optional().describe("Optional contact. Do not include secrets."),
        idempotency_key: z.string().optional().describe("Optional stable key for retry-safe submits."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async (args) => apiTool(() => submitSchemaRequest(client, args as SchemaRequestArgs)),
  );

  server.registerTool(
    "classify_browser_workflow",
    {
      title: "Classify a browser workflow",
      description: "Classify a prose workflow as direct API, hidden endpoint, browser-only, or needs owner/auth. Read-only and local.",
      inputSchema: {
        prose: z.string().min(1).describe("Post, issue, or user request describing the workflow."),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args) => {
      const classification = classifyWorkflow(args.prose);
      return textToolResult(`Workflow classification: ${classification.likely_path}`, classification);
    },
  );

  server.registerTool(
    "check_schema_request_status",
    {
      title: "Check schema request status",
      description: "Check the status of a previously submitted Hermai schema request. Read-only.",
      inputSchema: {
        request_id: z.string().min(1).describe("Schema request id returned by submit_schema_request."),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args) => apiTool(() => client.call("GET", `/v1/schema-requests/${encodeURIComponent(args.request_id)}`)),
  );

  // Execution is key-gated: only expose fetch_schema when a key is
  // present, so the keyless install stays a free, read-only,
  // zero-billing surface. /v1/fetch authenticates and consumes credits.
  if (client.hasApiKey()) {
    server.registerTool(
      "fetch_schema",
      {
        title: "Fetch data through a Hermai schema",
        description:
          "Execute a registered Hermai schema and return live data through hosted /v1/fetch. Read workflows only (do not use for write workflows). Requires HERMAI_API_KEY (or HERMAI_PLATFORM_KEY) and consumes Hermai credits: a standard call costs 1 credit, some higher cost sites cost 5, and only successful calls are billed. If the workspace is out of credits the call returns a 402 whose error carries upgrade_to and upgrade_url. Resolve the exact site + endpoint first with lookup_schema, then pass endpoint params here.",
        inputSchema: {
          site: z.string().min(1).describe("Registered site/host, for example wegmans.com. Resolve via lookup_schema."),
          endpoint: z
            .string()
            .min(1)
            .describe("Endpoint name from the schema, for example product_search. Case-sensitive; resolve via lookup_schema."),
          params: z
            .record(z.string(), z.unknown())
            .optional()
            .describe("Endpoint parameters as key/value pairs, as defined by the schema."),
        },
        // Not readOnly: every call consumes Hermai credits (a side effect),
        // so clients must not treat it as free to auto-invoke or cache.
        annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: true },
      },
      async (args) => fetchSchemaTool(client, args as FetchSchemaArgs),
    );
  }

  return server;
}

export async function lookupSchema(client: HermaiApiClient, args: {
  domain?: string;
  task?: string;
  category?: string;
  verified?: boolean;
}): Promise<unknown> {
  const domain = clean(args.domain).toLowerCase();
  const task = clean(args.task);
  const category = clean(args.category);

  if (domain && !task && !category) {
    return client.call("GET", `/v1/schemas/${encodeURIComponent(domain)}`);
  }

  const query = new URLSearchParams();
  const q = [domain, task].filter(Boolean).join(" ");
  if (q) query.set("q", q);
  if (category) query.set("category", category);
  if (typeof args.verified === "boolean") query.set("verified", String(args.verified));
  const suffix = query.toString();
  return client.call("GET", `/v1/schemas${suffix ? `?${suffix}` : ""}`);
}

export async function listPublicSchemas(client: HermaiApiClient, args: {
  q?: string;
  category?: string;
  verified?: boolean;
  sort?: string;
  limit?: number;
}): Promise<unknown> {
  const query = new URLSearchParams();
  for (const key of ["q", "category", "sort"] as const) {
    const value = clean(args[key]);
    if (value) query.set(key, value);
  }
  if (typeof args.verified === "boolean") query.set("verified", String(args.verified));
  if (args.limit && args.limit > 0) query.set("limit", String(Math.min(args.limit, 50)));
  const suffix = query.toString();
  return client.call("GET", `/v1/schemas${suffix ? `?${suffix}` : ""}`);
}

export async function submitSchemaRequest(client: HermaiApiClient, args: SchemaRequestArgs): Promise<unknown> {
  const body = buildSchemaRequestBody(args);
  return client.call("POST", "/v1/schema-requests?utm_source=mcp&utm_medium=tool&utm_campaign=mcp_server", body, {
    "Idempotency-Key": schemaRequestIdempotencyKey(args),
  });
}

export function buildSchemaRequestBody(args: SchemaRequestArgs): Record<string, string> {
  const body: Record<string, string> = {
    domain: clean(args.domain).toLowerCase(),
    task: clean(args.task),
    read_or_write: clean(args.read_or_write),
    auth_shape: clean(args.auth_shape),
    output_shape: clean(args.output_shape),
    failure_mode: clean(args.failure_mode),
    source: "mcp",
    utm_source: "mcp",
    utm_medium: "tool",
    utm_campaign: "mcp_server",
  };
  for (const key of ["source_url", "requester_agent", "requester_contact"] as const) {
    const value = clean(args[key]);
    if (value) body[key] = value;
  }
  return body;
}

export async function fetchSchema(
  client: HermaiApiClient,
  args: FetchSchemaArgs,
  timeoutMs: number = fetchTimeoutMs(),
): Promise<Record<string, unknown>> {
  const body: Record<string, unknown> = {
    site: clean(args.site).toLowerCase(),
    endpoint: clean(args.endpoint),
  };
  if (isRecord(args.params)) {
    body.params = args.params;
  }
  return client.callEnvelope("POST", "/v1/fetch", body, {}, timeoutMs);
}

export async function fetchSchemaTool(client: HermaiApiClient, args: FetchSchemaArgs): Promise<ToolResult> {
  let envelope: Record<string, unknown>;
  try {
    envelope = await fetchSchema(client, args);
  } catch (error) {
    return textToolError(error instanceof Error ? error.message : String(error));
  }

  const meta = isRecord(envelope.meta) ? envelope.meta : undefined;
  const target = `${clean(args.site).toLowerCase()}/${clean(args.endpoint)}`;

  if (envelope.success === false) {
    const err = isRecord(envelope.error) ? envelope.error : undefined;
    const code = err && typeof err.code === "string" ? err.code : "FETCH_FAILED";
    const message = err && typeof err.message === "string" ? err.message : "Fetch failed.";
    // pricing-v2: preserve the structured upgrade path the gateway attaches
    // to entitlement 402s instead of flattening the error to {code,message}.
    // Forward whichever of these string fields the backend sent so an agent
    // can act on the denial (upgrade_to = target plan/addon, upgrade_url =
    // where to resolve it).
    const structuredError: Record<string, unknown> = { code, message };
    for (const key of ["upgrade_to", "upgrade_url", "reason", "cause"] as const) {
      const value = err && err[key];
      if (typeof value === "string" && value) structuredError[key] = value;
    }
    const upgradeUrl =
      typeof structuredError.upgrade_url === "string" ? structuredError.upgrade_url : undefined;
    const upgradeSuffix = upgradeUrl ? `\nUpgrade: ${upgradeUrl}` : "";
    return {
      content: [
        {
          type: "text",
          text: `Fetch failed for ${target} (${code}): ${message}${formatMetaSuffix(meta)}${upgradeSuffix}`,
        },
      ],
      structuredContent: { success: false, error: structuredError, meta },
      isError: true,
    };
  }

  const data = "data" in envelope ? envelope.data : null;
  return {
    content: [{ type: "text", text: `Fetched ${target}${formatMetaSuffix(meta)}\n\n${JSON.stringify(data ?? null, null, 2)}` }],
    structuredContent: { success: true, data: data ?? null, meta },
  };
}

// formatMetaSuffix renders the billing/latency fields the gateway returns
// in meta. Only code/message/cached/credits_used/latency_ms are part of
// the public fetch contract; credits_remaining is included when present.
function formatMetaSuffix(meta?: Record<string, unknown>): string {
  if (!meta) return "";
  const parts: string[] = [];
  if (typeof meta.credits_used === "number") parts.push(`credits_used=${meta.credits_used}`);
  if (typeof meta.credits_remaining === "number") parts.push(`credits_remaining=${meta.credits_remaining}`);
  if (typeof meta.latency_ms === "number") parts.push(`latency_ms=${meta.latency_ms}`);
  if (typeof meta.cached === "boolean") parts.push(`cached=${meta.cached}`);
  return parts.length ? ` [${parts.join(", ")}]` : "";
}

function fetchTimeoutMs(): number {
  const raw = env("HERMAI_FETCH_TIMEOUT_MS");
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_FETCH_TIMEOUT_MS;
}

export function classifyWorkflow(prose: string): Record<string, unknown> {
  const lower = prose.toLowerCase();
  const scores = {
    direct_api: countMatches(lower, /\b(api|json|graphql|rss|sitemap|openapi|endpoint|xhr|network tab)\b/g),
    hidden_endpoint: countMatches(lower, /\b(scrap|selector|dom|html|browser automation|response shape|field disappeared|drift|parse|null)\b/g),
    needs_owner: countMatches(lower, /\b(login|authenticated|private|cookie|oauth|portal|owner|credential|session)\b/g),
    browser_only: countMatches(lower, /\b(captcha|recaptcha|datadome|cloudflare|click|canvas|webgl|human verification)\b/g),
  };

  let likelyPath = "needs_more_fields";
  let best = 0;
  for (const key of ["needs_owner", "browser_only", "direct_api", "hidden_endpoint"] as const) {
    if (scores[key] > best) {
      best = scores[key];
      likelyPath = key;
    }
  }

  const missing = missingIntakeFields(lower);
  return {
    likely_path: likelyPath,
    scores,
    missing_intake_fields: missing,
    next_question: nextIntakeQuestion(missing),
    safety_note: "Never include cookies, API keys, bearer tokens, or private session data in public schema requests.",
  };
}

export function missingIntakeFields(lower: string): string[] {
  const missing: string[] = [];
  if (!/\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+\b/.test(lower)) {
    missing.push("domain");
  }
  if (!/\b(read|write|fetch|extract|monitor|post|update|submit|create|delete)\b/.test(lower)) {
    missing.push("read_or_write");
  }
  if (!/\b(public|anonymous|authenticated|login|private|cookie|oauth|api key|credential)\b/.test(lower)) {
    missing.push("auth_shape");
  }
  if (!/\b(fields?|json|columns?|output|schema|prices?|name|status|id|url|date|total)\b/.test(lower)) {
    missing.push("output_shape");
  }
  if (!/\b(broke|break|breaking|drift|timeout|captcha|selector|null|stale|failed|failure|rate limit|403|429|500)\b/.test(lower)) {
    missing.push("failure_mode");
  }
  return missing;
}

export function nextIntakeQuestion(missing: string[]): string {
  if (missing.length === 0) {
    return "The intake looks complete enough to submit as a schema request.";
  }
  return `Ask for: ${missing.slice(0, 3).join(", ")}.`;
}

export function schemaRequestIdempotencyKey(args: SchemaRequestArgs): string {
  const explicit = clean(args.idempotency_key);
  if (explicit) return explicit;
  const digest = createHash("sha256").update(JSON.stringify(args)).digest("hex");
  return `mcp_${digest.slice(0, 32)}`;
}

async function apiTool(call: () => Promise<unknown>): Promise<ToolResult> {
  try {
    const data = await call();
    return textToolResult("Hermai API response", data);
  } catch (error) {
    return textToolError(error instanceof Error ? error.message : String(error));
  }
}

function textToolResult(text: string, structuredContent: unknown): ToolResult {
  const normalized = isRecord(structuredContent) ? structuredContent : { data: structuredContent };
  return {
    content: [{ type: "text", text: `${text}\n\n${JSON.stringify(structuredContent, null, 2)}` }],
    structuredContent: normalized,
  };
}

function textToolError(message: string): ToolResult {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

function parseJson(text: string, status: number, method: string, path: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`decoding Hermai response status ${status} for ${method} ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function countMatches(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function env(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  return "";
}

async function main(): Promise<void> {
  const server = createServer();
  await server.connect(new StdioServerTransport());
}

export function isCliEntrypoint(metaUrl: string, argvPath: string | undefined): boolean {
  if (!argvPath) return false;
  try {
    return realpathSync(fileURLToPath(metaUrl)) === realpathSync(argvPath);
  } catch {
    return false;
  }
}

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
