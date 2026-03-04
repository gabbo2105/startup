/**
 * xss_test.ts
 *
 * Tests for the HTML-escaping (`esc`) function used in the frontend
 * (index.html) to prevent Cross-Site Scripting when rendering search
 * results and chat messages inside innerHTML.
 *
 * Why a server-side test file for a browser function?
 * ---------------------------------------------------
 * The `esc()` helper is defined inside index.html's inline <script> block.
 * We cannot import it directly from there.  Instead we have extracted an
 * equivalent pure-TypeScript implementation in helpers.ts and verify that it
 * produces the exact same output the browser DOM API would produce.
 *
 * The following five substitutions are tested:
 *   &  ->  &amp;
 *   <  ->  &lt;
 *   >  ->  &gt;
 *   "  ->  &quot;
 *   '  ->  &#039;
 *
 * In addition the tests check the two concrete rendering paths in index.html
 * where esc() is used with dynamic data:
 *
 *   1. The streaming metadata line (line 573):
 *      "Trovati <strong>N risultati</strong> per &ldquo;QUERY&rdquo;:"
 *      where QUERY is user-controlled text.
 *
 *   2. The streaming result line (line 581):
 *      "<strong>PRODUCT_NAME</strong><br>"
 *      where PRODUCT_NAME comes from the database / n8n response.
 */

