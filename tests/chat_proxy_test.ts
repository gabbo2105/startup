/**
 * chat_proxy_test.ts
 *
 * Tests for the n8n chat proxy endpoint (chat_proxy.ts).
 *
 * Architecture note
 * -----------------
 * chat_proxy.ts calls Deno.serve() at the module top level, so it cannot be
 * imported directly without binding to a port.  The test suite therefore uses
 * two layers:
 *
 *   1. Unit tests — exercise extracted helper logic from helpers.ts. These
 *      cover the jsonError factory function and the static corsHeaders object.
 *
 *   2. Integration tests — send real HTTP requests to the deployed function.
 *      They are gated behind env-var guards and are silently skipped when
 *      the variables are not set, so unit tests always pass in CI.
 *
 * Running the full suite locally:
 *   CHAT_PROXY_URL=https://xxx.supabase.co/functions/v1/chat-proxy \
 *   VALID_JWT=<user JWT> \
 *   deno test --allow-env --allow-net --allow-read tests/chat_proxy_test.ts
 *
 * Running only unit tests (no secrets required):
 *   deno test --allow-env --allow-net --allow-read tests/chat_proxy_test.ts
 */

import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { chatProxyCorsHeaders, jsonError } from "./helpers.ts";

// ---------------------------------------------------------------------------
// UNIT TESTS — pure helpers, no network, no env vars
// ---------------------------------------------------------------------------

Deno.test("Unit > chatProxyCorsHeaders > Allow-Origin is wildcard *", () => {
  assertEquals(chatProxyCorsHeaders["Access-Control-Allow-Origin"], "*");
});

Deno.test("Unit > chatProxyCorsHeaders > Allow-Headers includes authorization", () => {
  assertStringIncludes(
    chatProxyCorsHeaders["Access-Control-Allow-Headers"],
    "authorization",
  );
});

Deno.test("Unit > chatProxyCorsHeaders > Allow-Headers includes content-type", () => {
  assertStringIncludes(
    chatProxyCorsHeaders["Access-Control-Allow-Headers"],
    "content-type",
  );
});

Deno.test("Unit > chatProxyCorsHeaders > Allow-Methods includes POST and OPTIONS", () => {
  assertStringIncludes(chatProxyCorsHeaders["Access-Control-Allow-Methods"], "POST");
  assertStringIncludes(chatProxyCorsHeaders["Access-Control-Allow-Methods"], "OPTIONS");
});

Deno.test("Unit > jsonError > builds Response with correct status code", async () => {
  const res = jsonError("Unauthorized", 401);
  assertEquals(res.status, 401);
  await res.body?.cancel();
});

Deno.test("Unit > jsonError > Response body is valid JSON containing error key", async () => {
  const res = jsonError("Something went wrong", 500);
  const body = await res.json();
  assertEquals(body.error, "Something went wrong");
});

Deno.test("Unit > jsonError > Content-Type header is application/json", () => {
  const res = jsonError("bad request", 400);
  assertEquals(res.headers.get("Content-Type"), "application/json");
});

Deno.test("Unit > jsonError > CORS headers are included in the response", () => {
  const res = jsonError("bad request", 400);
  assertEquals(
    res.headers.get("Access-Control-Allow-Origin"),
    "*",
  );
});

// ---------------------------------------------------------------------------
// INTEGRATION TESTS — require a deployed Supabase edge function
//
// Environment variables required:
//   CHAT_PROXY_URL  — e.g. https://xxx.supabase.co/functions/v1/chat-proxy
//   VALID_JWT       — a valid, non-expired user JWT for the project
// ---------------------------------------------------------------------------

const CHAT_PROXY_URL = Deno.env.get("CHAT_PROXY_URL") ?? "";
const VALID_JWT = Deno.env.get("VALID_JWT") ?? "";
const integrationEnabled = CHAT_PROXY_URL.length > 0 && VALID_JWT.length > 0;

function itSkipIfNoIntegration(name: string, fn: () => Promise<void>): void {
  if (!integrationEnabled) {
    Deno.test({
      name: `[SKIPPED — set CHAT_PROXY_URL + VALID_JWT to run] ${name}`,
      fn: () => {},
      ignore: true,
    });
    return;
  }
  Deno.test(name, fn);
}

// --- Auth tests ---

itSkipIfNoIntegration(
  "Integration > Auth > returns 204 for OPTIONS preflight",
  async () => {
    const res = await fetch(CHAT_PROXY_URL, {
      method: "OPTIONS",
      headers: { Origin: "https://myapp.com" },
    });
    assertEquals(res.status, 204);
    await res.body?.cancel();
  },
);

itSkipIfNoIntegration(
  "Integration > Auth > OPTIONS response contains CORS Allow-Origin header",
  async () => {
    const res = await fetch(CHAT_PROXY_URL, {
      method: "OPTIONS",
    });
    // chat_proxy.ts uses a static "*" origin
    assertEquals(res.headers.get("Access-Control-Allow-Origin"), "*");
    await res.body?.cancel();
  },
);

