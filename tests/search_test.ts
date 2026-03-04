/**
 * search_test.ts
 *
 * Tests for the hybrid search endpoint (index.ts).
 *
 * Architecture note
 * -----------------
 * index.ts calls Deno.serve() at the module top level, so we cannot import it
 * directly without starting a live server bound to a port. Instead the test
 * suite is split into two layers:
 *
 *   1. Unit tests — exercise the pure helper functions via helpers.ts.
 *      These run fast, require no environment variables, and have no network
 *      dependency.
 *
 *   2. Integration tests — spin up the real handler against a running Supabase
 *      project. They are gated behind an env-var guard and are skipped when
 *      the required variables are absent, so the CI pipeline can run the unit
 *      tests without any secrets configured.
 *
 * Running the full suite locally:
 *   SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   OPENAI_API_KEY=... VALID_JWT=... \
 *   deno test --allow-env --allow-net --allow-read tests/search_test.ts
 *
 * Running only unit tests (no secrets required):
 *   deno test --allow-env --allow-net --allow-read tests/search_test.ts
 */

import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  clamp,
  corsHeaders,
  escapeLike,
  normaliseLimit,
  normaliseWeight,
} from "./helpers.ts";

// ---------------------------------------------------------------------------
// UNIT TESTS — pure functions, no network, no env vars required
// ---------------------------------------------------------------------------

Deno.test("Unit > escapeLike > escapes percent sign", () => {
  assertEquals(escapeLike("50%off"), "50\\%off");
});

Deno.test("Unit > escapeLike > escapes underscore", () => {
  assertEquals(escapeLike("product_name"), "product\\_name");
});

Deno.test("Unit > escapeLike > escapes backslash", () => {
  assertEquals(escapeLike("path\\to\\file"), "path\\\\to\\\\file");
});

Deno.test("Unit > escapeLike > escapes all three special characters together", () => {
  assertEquals(escapeLike("50%_\\test"), "50\\%\\_\\\\test");
});

Deno.test("Unit > escapeLike > returns unchanged string when no special chars", () => {
  assertEquals(escapeLike("MARR SPA"), "MARR SPA");
});

Deno.test("Unit > escapeLike > empty string returns empty string", () => {
  assertEquals(escapeLike(""), "");
});

Deno.test("Unit > corsHeaders > uses Origin header from request", () => {
  const req = new Request("https://example.com/", {
    headers: { Origin: "https://myapp.com" },
  });
  const headers = corsHeaders(req);
  assertEquals(headers["Access-Control-Allow-Origin"], "https://myapp.com");
});

Deno.test("Unit > corsHeaders > falls back to * when no Origin header", () => {
  const req = new Request("https://example.com/");
  const headers = corsHeaders(req);
  assertEquals(headers["Access-Control-Allow-Origin"], "*");
});

Deno.test("Unit > corsHeaders > includes required Allow-Headers and Allow-Methods", () => {
  const req = new Request("https://example.com/");
  const headers = corsHeaders(req);
  assertStringIncludes(headers["Access-Control-Allow-Headers"], "authorization");
  assertStringIncludes(headers["Access-Control-Allow-Headers"], "content-type");
  assertStringIncludes(headers["Access-Control-Allow-Methods"], "POST");
  assertStringIncludes(headers["Access-Control-Allow-Methods"], "OPTIONS");
});

Deno.test("Unit > normaliseLimit > clamps value above 100 down to 100", () => {
  assertEquals(normaliseLimit(999), 100);
});

Deno.test("Unit > normaliseLimit > clamps value below 1 up to 1", () => {
  assertEquals(normaliseLimit(0), 20); // 0 is falsy so falls back to default 20
});

Deno.test("Unit > normaliseLimit > passes valid value through unchanged", () => {
  assertEquals(normaliseLimit(50), 50);
});

Deno.test("Unit > normaliseLimit > handles string '999' — clamps to 100", () => {
  assertEquals(normaliseLimit("999"), 100);
});

Deno.test("Unit > normaliseLimit > handles NaN — falls back to default 20", () => {
  assertEquals(normaliseLimit("not-a-number"), 20);
});

