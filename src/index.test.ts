import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSchemaRequestBody,
  classifyWorkflow,
  fetchSchema,
  fetchSchemaTool,
  HermaiApiClient,
  isCliEntrypoint,
  missingIntakeFields,
  nextIntakeQuestion,
  schemaRequestIdempotencyKey,
} from "./index.js";

type CapturedCall = { url: string; init: RequestInit };

function stubClient(response: unknown, status = 200): { client: HermaiApiClient; calls: CapturedCall[] } {
  const calls: CapturedCall[] = [];
  const fetchImpl = (async (url: unknown, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(response), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
  const client = new HermaiApiClient({ apiKey: "hm_sk_test", apiBase: "https://api.test", fetchImpl });
  return { client, calls };
}

test("buildSchemaRequestBody uses production schema request fields", () => {
  const body = buildSchemaRequestBody({
    domain: "Example.COM/path",
    task: "Fetch product price",
    read_or_write: "read",
    auth_shape: "public",
    output_shape: "{ price, sku }",
    failure_mode: "selector drift",
    source_url: "https://example.com/thread",
    requester_agent: "test-agent",
    requester_contact: "ops@example.com",
  });

  assert.equal(body.domain, "example.com/path");
  assert.equal(body.auth_shape, "public");
  assert.equal(body.source, "mcp");
  assert.equal(body.utm_source, "mcp");
  assert.equal(body.source_url, "https://example.com/thread");
  assert.equal("auth" in body, false);
});

test("classifyWorkflow detects authenticated owner path", () => {
  const result = classifyWorkflow("My agent needs login cookies to fetch status JSON from portal.example.com but selectors keep breaking.");
  assert.equal(result.likely_path, "needs_owner");
  assert.deepEqual(result.missing_intake_fields, []);
});

test("missingIntakeFields reports actionable missing fields", () => {
  assert.deepEqual(missingIntakeFields("fetch prices from example.com"), ["auth_shape", "failure_mode"]);
  assert.equal(nextIntakeQuestion(["auth_shape", "failure_mode"]), "Ask for: auth_shape, failure_mode.");
});

test("schemaRequestIdempotencyKey is stable and overrideable", () => {
  const args = {
    domain: "example.com",
    task: "Fetch product price",
    read_or_write: "read" as const,
    auth_shape: "public",
    output_shape: "{ price }",
    failure_mode: "selector drift",
  };
  assert.equal(schemaRequestIdempotencyKey(args), schemaRequestIdempotencyKey(args));
  assert.match(schemaRequestIdempotencyKey(args), /^mcp_[0-9a-f]{32}$/);
  assert.equal(schemaRequestIdempotencyKey({ ...args, idempotency_key: "custom" }), "custom");
});

test("fetchSchema posts normalized site/endpoint/params with auth and surfaces the full envelope", async () => {
  const { client, calls } = stubClient({
    success: true,
    data: { price: 9.99 },
    meta: { credits_used: 1, credits_remaining: 41, latency_ms: 1234, cached: false },
  });

  const envelope = await fetchSchema(client, { site: "Wegmans.COM", endpoint: "product_search", params: { q: "milk" } }, 5000);

  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/v1\/fetch$/);
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, "Bearer hm_sk_test");
  const body = JSON.parse(String(calls[0].init.body));
  assert.equal(body.site, "wegmans.com");
  assert.equal(body.endpoint, "product_search");
  assert.deepEqual(body.params, { q: "milk" });
  assert.equal(envelope.success, true);
  assert.deepEqual(envelope.data, { price: 9.99 });
  assert.deepEqual(envelope.meta, { credits_used: 1, credits_remaining: 41, latency_ms: 1234, cached: false });
});

test("fetchSchema returns structured failures instead of throwing", async () => {
  const { client } = stubClient(
    { success: false, error: { code: "INSUFFICIENT_CREDITS", message: "insufficient credits" } },
    402,
  );

  const envelope = await fetchSchema(client, { site: "wegmans.com", endpoint: "product_search" }, 5000);

  assert.equal(envelope.success, false);
  assert.deepEqual(envelope.error, { code: "INSUFFICIENT_CREDITS", message: "insufficient credits" });
});

test("fetchSchemaTool surfaces the 402 upgrade path in structuredContent and text", async () => {
  const { client } = stubClient(
    {
      success: false,
      error: {
        code: "INSUFFICIENT_CREDITS",
        message: "insufficient credits",
        upgrade_to: "pro",
        upgrade_url: "https://hermai.ai/pricing",
      },
    },
    402,
  );

  const result = await fetchSchemaTool(client, { site: "wegmans.com", endpoint: "product_search" });

  assert.equal(result.isError, true);
  const err = (result.structuredContent as { error: Record<string, unknown> }).error;
  assert.equal(err.upgrade_to, "pro");
  assert.equal(err.upgrade_url, "https://hermai.ai/pricing");
  // The URL is appended to the human-readable text so a plain text client
  // still sees the next step.
  assert.match(result.content[0].text, /https:\/\/hermai\.ai\/pricing/);
});

test("fetchSchemaTool leaves non-upgrade failures as plain {code,message}", async () => {
  const { client } = stubClient(
    { success: false, error: { code: "SCHEMA_NOT_FOUND", message: "no such endpoint" } },
    404,
  );

  const result = await fetchSchemaTool(client, { site: "wegmans.com", endpoint: "nope" });

  assert.equal(result.isError, true);
  const err = (result.structuredContent as { error: Record<string, unknown> }).error;
  assert.deepEqual(err, { code: "SCHEMA_NOT_FOUND", message: "no such endpoint" });
  assert.doesNotMatch(result.content[0].text, /Upgrade:/);
});

test("hasApiKey gates fetch_schema exposure", () => {
  assert.equal(new HermaiApiClient({ apiKey: "hm_sk_test" }).hasApiKey(), true);

  const savedKey = process.env.HERMAI_API_KEY;
  const savedPlatform = process.env.HERMAI_PLATFORM_KEY;
  delete process.env.HERMAI_API_KEY;
  delete process.env.HERMAI_PLATFORM_KEY;
  try {
    assert.equal(new HermaiApiClient().hasApiKey(), false);
  } finally {
    if (savedKey !== undefined) process.env.HERMAI_API_KEY = savedKey;
    if (savedPlatform !== undefined) process.env.HERMAI_PLATFORM_KEY = savedPlatform;
  }
});

test("isCliEntrypoint tolerates npm bin symlinks", () => {
  const fileUrl = new URL("./index.js", import.meta.url).href;
  assert.equal(isCliEntrypoint(fileUrl, new URL("./index.js", import.meta.url).pathname), true);
  assert.equal(isCliEntrypoint(fileUrl, undefined), false);
});