itSkipIfNoIntegration(
  "Integration > Auth > returns 401 when no Authorization header is provided",
  async () => {
    const res = await fetch(CHAT_PROXY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatInput: "hello", sessionId: "test-session-1" }),
    });
    assertEquals(res.status, 401);
    const body = await res.json();
    assertStringIncludes(body.error.toLowerCase(), "authorization");
  },
);

itSkipIfNoIntegration(
  "Integration > Auth > returns 401 when Authorization header has no Bearer prefix",
  async () => {
    const res = await fetch(CHAT_PROXY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Token not-a-bearer-token",
      },
      body: JSON.stringify({ chatInput: "hello", sessionId: "test-session-2" }),
    });
    assertEquals(res.status, 401);
    const body = await res.json();
    assertStringIncludes(body.error.toLowerCase(), "authorization");
  },
);

itSkipIfNoIntegration(
  "Integration > Auth > returns 401 when Bearer token is invalid",
  async () => {
    const res = await fetch(CHAT_PROXY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization:
          "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.INVALID",
      },
      body: JSON.stringify({ chatInput: "hello", sessionId: "test-session-3" }),
    });
    assertEquals(res.status, 401);
    const body = await res.json();
    assertStringIncludes(body.error.toLowerCase(), "unauthorized");
  },
);

// --- Input validation tests ---

itSkipIfNoIntegration(
  "Integration > Validation > returns 400 when chatInput field is missing",
  async () => {
    const res = await fetch(CHAT_PROXY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${VALID_JWT}`,
      },
      body: JSON.stringify({ sessionId: "test-session-4" }),
    });
    assertEquals(res.status, 400);
    const body = await res.json();
    assertStringIncludes(body.error.toLowerCase(), "chatinput");
  },
);

itSkipIfNoIntegration(
  "Integration > Validation > returns 400 when chatInput is an empty string",
  async () => {
    const res = await fetch(CHAT_PROXY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${VALID_JWT}`,
      },
      body: JSON.stringify({ chatInput: "   ", sessionId: "test-session-5" }),
    });
    assertEquals(res.status, 400);
    const body = await res.json();
    assertStringIncludes(body.error.toLowerCase(), "chatinput");
  },
);

itSkipIfNoIntegration(
  "Integration > Validation > returns 400 when chatInput exceeds 2000 characters",
  async () => {
    const longInput = "x".repeat(2001);
    const res = await fetch(CHAT_PROXY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${VALID_JWT}`,
      },
      body: JSON.stringify({ chatInput: longInput, sessionId: "test-session-6" }),
    });
    assertEquals(res.status, 400);
    const body = await res.json();
    assertStringIncludes(body.error.toLowerCase(), "2000");
  },
);

itSkipIfNoIntegration(
  "Integration > Validation > accepts chatInput of exactly 2000 characters (boundary value)",
  async () => {
    const boundaryInput = "x".repeat(2000);
    const res = await fetch(CHAT_PROXY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${VALID_JWT}`,
      },
      body: JSON.stringify({ chatInput: boundaryInput, sessionId: "test-session-7" }),
    });
    // Must NOT reject with 400 for input validation
    const notInputValidationError = res.status !== 400;
    assertEquals(
      notInputValidationError,
      true,
      `Expected non-400 but got ${res.status}`,
    );
    await res.body?.cancel();
  },
);

itSkipIfNoIntegration(
  "Integration > Validation > returns 400 when sessionId is missing",
  async () => {
    const res = await fetch(CHAT_PROXY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${VALID_JWT}`,
      },
      body: JSON.stringify({ chatInput: "Ciao!" }),
    });
    assertEquals(res.status, 400);
    const body = await res.json();
    assertStringIncludes(body.error.toLowerCase(), "sessionid");
  },
);

itSkipIfNoIntegration(
  "Integration > Validation > returns 400 when sessionId is an empty string",
  async () => {
    const res = await fetch(CHAT_PROXY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${VALID_JWT}`,
      },
      body: JSON.stringify({ chatInput: "Ciao!", sessionId: "   " }),
    });
    assertEquals(res.status, 400);
    const body = await res.json();
    assertStringIncludes(body.error.toLowerCase(), "sessionid");
  },
);

itSkipIfNoIntegration(
  "Integration > Validation > returns 400 for malformed JSON body",
  async () => {
    const res = await fetch(CHAT_PROXY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${VALID_JWT}`,
      },
      body: "{this is not valid json",
    });
    assertEquals(res.status, 400);
    const body = await res.json();
    assertStringIncludes(body.error.toLowerCase(), "json");
  },
);

// --- Method tests ---

itSkipIfNoIntegration(
  "Integration > Method > returns 405 for GET requests",
  async () => {
    const res = await fetch(CHAT_PROXY_URL, {
      method: "GET",
      headers: { Authorization: `Bearer ${VALID_JWT}` },
    });
    assertEquals(res.status, 405);
    await res.body?.cancel();
  },
);
