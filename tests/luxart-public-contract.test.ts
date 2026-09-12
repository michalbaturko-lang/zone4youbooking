import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  luxartPublicContractEndpoints,
  verifyLuxartContractDocumentation,
  verifyLuxartPublicContract,
} from "../scripts/verify-luxart-public-contract";

function helpDocument(title: string, fields: readonly string[] = []) {
  return `<!doctype html><html><head><title>${title}</title></head><body><h1>${title}</h1>${fields
    .map((field) => `<td class="parameter-name">${field}</td>`)
    .join("")}</body></html>`;
}

function contractFetch(options: { missingLessonField?: string; redirectLogin?: boolean } = {}) {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = async (url: URL, init?: RequestInit) => {
    requests.push({ url: url.href, init });
    if (url.pathname === "/Help") {
      return new Response(helpDocument("API dokumentace"), { status: 200 });
    }
    const endpoint = luxartPublicContractEndpoints.find((candidate) => candidate.path === url.pathname);
    if (!endpoint) return new Response("", { status: 404 });
    if (options.redirectLogin && endpoint.id === "login") {
      return new Response("", { status: 302, headers: { location: "https://untrusted.example.invalid" } });
    }
    const fields = endpoint.requiredFields.filter(
      (field) => !(endpoint.id === "lessons" && field === options.missingLessonField),
    );
    return new Response(helpDocument(endpoint.title.replaceAll("&", "&amp;"), fields), { status: 200 });
  };
  return { fetchImpl, requests };
}

function fixtureSemanticContractSha256() {
  const observed = luxartPublicContractEndpoints
    .map((endpoint) => ({
      id: endpoint.id,
      title: endpoint.title,
      fields: [...endpoint.requiredFields].sort(),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  return createHash("sha256").update(JSON.stringify(observed)).digest("hex");
}

test("public Luxart contract verifier checks every pilot endpoint without credentials", async () => {
  const fixture = contractFetch();
  const report = await verifyLuxartPublicContract({
    fetchImpl: fixture.fetchImpl,
    now: new Date("2026-09-11T14:00:00.000Z"),
    expectedSemanticContractSha256: fixtureSemanticContractSha256(),
  });

  assert.equal(report.ok, true);
  assert.equal(report.referenceOnly, true);
  assert.equal(report.launchAuthority, false);
  assert.equal(report.expectedEndpointCount, luxartPublicContractEndpoints.length);
  assert.equal(report.verifiedEndpointCount, luxartPublicContractEndpoints.length);
  assert.match(report.semanticContractSha256 ?? "", /^[a-f0-9]{64}$/);
  assert.match(report.targetFingerprintSha256, /^[a-f0-9]{64}$/);
  assert.equal(report.issues.length, 0);
  assert.equal(JSON.stringify(report).includes("api.memberzone.online"), false);

  assert.equal(fixture.requests.length, luxartPublicContractEndpoints.length + 1);
  for (const request of fixture.requests) {
    assert.equal(request.init?.method, "GET");
    assert.equal(request.init?.redirect, "manual");
    const headers = new Headers(request.init?.headers);
    assert.equal(headers.has("authorization"), false);
    assert.equal(headers.has("cookie"), false);
  }
});

test("public Luxart contract verifier fails on a missing Lesson field", async () => {
  const fixture = contractFetch({ missingLessonField: "cislo_salu" });
  const report = await verifyLuxartPublicContract({
    fetchImpl: fixture.fetchImpl,
    expectedSemanticContractSha256: fixtureSemanticContractSha256(),
  });

  assert.equal(report.ok, false);
  assert.deepEqual(report.issues, [{
    endpoint: "lessons",
    code: "MISSING_FIELDS",
    missingFields: ["cislo_salu"],
  }]);
});

test("public Luxart contract verifier rejects redirects and invalid timeouts", async () => {
  const fixture = contractFetch({ redirectLogin: true });
  const report = await verifyLuxartPublicContract({
    fetchImpl: fixture.fetchImpl,
    expectedSemanticContractSha256: fixtureSemanticContractSha256(),
  });
  assert.equal(report.ok, false);
  assert.deepEqual(report.issues, [{ endpoint: "login", code: "HTTP_STATUS", httpStatus: 302 }]);

  await assert.rejects(
    verifyLuxartPublicContract({ fetchImpl: fixture.fetchImpl, timeoutMs: 999 }),
    /1000 to 30000/i,
  );
});

test("public Luxart contract verifier fails closed on semantic contract drift", async () => {
  const fixture = contractFetch();
  const expected = "f".repeat(64);
  const report = await verifyLuxartPublicContract({
    fetchImpl: fixture.fetchImpl,
    expectedSemanticContractSha256: expected,
  });

  assert.equal(report.ok, false);
  assert.deepEqual(report.issues, [{
    endpoint: "contract",
    code: "CONTRACT_DRIFT",
    expectedSha256: expected,
    actualSha256: fixtureSemanticContractSha256(),
  }]);

  await assert.rejects(
    verifyLuxartPublicContract({
      fetchImpl: fixture.fetchImpl,
      expectedSemanticContractSha256: "ABC",
    }),
    /full lowercase SHA-256/i,
  );
});

test("contract documentation verifier binds a clean custom origin and optional gateway header", async () => {
  const fixture = contractFetch();
  const observedOrigins = new Set<string>();
  const observedAuthorization = new Set<string | null>();
  const report = await verifyLuxartContractDocumentation({
    origin: "https://zone4you-api.example.cz:9191",
    expectedSemanticContractSha256: fixtureSemanticContractSha256(),
    requestHeaders: { Authorization: "Bearer gateway-secret" },
    fetchImpl: async (url, init) => {
      observedOrigins.add(url.origin);
      observedAuthorization.add(new Headers(init?.headers).get("authorization"));
      return fixture.fetchImpl(url, init);
    },
  });

  assert.equal(report.ok, true);
  assert.deepEqual([...observedOrigins], ["https://zone4you-api.example.cz:9191"]);
  assert.deepEqual([...observedAuthorization], ["Bearer gateway-secret"]);
  assert.equal(JSON.stringify(report).includes("gateway-secret"), false);
  assert.equal(JSON.stringify(report).includes("zone4you-api.example.cz"), false);

  await assert.rejects(
    verifyLuxartContractDocumentation({
      origin: "https://zone4you-api.example.cz:9191/api",
      fetchImpl: fixture.fetchImpl,
    }),
    /clean HTTP\(S\) origin/i,
  );
  await assert.rejects(
    verifyLuxartContractDocumentation({
      origin: "https://zone4you-api.example.cz:9191",
      requestHeaders: { Cookie: "session=secret" },
      fetchImpl: fixture.fetchImpl,
    }),
    /must not send cookies/i,
  );
  await assert.rejects(
    verifyLuxartContractDocumentation({
      origin: "http://zone4you-api.example.cz:9191",
      requestHeaders: { Authorization: "Bearer gateway-secret" },
      fetchImpl: fixture.fetchImpl,
    }),
    /authentication headers require HTTPS/i,
  );
});