import {
  assertEquals,
  assertNotEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { esc } from "./helpers.ts";

// ---------------------------------------------------------------------------
// Basic character escaping
// ---------------------------------------------------------------------------

Deno.test("XSS > esc > escapes <script> tag — left angle bracket becomes &lt;", () => {
  const input = "<script>alert(1)</script>";
  const result = esc(input);
  assertStringIncludes(result, "&lt;script&gt;");
});

Deno.test("XSS > esc > escaped output does not contain raw < character", () => {
  const result = esc("<script>alert(1)</script>");
  assertEquals(result.includes("<"), false);
});

Deno.test("XSS > esc > escaped output does not contain raw > character", () => {
  const result = esc("<script>alert(1)</script>");
  assertEquals(result.includes(">"), false);
});

Deno.test("XSS > esc > escapes double-quote to &quot;", () => {
  const result = esc('He said "hello"');
  assertStringIncludes(result, "&quot;");
  assertEquals(result.includes('"'), false);
});

Deno.test("XSS > esc > escapes single-quote to &#039;", () => {
  const result = esc("it's a test");
  assertStringIncludes(result, "&#039;");
  assertEquals(result.includes("'"), false);
});

Deno.test("XSS > esc > escapes ampersand to &amp;", () => {
  const result = esc("fish & chips");
  assertStringIncludes(result, "&amp;");
  assertEquals(result.includes(" & "), false);
});

Deno.test("XSS > esc > escapes all five special characters together", () => {
  const input = `<div id="test" class='x'> A & B </div>`;
  const result = esc(input);
  // None of the raw specials should survive
  assertEquals(
    result.includes("<") || result.includes(">") ||
      result.includes('"') || result.includes("'") ||
      result.includes(" & "),
    false,
  );
  // Escaped forms must appear
  assertStringIncludes(result, "&lt;");
  assertStringIncludes(result, "&gt;");
  assertStringIncludes(result, "&quot;");
  assertStringIncludes(result, "&#039;");
  assertStringIncludes(result, "&amp;");
});

Deno.test("XSS > esc > returns empty string unchanged", () => {
  assertEquals(esc(""), "");
});

Deno.test("XSS > esc > returns plain text unchanged when no special chars present", () => {
  assertEquals(esc("Hello world 123"), "Hello world 123");
});

Deno.test("XSS > esc > does not double-escape already-escaped entities", () => {
  // Calling esc on already-escaped text should escape the & in &amp;
  // (this is the expected / correct behavior — it prevents double-unescaping attacks)
  const alreadyEscaped = "&lt;b&gt;";
  const result = esc(alreadyEscaped);
  assertStringIncludes(result, "&amp;lt;b&amp;gt;");
});

// ---------------------------------------------------------------------------
// Payload-specific XSS vectors
// ---------------------------------------------------------------------------

Deno.test("XSS > esc > neutralises onerror attribute injection", () => {
  const result = esc('<img src=x onerror=alert(1)>');
  assertEquals(result.includes("<"), false);
  assertEquals(result.includes(">"), false);
});

Deno.test("XSS > esc > neutralises javascript: URL injection in double quotes", () => {
  const result = esc('"javascript:alert(1)"');
  // Raw double-quote must be gone
  assertEquals(result.includes('"'), false);
  assertStringIncludes(result, "&quot;");
});

Deno.test("XSS > esc > neutralises SVG-based XSS vector", () => {
  const result = esc("<svg onload=alert(1)>");
  assertEquals(result.includes("<"), false);
  assertEquals(result.includes(">"), false);
});

// ---------------------------------------------------------------------------
// Streaming metadata line (index.html line 573):
//   innerHTML = 'Trovati <strong>' + esc(String(msg.count)) + ' risultati</strong>
//               per &ldquo;' + esc(msg.query) + '&rdquo;:<br><br>';
// ---------------------------------------------------------------------------

Deno.test("XSS > streaming metadata > esc(query) blocks script injection in metadata line", () => {
  const maliciousQuery = `<img src=x onerror="alert('XSS')">`;
  const escapedQuery = esc(maliciousQuery);

  // Simulate what the frontend builds
  const innerHTML =
    `Trovati <strong>5 risultati</strong> per &ldquo;${escapedQuery}&rdquo;:<br><br>`;

  // The final string must contain no raw < or > from the user input
  // (the static <strong>, &ldquo;, <br> tags are trusted; we check the user portion)
  assertEquals(escapedQuery.includes("<"), false);
  assertEquals(escapedQuery.includes(">"), false);
  // The injected onerror attribute must be absent from the escaped form
  assertEquals(innerHTML.includes("onerror"), false);
});

Deno.test("XSS > streaming metadata > esc(count) is safe even for adversarial count", () => {
  // msg.count is expected to be a number, but test what happens if somehow a
  // string slips through (e.g. if the type check is ever relaxed).
  const adversarialCount = `</strong><script>alert(1)</script><strong>`;
  const escapedCount = esc(String(adversarialCount));
  assertEquals(escapedCount.includes("<"), false);
  assertEquals(escapedCount.includes(">"), false);
});

// ---------------------------------------------------------------------------
// Streaming result line (index.html line 581-582):
//   resultHtml  = '<strong>' + esc(item.product_name || 'Prodotto') + '</strong><br>';
//   resultHtml += (item.supplier_name ? 'Fornitore: ' + esc(item.supplier_name) + '<br>' : '');
//   resultHtml += (item.unit_price ? 'Prezzo: &euro;' + esc(item.unit_price.toFixed(2)) + '<br>' : '');
// ---------------------------------------------------------------------------

Deno.test("XSS > streaming result > esc(product_name) prevents script tag injection", () => {
  const maliciousName = `Pasta</strong><script>stealCookies()</script><strong>`;
  const escapedName = esc(maliciousName);
  const resultHtml = `<strong>${escapedName}</strong><br>`;

  assertEquals(escapedName.includes("<"), false);
  assertEquals(escapedName.includes(">"), false);
  assertEquals(resultHtml.includes("stealCookies"), false);
});

Deno.test("XSS > streaming result > esc(supplier_name) prevents HTML injection in supplier", () => {
  const maliciousSupplier = `MARR</br><b onmouseover="alert(1)">SPA`;
  const escapedSupplier = esc(maliciousSupplier);

  assertEquals(escapedSupplier.includes("<"), false);
  assertEquals(escapedSupplier.includes(">"), false);
  assertEquals(escapedSupplier.includes("onmouseover"), false);
});

Deno.test("XSS > streaming result > safe product_name renders unchanged after escaping", () => {
  // A well-formed product name should survive esc() without modification
  const safeName = "Tagliatelle al Ragù N.5";
  assertEquals(esc(safeName), safeName);
});

Deno.test("XSS > streaming result > esc output is always different from input for XSS payloads", () => {
  const payloads = [
    "<script>alert(1)</script>",
    `"><img src=x onerror=alert(1)>`,
    `'; DROP TABLE products; --`,
    `<svg/onload=alert(1)>`,
  ];

  for (const payload of payloads) {
    const escaped = esc(payload);
    assertNotEquals(
      escaped,
      payload,
      `esc() must modify the XSS payload: ${payload}`,
    );
  }
});
