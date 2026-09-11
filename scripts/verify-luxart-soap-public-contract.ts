import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

type FetchLike = (input: URL, init?: RequestInit) => Promise<Response>;

interface LuxartSoapPublicContractOptions {
  fetchImpl?: FetchLike;
  now?: Date;
  timeoutMs?: number;
}

type DocumentId = "wsdl" | "requests" | "responses" | "dataset";
type ContractIssueCode =
  | "HTTP_STATUS"
  | "MISSING_FIELDS"
  | "MISSING_OPERATIONS"
  | "NETWORK_UNAVAILABLE"
  | "RESPONSE_TOO_LARGE"
  | "UNEXPECTED_DOCUMENT";

interface ContractIssue {
  document: DocumentId;
  code: ContractIssueCode;
  httpStatus?: number;
  missing?: string[];
}

const referenceServiceOrigin = "http://api.memberzone.online:9191";
const referenceServicePath = "/Service1.svc";
const maximumDocumentBytes = 1024 * 1024;

const documents: ReadonlyArray<{
  id: DocumentId;
  search: string;
  rootPattern: RegExp;
}> = [
  { id: "wsdl", search: "?wsdl", rootPattern: /<wsdl:definitions\b/i },
  { id: "requests", search: "?xsd=xsd0", rootPattern: /targetNamespace="http:\/\/tempuri\.org\/"/i },
  { id: "responses", search: "?xsd=xsd2", rootPattern: /name="CompositeType"/i },
  { id: "dataset", search: "?xsd=xsd3", rootPattern: /name="DataSet1"/i },
] as const;

export const luxartSoapRequiredOperations = [
  "Login",
  "GetClient",
  "GetResource",
  "GetServices",
  "GetReservation",
  "SetReservation",
  "UPD_Reservation",
  "DEL_Reservation",
] as const;

export const luxartSoapRequiredFields = {
  Login: ["LOGIN_NAME", "LOGIN_PASSWORD"],
  GetResource: ["ID_CLIENT", "WHO_I_AM", "FROM_PATH", "DATE_FROM", "ID_ACTIVITY_IN"],
  GetServices: ["ID_CLIENT", "WHO_I_AM", "FROM_PATH", "ID_RESOURCE", "START_DATE_TIME"],
  GetReservation: ["ID_CLIENT", "WHO_I_AM", "FROM_PATH", "DATE_FROM", "DATE_TO", "ID_ACTIVITY_IN"],
  SetReservation: [
    "ID_CLIENT", "WHO_I_AM", "FROM_PATH", "ID_RESOURCE", "START_DATE_TIME", "PRICE",
    "ID_SERVICE", "ID_CLIENT_RESERVATION", "POZNAMKA", "ID_STAFF", "END_DATE_TIME",
  ],
  DEL_Reservation: [
    "ID_CLIENT", "WHO_I_AM", "FROM_PATH", "ID_RESOURCE", "ID_CLIENT_RESERVATION",
    "CISLO_REZERVACE", "TEST", "DATUM_DELETE",
  ],
  EMA_LOGIN: ["ID_KLIENT", "KREDIT", "JMENO", "PRIJMENI", "EMAIL"],
  EMA_GET_RESOURCE: ["ID", "NAME", "ID_ACTIVITY"],
  EMA_GET_SERVICES: ["TEXT", "ID_SERVICE_OUT", "CENA_OUT"],
  EMA_GET_RESERVATION: [
    "ID", "DESCRIPTION", "DATE_START", "DATE_END", "ID_ACTIVITY", "ID_RESOURCE", "PRICE",
    "ID_STAFF", "POCET_REZERVACI", "POCET_VLATNICH", "KAPACITA",
  ],
} as const;

export const luxartSoapRequiredResponseTables = [
  "EMA_LOGINDataTable",
  "EMA_GET_CLIENTSDataTable",
  "EMA_GET_RESOURCEDataTable",
  "EMA_GET_SERVICESDataTable",
  "EMA_GET_RESERVATIONDataTable",
  "EMA_SET_RESERVATIONDataTable",
  "EMA_UPD_RESERVATIONDataTable",
  "EMA_DEL_RESERVATIONDataTable",
] as const;

