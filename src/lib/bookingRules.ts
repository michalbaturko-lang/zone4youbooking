import type { BookingRules } from "./domain";
import implementation from "../../config/booking-rules-implementation.json";

export const bookingRules = implementation as BookingRules;
