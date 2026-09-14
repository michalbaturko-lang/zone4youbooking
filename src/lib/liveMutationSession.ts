import { BookingApiError } from "./errors";
import { assertLivePersonalizedAccessReady } from "./liveAccessGate";
import { readBookingSession, type BookingSession } from "./session";

interface LiveMutationSessionDependencies {
  readSession: (request: Request) => BookingSession | null;
  assertLiveReady: () => void;
}

const defaultDependencies: LiveMutationSessionDependencies = {
  readSession: readBookingSession,
  assertLiveReady: assertLivePersonalizedAccessReady,
};

export function requireLiveBookingMutationSession(
  request: Request,
  live: boolean,
  dependencies: LiveMutationSessionDependencies = defaultDependencies,
) {
  if (!live) return undefined;

  const session = dependencies.readSession(request);
  if (!session) {
    throw new BookingApiError(401, "AUTH_REQUIRED", "Pro tuto akci se přihlaste.");
  }
  dependencies.assertLiveReady();
  return session;
}