export const luxartSoapPilotGaps = [
  "NO_EXPLICIT_LESSON_OPERATION",
  "NO_LANGUAGE_PARAMETER",
  "NO_DOCUMENTED_USER_ELIGIBILITY_FIELD",
  "NO_WATCHDOG_OPERATIONS",
  "NO_CONFIRMED_ZONE4YOU_TEST_DATABASE",
  "NO_HTTPS_TRANSPORT",
] as const;

async function readLimitedDocument(response: Response) {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength && Number(declaredLength) > maximumDocumentBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("RESPONSE_TOO_LARGE");
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let result = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maximumDocumentBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error("RESPONSE_TOO_LARGE");
      }
      result += decoder.decode(value, { stream: true });
    }
    return result + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

function escapedRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function xmlElementBlock(xml: string, name: string) {
  const opening = new RegExp(`<xs:element\\b[^>]*\\bname=["']${escapedRegex(name)}["'][^>]*>`, "i").exec(xml);
  if (!opening || opening.index === undefined) return undefined;

  const tokens = /<xs:element\b[^>]*\/>|<xs:element\b[^>]*>|<\/xs:element>/gi;
  tokens.lastIndex = opening.index + opening[0].length;
  let depth = 1;
  for (let token = tokens.exec(xml); token; token = tokens.exec(xml)) {
    if (/^<\/xs:element/i.test(token[0])) depth -= 1;
    else if (!/\/>$/.test(token[0])) depth += 1;
    if (depth === 0) return xml.slice(opening.index, tokens.lastIndex);
  }
  return undefined;
}

function fieldNames(xml: string, elementName: string) {
  const block = xmlElementBlock(xml, elementName);
  if (!block) return [];
  return [...new Set([...block.matchAll(/<xs:element\b[^>]*\bname=["']([^"']+)["']/gi)]
    .map((match) => match[1])
    .filter((field) => field !== elementName))].sort();
}

function operationNames(wsdl: string) {
  return [...new Set([...wsdl.matchAll(/<wsdl:operation\b[^>]*\bname=["']([^"']+)["']/gi)]
    .map((match) => match[1]))].sort();
}

function responseTableNames(schema: string) {
  return [...new Set([...schema.matchAll(/\bName=["']DataSet1\.([^"']+DataTable)["']/gi)]
    .map((match) => match[1]))].sort();
}

function networkIssue(document: DocumentId, error: unknown): ContractIssue {
  return {
    document,
    code: error instanceof Error && error.message === "RESPONSE_TOO_LARGE"
      ? "RESPONSE_TOO_LARGE"
      : "NETWORK_UNAVAILABLE",
  };
}

