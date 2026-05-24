import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSchemaRequestBody,
  classifyWorkflow,
  missingIntakeFields,
  nextIntakeQuestion,
  schemaRequestIdempotencyKey,
} from "./index.js";

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
