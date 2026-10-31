import type { OrchestrationV2TurnItem, SecretRequestAnswerInput } from "@t3tools/contracts";

export type SecretRequestItem = Extract<
  OrchestrationV2TurnItem,
  { readonly type: "secret_request" }
>;

/** A `file` request lets the agent's commands read the value, so its card must not promise more. */
export const secretRequestPrivacyNote = (item: Pick<SecretRequestItem, "delivery" | "login">) =>
  item.login
    ? `Typed into ${loginRequestUrl(item.login.url).host} only, never stored or shown to the agent`
    : item.delivery === "file"
      ? "Kept out of chat, in a private file this agent's commands can read for 24 hours"
      : "Stored securely, never shown to the agent";

const MAX_QUERY_VALUE = 24;

/** Long query values are cut so the host and path stay readable; the full URL goes in a tooltip. */
export function loginRequestUrl(url: string): {
  readonly host: string;
  readonly path: string;
  readonly secure: boolean;
} {
  try {
    const parsed = new URL(url);
    const query = [...parsed.searchParams]
      .map(([key, value]) =>
        value.length > MAX_QUERY_VALUE
          ? `${key}=${value.slice(0, MAX_QUERY_VALUE)}…`
          : `${key}=${value}`,
      )
      .join("&");
    return {
      host: parsed.host,
      path: `${parsed.pathname}${query ? `?${query}` : ""}`,
      secure: parsed.protocol === "https:",
    };
  } catch {
    return { host: url, path: "", secure: false };
  }
}
export const SECRET_REQUEST_DEFAULT_PLACEHOLDER = "Paste the secret";

export type SecretRequestDisplay =
  | { readonly kind: "pending" }
  | { readonly kind: "pending-elsewhere"; readonly label: string }
  | {
      readonly kind: "answered";
      readonly outcome: "saved" | "declined" | "ended";
      readonly label: string;
    };

const SAVED_DISPLAY: SecretRequestDisplay = {
  kind: "answered",
  outcome: "saved",
  label: "Saved securely and kept private",
};
const LOGIN_SENT_DISPLAY: SecretRequestDisplay = {
  kind: "answered",
  outcome: "saved",
  label: "Sent to the page",
};
const DECLINED_DISPLAY: SecretRequestDisplay = {
  kind: "answered",
  outcome: "declined",
  label: "Declined",
};
const ENDED_DISPLAY: SecretRequestDisplay = {
  kind: "answered",
  outcome: "ended",
  label: "Request ended",
};
const PENDING_DISPLAY: SecretRequestDisplay = { kind: "pending" };
const PENDING_ELSEWHERE_DISPLAY: SecretRequestDisplay = {
  kind: "pending-elsewhere",
  label: "Waiting for an answer in the original thread",
};

/**
 * `visibility` is the projected row's: a request inherited from another
 * thread (a fork) can only be answered where it was asked.
 */
export function secretRequestDisplay(
  item: Pick<SecretRequestItem, "secretStatus" | "login">,
  visibility: "local" | "inherited" | "synthetic",
): SecretRequestDisplay {
  switch (item.secretStatus) {
    case "pending":
      return visibility === "local" ? PENDING_DISPLAY : PENDING_ELSEWHERE_DISPLAY;
    case "saved":
      return item.login ? LOGIN_SENT_DISPLAY : SAVED_DISPLAY;
    case "declined":
      return DECLINED_DISPLAY;
    case "cancelled":
      return ENDED_DISPLAY;
  }
}

export function secretRequestAnswerInput(
  item: Pick<SecretRequestItem, "id" | "threadId">,
  answer:
    | { readonly type: "save"; readonly secret: string }
    | { readonly type: "login"; readonly username: string; readonly password: string }
    | { readonly type: "decline" },
): SecretRequestAnswerInput | null {
  if (answer.type === "decline") {
    return { threadId: item.threadId, turnItemId: item.id, answer: { type: "decline" } };
  }
  if (answer.type === "login") {
    if (answer.password.length === 0) return null;
    const username = answer.username.trim();
    return {
      threadId: item.threadId,
      turnItemId: item.id,
      answer: { type: "login", ...(username ? { username } : {}), password: answer.password },
    };
  }
  const secret = answer.secret.trim();
  if (secret.length === 0) return null;
  return { threadId: item.threadId, turnItemId: item.id, answer: { type: "save", secret } };
}

const USER_FACING_FAILURE_TAGS = new Set(["SecretRequestError", "EnvironmentAuthorizationError"]);

/**
 * Only known server errors pass their message through: anything else (transport or encoding
 * failures) gets the generic copy, so the typed value can never surface in the UI.
 */
export function secretRequestFailureMessage(failure: unknown): string {
  if (
    typeof failure === "object" &&
    failure !== null &&
    "_tag" in failure &&
    typeof failure._tag === "string" &&
    USER_FACING_FAILURE_TAGS.has(failure._tag) &&
    "message" in failure &&
    typeof failure.message === "string" &&
    failure.message.trim().length > 0
  ) {
    return failure.message;
  }
  return "Could not answer the request. Try again.";
}