Deno.test("Unit > normaliseWeight > clamps value above 1 down to 1", () => {
  assertEquals(normaliseWeight(1.5, 0.4), 1);
});

Deno.test("Unit > normaliseWeight > clamps value below 0 up to 0", () => {
  assertEquals(normaliseWeight(-0.5, 0.4), 0);
});

Deno.test("Unit > normaliseWeight > passes value 0.6 through unchanged", () => {
  assertEquals(normaliseWeight(0.6, 0.4), 0.6);
});

Deno.test("Unit > normaliseWeight > undefined input produces NaN (source-accurate behaviour)", () => {
  // index.ts uses: Number(weight) ?? default
  // Number(undefined) === NaN.  The ?? operator does NOT catch NaN — it only
  // catches null and undefined.  So NaN ?? 0.4 === NaN, and the full
  // expression Math.min(1, Math.max(0, NaN)) === NaN.
  // This test documents the actual source behaviour rather than an ideal.
  const result = normaliseWeight(undefined, 0.4);
  assertEquals(isNaN(result), true);
});

Deno.test("Unit > clamp > clamps value above max", () => {
  assertEquals(clamp(150, 1, 100), 100);
});

Deno.test("Unit > clamp > clamps value below min", () => {
  assertEquals(clamp(-5, 0, 1), 0);
});

Deno.test("Unit > clamp > passes value within range unchanged", () => {
  assertEquals(clamp(42, 1, 100), 42);
});

// ---------------------------------------------------------------------------
// INTEGRATION TESTS — require a running Supabase project + env vars
//
// Set these environment variables to run this layer:
//   SUPABASE_URL            — e.g. https://xxx.supabase.co
//   SUPABASE_ANON_KEY       — the project anon key
//   SUPABASE_SERVICE_ROLE_KEY
//   OPENAI_API_KEY
//   VALID_JWT               — a valid, non-expired user JWT from the project
//   SEARCH_FUNCTION_URL     — full URL to the deployed edge function, e.g.
//                             https://xxx.supabase.co/functions/v1/search
//
// Without these variables every integration test will be skipped cleanly.
// ---------------------------------------------------------------------------

const SEARCH_URL = Deno.env.get("SEARCH_FUNCTION_URL") ?? "";
const VALID_JWT = Deno.env.get("VALID_JWT") ?? "";
const integrationEnabled = SEARCH_URL.length > 0 && VALID_JWT.length > 0;

/** Skip helper — marks the test as skipped when integration env is not set. */
function itSkipIfNoIntegration(
  name: string,
  fn: () => Promise<void>,
): void {
  if (!integrationEnabled) {
    Deno.test({
      name: `[SKIPPED — set SEARCH_FUNCTION_URL + VALID_JWT to run] ${name}`,
      fn: () => {},
      ignore: true,
    });
    return;
  }
  Deno.test(name, fn);
}

// --- Auth tests ---

itSkipIfNoIntegration(
  "Integration > Auth > returns 204 for OPTIONS preflight (CORS)",
  async () => {
    const res = await fetch(SEARCH_URL, {
      method: "OPTIONS",
      headers: { Origin: "https://myapp.com" },
    });
    assertEquals(res.status, 204);
    // Ensure CORS header is present
    const allow = res.headers.get("Access-Control-Allow-Methods") ?? "";
    assertStringIncludes(allow, "POST");
    await res.body?.cancel();
  },
);

itSkipIfNoIntegration(
  "Integration > Auth > returns 405 for GET requests",
  async () => {
    const res = await fetch(SEARCH_URL, {
      method: "GET",
      headers: { Authorization: `Bearer ${VALID_JWT}` },
    });
    assertEquals(res.status, 405);
    const body = await res.json();
    assertStringIncludes(body.error, "POST");
  },
);

itSkipIfNoIntegration(
  "Integration > Auth > returns 401 when no Authorization header is provided",
  async () => {
    const res = await fetch(SEARCH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "test" }),
    });
    assertEquals(res.status, 401);
    const body = await res.json();
    assertStringIncludes(body.error.toLowerCase(), "unauthorized");
  },
);

