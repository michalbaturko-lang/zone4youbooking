import assert from "node:assert/strict";
import test from "node:test";
import {
  luxartSoapPilotGaps,
  luxartSoapRequiredFields,
  luxartSoapRequiredOperations,
  luxartSoapRequiredResponseTables,
  verifyLuxartSoapPublicContract,
} from "../scripts/verify-luxart-soap-public-contract";

function element(name: string, fields: readonly string[]) {
  return `<xs:element name="${name}"><xs:complexType><xs:sequence>${fields
    .map((field) => `<xs:element name="${field}" type="xs:string"/>`)
    .join("")}</xs:sequence></xs:complexType></xs:element>`;
}

function fixtures(options: {
  missingField?: string;
  missingResponseTable?: string;
  redirectWsdl?: boolean;
} = {}) {
  const requests = Object.entries(luxartSoapRequiredFields)
    .filter(([name]) => !name.startsWith("EMA_"))
    .map(([name, fields]) => element(name, fields.filter((field) => `${name}.${field}` !== options.missingField)))
    .join("");
  const dataset = Object.entries(luxartSoapRequiredFields)
    .filter(([name]) => name.startsWith("EMA_"))
    .map(([name, fields]) => element(name, fields.filter((field) => `${name}.${field}` !== options.missingField)))
    .join("");
  const bodies: Record<string, string> = {
    "?wsdl": `<wsdl:definitions>${luxartSoapRequiredOperations
      .map((name) => `<wsdl:operation name="${name}"/>`)
      .join("")}</wsdl:definitions>`,
    "?xsd=xsd0": `<xs:schema targetNamespace="http://tempuri.org/">${requests}</xs:schema>`,
    "?xsd=xsd2": `<xs:schema><xs:complexType name="CompositeType">${luxartSoapRequiredResponseTables
      .filter((name) => name !== options.missingResponseTable)
      .map((name) => `<ActualType Name="DataSet1.${name}"/>`)
      .join("")}</xs:complexType></xs:schema>`,
    "?xsd=xsd3": `<xs:schema><xs:element name="DataSet1"><xs:complexType><xs:choice>${dataset}</xs:choice></xs:complexType></xs:element></xs:schema>`,
  };
  const seen: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = async (url: URL, init?: RequestInit) => {
    seen.push({ url: url.href, init });
    if (options.redirectWsdl && url.search === "?wsdl") {
      return new Response("", { status: 302, headers: { location: "https://untrusted.example.invalid" } });
    }
    return new Response(bodies[url.search] ?? "", { status: bodies[url.search] ? 200 : 404 });
  };
  return { fetchImpl, seen };
}

test("SOAP public verifier proves only structural candidate capabilities without credentials", async () => {
  const fixture = fixtures();
  const report = await verifyLuxartSoapPublicContract({
    fetchImpl: fixture.fetchImpl,
    now: new Date("2026-09-11T20:00:00.000Z"),
  });

  assert.equal(report.ok, true);
  assert.equal(report.referenceOnly, true);
  assert.equal(report.launchAuthority, false);
  assert.equal(report.verifiedDocumentCount, 4);
  assert.equal(report.verifiedRequiredOperationCount, luxartSoapRequiredOperations.length);
  assert.equal(report.verifiedRequiredResponseTableCount, luxartSoapRequiredResponseTables.length);
  assert.equal(report.pilotCompatibility.status, "unproven");
  assert.deepEqual(report.pilotCompatibility.documentedGaps, [...luxartSoapPilotGaps]);
  assert.deepEqual(report.candidateCapabilities, {
    login: true,
    scheduleRead: true,
    resourceLookup: true,
    serviceLookup: true,
    reservationCreate: true,
    reservationUpdate: true,
    reservationCancel: true,
    creditFromLogin: true,
  });
  assert.match(report.semanticContractSha256 ?? "", /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(report).includes("api.memberzone.online"), false);

  assert.equal(fixture.seen.length, 4);
  for (const request of fixture.seen) {
    assert.equal(request.init?.method, "GET");
    assert.equal(request.init?.redirect, "manual");
    const headers = new Headers(request.init?.headers);
    assert.equal(headers.has("authorization"), false);
    assert.equal(headers.has("cookie"), false);
  }
});

test("SOAP public verifier detects a missing schedule capacity field", async () => {
  const report = await verifyLuxartSoapPublicContract({
    fetchImpl: fixtures({ missingField: "EMA_GET_RESERVATION.KAPACITA" }).fetchImpl,
  });
  assert.equal(report.ok, false);
  assert.deepEqual(report.issues, [{
    document: "dataset",
    code: "MISSING_FIELDS",
    missing: ["EMA_GET_RESERVATION.KAPACITA"],
  }]);

  const missingResponseTable = await verifyLuxartSoapPublicContract({
    fetchImpl: fixtures({ missingResponseTable: "EMA_DEL_RESERVATIONDataTable" }).fetchImpl,
  });
  assert.equal(missingResponseTable.ok, false);
  assert.deepEqual(missingResponseTable.issues, [{
    document: "responses",
    code: "MISSING_FIELDS",
    missing: ["EMA_DEL_RESERVATIONDataTable"],
  }]);
});

test("SOAP public verifier refuses redirects and invalid timeout bounds", async () => {
  const fixture = fixtures({ redirectWsdl: true });
  const report = await verifyLuxartSoapPublicContract({ fetchImpl: fixture.fetchImpl });
  assert.equal(report.ok, false);
  assert.ok(report.issues.some((issue) =>
    issue.document === "wsdl" && issue.code === "HTTP_STATUS" && issue.httpStatus === 302));

  await assert.rejects(
    verifyLuxartSoapPublicContract({ fetchImpl: fixture.fetchImpl, timeoutMs: 999 }),
    /1000 to 30000/i,
  );
});