export async function verifyLuxartSoapPublicContract({
  fetchImpl = fetch,
  now = new Date(),
  timeoutMs = 8_000,
}: LuxartSoapPublicContractOptions = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 30_000) {
    throw new Error("Luxart SOAP public contract timeout must be an integer from 1000 to 30000.");
  }

  const issues: ContractIssue[] = [];
  const bodies = new Map<DocumentId, string>();
  await Promise.all(documents.map(async (document) => {
    const url = new URL(referenceServicePath, referenceServiceOrigin);
    url.search = document.search;
    try {
      const response = await fetchImpl(url, {
        method: "GET",
        redirect: "manual",
        cache: "no-store",
        headers: { Accept: "application/wsdl+xml,application/xml,text/xml" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.status !== 200) {
        issues.push({ document: document.id, code: "HTTP_STATUS", httpStatus: response.status });
        return;
      }
      const body = await readLimitedDocument(response);
      if (!document.rootPattern.test(body)) {
        issues.push({ document: document.id, code: "UNEXPECTED_DOCUMENT" });
        return;
      }
      bodies.set(document.id, body);
    } catch (error) {
      issues.push(networkIssue(document.id, error));
    }
  }));

  const operations = operationNames(bodies.get("wsdl") ?? "");
  const missingOperations = luxartSoapRequiredOperations.filter((name) => !operations.includes(name));
  if (bodies.has("wsdl") && missingOperations.length > 0) {
    issues.push({ document: "wsdl", code: "MISSING_OPERATIONS", missing: [...missingOperations] });
  }

  const responseTables = responseTableNames(bodies.get("responses") ?? "");
  const missingResponseTables = luxartSoapRequiredResponseTables.filter((name) => !responseTables.includes(name));
  if (bodies.has("responses") && missingResponseTables.length > 0) {
    issues.push({ document: "responses", code: "MISSING_FIELDS", missing: [...missingResponseTables] });
  }

  const requestXml = bodies.get("requests") ?? "";
  const datasetXml = bodies.get("dataset") ?? "";
  const observedFields: Record<string, string[]> = {};
  for (const [element, required] of Object.entries(luxartSoapRequiredFields)) {
    const fields = fieldNames(element.startsWith("EMA_") ? datasetXml : requestXml, element);
    observedFields[element] = fields;
    const missing = required.filter((field) => !fields.includes(field));
    if ((element.startsWith("EMA_") ? bodies.has("dataset") : bodies.has("requests")) && missing.length > 0) {
      issues.push({
        document: element.startsWith("EMA_") ? "dataset" : "requests",
        code: "MISSING_FIELDS",
        missing: missing.map((field) => `${element}.${field}`),
      });
    }
  }

  issues.sort((left, right) => `${left.document}:${left.code}`.localeCompare(`${right.document}:${right.code}`));
  const structuralContractVerified = issues.length === 0 && bodies.size === documents.length;
  const semanticContractSha256 = structuralContractVerified
    ? createHash("sha256").update(JSON.stringify({ operations, responseTables, observedFields })).digest("hex")
    : undefined;

  return {
    ok: structuralContractVerified,
    checkedAt: now.toISOString(),
    referenceOnly: true,
    launchAuthority: false,
    targetFingerprintSha256: createHash("sha256")
      .update(`${referenceServiceOrigin}${referenceServicePath}`)
      .digest("hex"),
    verifiedDocumentCount: bodies.size,
    expectedDocumentCount: documents.length,
    verifiedRequiredOperationCount: luxartSoapRequiredOperations.length - missingOperations.length,
    expectedRequiredOperationCount: luxartSoapRequiredOperations.length,
    verifiedRequiredResponseTableCount: luxartSoapRequiredResponseTables.length - missingResponseTables.length,
    expectedRequiredResponseTableCount: luxartSoapRequiredResponseTables.length,
    semanticContractSha256,
    candidateCapabilities: {
      login: operations.includes("Login"),
      scheduleRead: operations.includes("GetReservation"),
      resourceLookup: operations.includes("GetResource"),
      serviceLookup: operations.includes("GetServices"),
      reservationCreate: operations.includes("SetReservation"),
      reservationUpdate: operations.includes("UPD_Reservation"),
      reservationCancel: operations.includes("DEL_Reservation"),
      creditFromLogin: observedFields.EMA_LOGIN?.includes("KREDIT") ?? false,
    },
    pilotCompatibility: {
      status: "unproven" as const,
      documentedGaps: [...luxartSoapPilotGaps],
    },
    issues,
  };
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  verifyLuxartSoapPublicContract()
    .then((report) => {
      console.log(JSON.stringify(report, null, 2));
      if (!report.ok) process.exitCode = 1;
    })
    .catch((error) => {
      console.error(JSON.stringify({
        ok: false,
        checkedAt: new Date().toISOString(),
        referenceOnly: true,
        launchAuthority: false,
        error: error instanceof Error ? error.message : "Luxart SOAP public contract verification failed.",
      }, null, 2));
      process.exitCode = 1;
    });
}