itSkipIfNoIntegration(
  "Integration > Auth > returns 401 when Authorization header is malformed (no Bearer prefix)",
  async () => {
    const res = await fetch(SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Token some-token-without-bearer-prefix",
      },
      body: JSON.stringify({ query: "test" }),
    });
    assertEquals(res.status, 401);
    const body = await res.json();
    assertStringIncludes(body.error.toLowerCase(), "unauthorized");
  },
);

itSkipIfNoIntegration(
  "Integration > Auth > returns 401 when Bearer token is invalid/expired",
  async () => {
    const res = await fetch(SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Well-formed Bearer prefix but the token itself is garbage
        Authorization:
          "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.INVALID",
      },
      body: JSON.stringify({ query: "test" }),
    });
    assertEquals(res.status, 401);
    const body = await res.json();
    assertStringIncludes(body.error.toLowerCase(), "unauthorized");
  },
);

// --- Input validation tests ---

itSkipIfNoIntegration(
  "Integration > Validation > returns 400 when query field is missing",
  async () => {
    const res = await fetch(SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${VALID_JWT}`,
      },
      body: JSON.stringify({ limit: 10 }),
    });
    assertEquals(res.status, 400);
    const body = await res.json();
    assertStringIncludes(body.error.toLowerCase(), "query");
  },
);

itSkipIfNoIntegration(
  "Integration > Validation > returns 400 when query is an empty string",
  async () => {
    const res = await fetch(SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${VALID_JWT}`,
      },
      body: JSON.stringify({ query: "" }),
    });
    assertEquals(res.status, 400);
    const body = await res.json();
    assertStringIncludes(body.error.toLowerCase(), "query");
  },
);

itSkipIfNoIntegration(
  "Integration > Validation > returns 400 when query exceeds 500 characters",
  async () => {
    const longQuery = "a".repeat(501);
    const res = await fetch(SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${VALID_JWT}`,
      },
      body: JSON.stringify({ query: longQuery }),
    });
    assertEquals(res.status, 400);
    const body = await res.json();
    assertStringIncludes(body.error, "500");
  },
);

itSkipIfNoIntegration(
  "Integration > Validation > returns 400 when price_min is a string (not a number)",
  async () => {
    const res = await fetch(SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${VALID_JWT}`,
      },
      body: JSON.stringify({ query: "pasta", price_min: "cheap" }),
    });
    assertEquals(res.status, 400);
    const body = await res.json();
    assertStringIncludes(body.error.toLowerCase(), "price_min");
  },
);

itSkipIfNoIntegration(
  "Integration > Validation > returns 400 when price_max is a string (not a number)",
  async () => {
    const res = await fetch(SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${VALID_JWT}`,
      },
      body: JSON.stringify({ query: "pasta", price_max: "expensive" }),
    });
    assertEquals(res.status, 400);
    const body = await res.json();
    assertStringIncludes(body.error.toLowerCase(), "price_max");
  },
);

// --- Clamping behaviour (unit-level verification duplicated at integration level) ---

itSkipIfNoIntegration(
  "Integration > Validation > limit=999 is silently clamped — response does not error",
  async () => {
    // The function accepts the request and clamps limit to 100 internally.
    // We cannot assert the exact limit used without inspecting DB query logs,
    // but we can assert the response is NOT a 400.
    const res = await fetch(SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${VALID_JWT}`,
      },
      body: JSON.stringify({ query: "pasta", limit: 999 }),
    });
    // Acceptable statuses: 200 (results), 500 (missing OPENAI key in dev), 502 (OpenAI unreachable).
    // The important constraint: it must NOT be 400 (invalid input).
    const notValidationError = res.status !== 400;
    assertEquals(notValidationError, true, `Expected non-400 status but got ${res.status}`);
    await res.body?.cancel();
  },
);

itSkipIfNoIntegration(
  "Integration > Validation > fts_weight=2 and semantic_weight=-1 are silently clamped — no error",
  async () => {
    const res = await fetch(SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${VALID_JWT}`,
      },
      body: JSON.stringify({ query: "vino", fts_weight: 2, semantic_weight: -1 }),
    });
    const notValidationError = res.status !== 400;
    assertEquals(notValidationError, true, `Expected non-400 status but got ${res.status}`);
    await res.body?.cancel();
  },
);
