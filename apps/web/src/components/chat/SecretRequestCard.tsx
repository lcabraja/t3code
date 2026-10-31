import { pipe } from "effect/Function";
import {
  loginRequestUrl,
  SECRET_REQUEST_DEFAULT_PLACEHOLDER,
  secretRequestAnswerInput,
  secretRequestDisplay,
  secretRequestFailureMessage,
  secretRequestPrivacyNote,
  type SecretRequestItem,
} from "@t3tools/client-runtime/secret-request";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, OrchestrationV2ProjectedTurnItem } from "@t3tools/contracts";
import {
  CheckIcon,
  GlobeIcon,
  LocateFixedIcon,
  LockIcon,
  MinusIcon,
  ShieldCheckIcon,
} from "lucide-react";
import { useId, useRef, useState, type FormEvent, type ReactNode } from "react";

import { showLoginField } from "../../browser/loginFieldHighlight";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { WorkLogRow } from "./WorkLog";

export function SecretRequestCard(props: {
  readonly environmentId: EnvironmentId;
  readonly item: SecretRequestItem;
  readonly visibility: OrchestrationV2ProjectedTurnItem["visibility"];
}) {
  const { item } = props;
  const display = secretRequestDisplay(item, props.visibility);
  if (display.kind === "answered" || display.kind === "pending-elsewhere") {
    const Icon =
      display.kind === "pending-elsewhere"
        ? LockIcon
        : display.outcome === "saved"
          ? CheckIcon
          : MinusIcon;
    return (
      <WorkLogRow
        data-v2-item-type={item.type}
        icon={<Icon className="size-3.5 text-icon-muted" aria-hidden />}
        label={
          <>
            {item.label} · {display.label}
          </>
        }
      />
    );
  }
  return <PendingSecretRequestForm environmentId={props.environmentId} item={item} />;
}

type SecretRequestReply = Parameters<typeof secretRequestAnswerInput>[1];

