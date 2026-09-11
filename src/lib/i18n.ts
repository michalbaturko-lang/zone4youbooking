import cs from "@/messages/cs.json";
import en from "@/messages/en.json";

export type Locale = "cs" | "en";
export type MessageKey = keyof typeof cs;
export type Translate = (key: MessageKey, variables?: Record<string, string | number>) => string;

const messages: Record<Locale, Record<MessageKey, string>> = { cs, en };

export function translate(locale: Locale, key: MessageKey, variables: Record<string, string | number> = {}) {
  return Object.entries(variables).reduce(
    (message, [name, value]) => message.replaceAll(`{${name}}`, String(value)),
    messages[locale][key] ?? messages.cs[key] ?? key,
  );
}
