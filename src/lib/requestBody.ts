import { BookingApiError } from "./errors";

export const maximumJsonBodyBytes = 64 * 1024;

function requestTooLarge() {
  return new BookingApiError(
    413,
    "REQUEST_TOO_LARGE",
    "Požadavek obsahuje příliš mnoho dat.",
  );
}

export async function readBoundedJson<T>(
  request: Request,
  maximumBytes = maximumJsonBodyBytes,
): Promise<T> {
  const rawLength = request.headers.get("content-length");
  if (rawLength && /^\d+$/.test(rawLength) && Number(rawLength) > maximumBytes) {
    throw requestTooLarge();
  }

  if (!request.body) return {} as T;
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        throw requestTooLarge();
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }

  if (!text.trim()) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new BookingApiError(400, "INVALID_JSON", "Požadavek neobsahuje platná data.");
  }
}