function PendingSecretRequestForm(props: {
  readonly environmentId: EnvironmentId;
  readonly item: SecretRequestItem;
}) {
  const { item } = props;
  const inputId = useId();
  const errorId = useId();
  const privacyId = useId();
  const answer = useAtomCommand(serverEnvironment.answerSecretRequest, {
    label: "answer secret request",
    // The failure cause holds the request; keep it out of the console.
    reportFailure: false,
    reportDefect: false,
  });
  const [secret, setSecret] = useState("");
  const [username, setUsername] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Enter and click can both submit before a render.
  const inFlight = useRef(false);

  const send = async (reply: SecretRequestReply) => {
    const input = secretRequestAnswerInput(item, reply);
    if (input === null || inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    const result = await answer({ environmentId: props.environmentId, input }).finally(() => {
      inFlight.current = false;
      setSubmitting(false);
    });
    if (result._tag === "Success") {
      setSecret("");
      setUsername("");
      return;
    }
    if (!isAtomCommandInterrupted(result)) {
      pipe(squashAtomCommandFailure(result), secretRequestFailureMessage, setError);
    }
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void send(
      item.login ? { type: "login", username, password: secret } : { type: "save", secret },
    );
  };
  const loginUrl = item.login ? loginRequestUrl(item.login.url) : null;
  const pageField = (kind: "username" | "password") =>
    item.login?.fields?.find((field) => field.kind === kind);
  const showField = (kind: "username" | "password") => {
    const tabId = item.login?.tabId;
    if (tabId === undefined || !pageField(kind)) return undefined;
    return () =>
      showLoginField({ environmentId: props.environmentId, threadId: item.threadId }, tabId, kind);
  };

  return (
    <form
      data-v2-item-type={item.type}
      className="flex min-w-0 flex-col gap-3 rounded-xl border border-border/60 bg-card p-4"
      onSubmit={onSubmit}
      autoComplete={item.login ? "on" : "off"}
      // On click, not pointerdown: the mousedown that follows a pointerdown
      // moves focus back off the input. A click that ends a text selection
      // leaves it alone so the reason can still be copied.
      onClick={(event) => {
        if (!(event.target instanceof Element)) return;
        if (event.target.closest("input, button, a")) return;
        if (window.getSelection()?.isCollapsed === false) return;
        document.getElementById(inputId)?.focus();
      }}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor={inputId} className="text-sm font-medium text-foreground">
          {item.label}
        </label>
        {item.reason.trim() ? (
          <p className="text-sm wrap-anywhere text-muted-foreground">{item.reason}</p>
        ) : null}
        {item.login && loginUrl ? (
          <p className="flex min-w-0 items-start gap-1.5 text-xs text-muted-foreground">
            {loginUrl.secure ? (
              <LockIcon className="mt-px size-3.5 shrink-0" aria-label="Secure connection" />
            ) : (
              <GlobeIcon className="mt-px size-3.5 shrink-0" aria-label="Not a secure connection" />
            )}
            <Tooltip>
              <TooltipTrigger render={<span className="min-w-0 wrap-anywhere" />}>
                <span className="font-medium text-foreground">{loginUrl.host}</span>
                {loginUrl.path}
              </TooltipTrigger>
              <TooltipPopup className="wrap-anywhere">{item.login.url}</TooltipPopup>
            </Tooltip>
          </p>
        ) : null}
      </div>
      {item.login ? (
        <LoginFieldRow
          description={pageField("username")?.label ?? "Username or email, if the page asks"}
          onShow={showField("username")}
        >
          <Input
            aria-label="Username"
            placeholder={pageField("username")?.label ?? "Username or email"}
            autoComplete="username"
            autoCapitalize="off"
            spellCheck={false}
            value={username}
            disabled={submitting}
            onChange={(event) => setUsername(event.currentTarget.value)}
          />
        </LoginFieldRow>
      ) : null}
      {item.login ? (
        <LoginFieldRow
          description={pageField("password")?.label ?? "Password"}
          onShow={showField("password")}
        />
      ) : null}
      <div className="flex min-w-0 items-center gap-2">
        <div className="min-w-0 flex-1">
          <Input
            id={inputId}
            // Password fields prompt to save credentials; a plain secret is not a login.
            type={item.login ? "password" : "text"}
            className={item.login ? undefined : "[-webkit-text-security:disc]"}
            autoComplete={item.login ? "current-password" : "off"}
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            {...(item.login
              ? {}
              : { "data-1p-ignore": true, "data-lpignore": "true", "data-bwignore": true })}
            placeholder={
              item.login
                ? (pageField("password")?.label ?? "Password")
                : (item.placeholder ?? SECRET_REQUEST_DEFAULT_PLACEHOLDER)
            }
            value={secret}
            disabled={submitting}
            aria-invalid={error !== null || undefined}
            aria-describedby={error !== null ? `${privacyId} ${errorId}` : privacyId}
            onChange={(event) => setSecret(event.currentTarget.value)}
          />
        </div>
        <Button
          type="submit"
          disabled={submitting || (item.login ? secret.length === 0 : secret.trim().length === 0)}
        >
          {item.login ? "Sign in" : "Save securely"}
        </Button>
      </div>
      {error !== null ? (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex min-w-0 items-center justify-between gap-2">
        <p
          id={privacyId}
          className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground"
        >
          <ShieldCheckIcon className="size-3.5 shrink-0" aria-hidden />
          {secretRequestPrivacyNote(item)}
        </p>
        <Button
          type="button"
          size="xs"
          variant="ghost-muted"
          disabled={submitting}
          onClick={() => void send({ type: "decline" })}
        >
          Decline
        </Button>
      </div>
    </form>
  );
}

/** One login field: what the page calls it, and a way to find it on the page. */
function LoginFieldRow(props: {
  readonly description: string;
  readonly onShow: (() => void) | undefined;
  readonly children?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className="min-w-0 truncate text-xs text-muted-foreground">{props.description}</span>
        {props.onShow ? (
          <Button type="button" size="xs" variant="ghost-muted" onClick={props.onShow}>
            <LocateFixedIcon aria-hidden />
            Show on page
          </Button>
        ) : null}
      </div>
      {props.children}
    </div>
  );
}
