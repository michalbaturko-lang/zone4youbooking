import type { LoginInput } from "./domain";
import { BookingApiError } from "./errors";

export function parseLoginInput(value: unknown): LoginInput {
  if (typeof value !== "object" || value === null) {
    throw new BookingApiError(400, "INVALID_LOGIN_INPUT", "Vyplňte platné přihlašovací údaje.");
  }
  const candidate = value as Record<string, unknown>;
  const login = typeof candidate.login === "string" ? candidate.login.trim() : "";
  const password = typeof candidate.password === "string" ? candidate.password : "";
  const memberCardNumber = typeof candidate.memberCardNumber === "string"
    ? candidate.memberCardNumber.trim()
    : undefined;
  const containsControlCharacters = (text: string) => /[\u0000-\u001f\u007f]/.test(text);

  if (
    login.length === 0 ||
    login.length > 254 ||
    containsControlCharacters(login) ||
    password.trim().length === 0 ||
    password.length > 128 ||
    containsControlCharacters(password) ||
    (memberCardNumber !== undefined && (
      memberCardNumber.length > 64 || containsControlCharacters(memberCardNumber)
    ))
  ) {
    throw new BookingApiError(400, "INVALID_LOGIN_INPUT", "Vyplňte platné přihlašovací údaje.");
  }

  return {
    login,
    password,
    memberCardNumber: memberCardNumber || undefined,
  };
}
