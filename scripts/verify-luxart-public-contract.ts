import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

type FetchLike = (input: URL, init?: RequestInit) => Promise<Response>;

interface LuxartContractDocumentationOptions {
  origin: string;
  fetchImpl?: FetchLike;
  now?: Date;
  requestHeaders?: HeadersInit;
  timeoutMs?: number;
  expectedSemanticContractSha256?: string;
}

type LuxartPublicContractOptions = Omit<
  LuxartContractDocumentationOptions,
  "origin" | "requestHeaders"
>;

interface ContractEndpoint {
  id: string;
  path: string;
  title: string;
  requiredFields: readonly string[];
}

interface ContractIssue {
  endpoint: string;
  code:
    | "CONTRACT_DRIFT"
    | "HTTP_STATUS"
    | "MISSING_FIELDS"
    | "NETWORK_UNAVAILABLE"
    | "RESPONSE_TOO_LARGE"
    | "UNEXPECTED_DOCUMENT";
  httpStatus?: number;
  missingFields?: string[];
  expectedSha256?: string;
  actualSha256?: string;
}

const referenceOrigin = "http://api.memberzone.online:9295";
const maximumDocumentBytes = 512 * 1024;
export const approvedLuxartReferenceSemanticContractSha256 =
  "869beb3af67e648854462982b15f099aad622992dbbc81c2ec5bb4c9afc7bf20";

export const luxartPublicContractEndpoints: readonly ContractEndpoint[] = [
  {
    id: "login",
    path: "/Help/Api/POST-api-Login_login_password_member_card_number",
    title: "POST api/Login?login={login}&password={password}&member_card_number={member_card_number}",
    requiredFields: [
      "login", "password", "member_card_number", "user_id", "email", "name", "surname",
      "current_balance", "membership", "member_card", "minimum_kredit", "phone",
    ],
  },
  {
    id: "user",
    path: "/Help/Api/GET-api-User_user_id",
    title: "GET api/User?user_id={user_id}",
    requiredFields: [
      "user_id", "login", "email", "name", "surname", "current_balance", "membership",
      "member_card", "member_card_number", "minimum_kredit", "phone",
    ],
  },
  {
    id: "lessons",
    path: "/Help/Api/GET-api-Lesson_resort_date_start_id_kategorie_user_id_pocet_dni_dopredu_id_service_lang",
    title: "GET api/Lesson?resort={resort}&date_start={date_start}&id_kategorie={id_kategorie}&user_id={user_id}&pocet_dni_dopredu={pocet_dni_dopredu}&id_service={id_service}&lang={lang}",
    requiredFields: [
      "resort", "date_start", "id_kategorie", "user_id", "pocet_dni_dopredu", "id_service", "lang",
      "kategorie", "date_time", "id_staff", "pohlavi", "osloveni", "delka", "cena", "nazev",
      "popis", "kapacita", "obsazeno", "volno", "cislo_salu", "typ_lekce", "user_posible",
    ],
  },
  {
    id: "credit-history",
    path: "/Help/Api/GET-api-user-credit_history_user_id_lang_datum_od_datum_do",
    title: "GET api/user/credit_history?user_id={user_id}&lang={lang}&datum_od={datum_od}&datum_do={datum_do}",
    requiredFields: [
      "user_id", "lang", "datum_od", "datum_do", "resort", "datum", "castka", "cdd", "text",
      "uhrada", "typ_uhrady", "sportoviste",
    ],
  },
  {
    id: "reservations-list",
    path: "/Help/Api/GET-api-Reservations_user_id_historie_id_rezervace_lang",
    title: "GET api/Reservations?user_id={user_id}&historie={historie}&id_rezervace={id_rezervace}&lang={lang}",
    requiredFields: [
      "user_id", "historie", "id_rezervace", "lang", "resort", "id_kategorie", "datum",
      "id_service", "delka", "id_resource", "price", "status", "zpusob_uhrady", "uuid",
      "datum_pro_smazani",
    ],
  },
  {
    id: "reservations-create",
    path: "/Help/Api/POST-api-Reservations",
    title: "POST api/Reservations",
    requiredFields: [
      "resort", "id_kategorie", "user_id", "datum", "id_service_1", "delka_1", "id_resource_1",
      "pohlavi_1", "id_service_2", "delka_2", "id_resource_2", "pohlavi_2", "poznamka",
      "zpusob_uhrady", "name", "surname", "email", "phone", "language", "success", "messaget", "uuid",
    ],
  },
  {
    id: "reservations-cancel",
    path: "/Help/Api/DELETE-api-Reservations-id_kategorie_resort",
    title: "DELETE api/Reservations/{id}?kategorie={kategorie}&resort={resort}",
    requiredFields: ["id", "kategorie", "resort", "success", "messaget", "storno_poplatek"],
  },
  {
    id: "watchdog-list",
    path: "/Help/Api/GET-api-watchdog_II-user_user_id",
    title: "GET api/watchdog_II/user?user_id={user_id}",
    requiredFields: [
      "user_id", "resort", "id_kategorie", "datum", "id_service_1", "delka_1", "id_resource_1",
      "pohlavi_1", "id_watchdog", "language",
    ],
  },
  {
    id: "watchdog-create",
    path: "/Help/Api/POST-api-Reservations-watchdog_III",
    title: "POST api/Reservations/watchdog_III",
    requiredFields: [
      "resort", "id_kategorie", "user_id", "datum", "id_service_1", "delka_1", "id_resource_1",
      "pohlavi_1", "id_watchdog", "language", "success", "messaget", "uuid",
    ],
  },
  {
    id: "watchdog-cancel",
    path: "/Help/Api/DELETE-api-Watchdog-id_resort",
    title: "DELETE api/Watchdog/{id}?resort={resort}",
    requiredFields: ["id", "resort", "success", "messaget"],
  },
  {
    id: "payment",
    path: "/Help/Api/POST-api-Payment",
    title: "POST api/Payment",
    requiredFields: [
      "uuid", "user_id", "amount", "id_payment_shop", "id_payment_pp_1", "id_payment_pp_2",
      "zpusob_uhrady", "zpusob_odeslani", "success", "messaget", "id_mp",
    ],
  },
] as const;

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

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

function semanticDocument(body: string) {
  const title = decodeHtml(body.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "");
  const fields = [...body.matchAll(/class=["']parameter-name["'][^>]*>([\s\S]*?)<\/td>/gi)]
    .map((match) => decodeHtml(match[1]))
    .filter(Boolean);
  return { title, fields: [...new Set(fields)].sort() };
}

function networkCode(error: unknown) {
  if (error instanceof Error && error.message === "RESPONSE_TOO_LARGE") return "RESPONSE_TOO_LARGE" as const;
  return "NETWORK_UNAVAILABLE" as const;
}

function cleanContractOrigin(raw: string) {
  const url = new URL(raw);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("Luxart contract origin must be a clean HTTP(S) origin without credentials or a path.");
  }
  return url.origin;
}

export async function verifyLuxartContractDocumentation({
  origin,
  fetchImpl = fetch,
  now = new Date(),
  requestHeaders,
  timeoutMs = 8_000,
  expectedSemanticContractSha256 = approvedLuxartReferenceSemanticContractSha256,
}: LuxartContractDocumentationOptions) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 30_000) {
    throw new Error("Luxart public contract timeout must be an integer from 1000 to 30000.");
  }
  if (!/^[a-f0-9]{64}$/.test(expectedSemanticContractSha256)) {
    throw new Error("The expected Luxart reference contract digest must be a full lowercase SHA-256.");
  }
  const targetOrigin = cleanContractOrigin(origin);
  const headers = new Headers(requestHeaders);
  if (headers.has("cookie")) {
    throw new Error("Luxart contract documentation verification must not send cookies.");
  }
  if (targetOrigin.startsWith("http:") && [...headers].length > 0) {
    throw new Error("Luxart contract documentation authentication headers require HTTPS.");
  }
  headers.set("Accept", "text/html,application/xhtml+xml");

  const issues: ContractIssue[] = [];
  const observed: Array<{ id: string; title: string; fields: string[] }> = [];
  const request = async (path: string) => fetchImpl(new URL(path, targetOrigin), {
    method: "GET",
    redirect: "manual",
    cache: "no-store",
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  });

  try {
    const response = await request("/Help");
    const body = response.status === 200 ? await readLimitedDocument(response) : "";
    if (response.status !== 200) {
      issues.push({ endpoint: "root", code: "HTTP_STATUS", httpStatus: response.status });
    } else if (!/<title>\s*API dokumentace\s*<\/title>/i.test(body)) {
      issues.push({ endpoint: "root", code: "UNEXPECTED_DOCUMENT" });
    }
  } catch (error) {
    issues.push({ endpoint: "root", code: networkCode(error) });
  }

  await Promise.all(luxartPublicContractEndpoints.map(async (endpoint) => {
    try {
      const response = await request(endpoint.path);
      if (response.status !== 200) {
        issues.push({ endpoint: endpoint.id, code: "HTTP_STATUS", httpStatus: response.status });
        return;
      }
      const document = semanticDocument(await readLimitedDocument(response));
      if (document.title !== endpoint.title) {
        issues.push({ endpoint: endpoint.id, code: "UNEXPECTED_DOCUMENT" });
        return;
      }
      const fieldSet = new Set(document.fields);
      const missingFields = endpoint.requiredFields.filter((field) => !fieldSet.has(field));
      if (missingFields.length > 0) {
        issues.push({ endpoint: endpoint.id, code: "MISSING_FIELDS", missingFields });
      }
      observed.push({ id: endpoint.id, title: document.title, fields: document.fields });
    } catch (error) {
      issues.push({ endpoint: endpoint.id, code: networkCode(error) });
    }
  }));

  observed.sort((left, right) => left.id.localeCompare(right.id));
  const semanticContractSha256 = observed.length === luxartPublicContractEndpoints.length
    ? createHash("sha256").update(JSON.stringify(observed)).digest("hex")
    : undefined;
  if (
    issues.length === 0 &&
    semanticContractSha256 &&
    semanticContractSha256 !== expectedSemanticContractSha256
  ) {
    issues.push({
      endpoint: "contract",
      code: "CONTRACT_DRIFT",
      expectedSha256: expectedSemanticContractSha256,
      actualSha256: semanticContractSha256,
    });
  }
  issues.sort((left, right) => left.endpoint.localeCompare(right.endpoint));

  return {
    ok: issues.length === 0,
    checkedAt: now.toISOString(),
    targetFingerprintSha256: createHash("sha256").update(targetOrigin).digest("hex"),
    expectedEndpointCount: luxartPublicContractEndpoints.length,
    verifiedEndpointCount: observed.length,
    expectedSemanticContractSha256,
    semanticContractSha256,
    issues,
  };
}

export async function verifyLuxartPublicContract(options: LuxartPublicContractOptions = {}) {
  const report = await verifyLuxartContractDocumentation({
    ...options,
    origin: referenceOrigin,
  });
  return {
    ...report,
    referenceOnly: true,
    launchAuthority: false,
  };
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  verifyLuxartPublicContract()
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
        error: error instanceof Error ? error.message : "Luxart public contract verification failed.",
      }, null, 2));
      process.exitCode = 1;
    });
}
