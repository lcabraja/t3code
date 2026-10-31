import type {
  PreviewStreamCredentialPrompt,
  PreviewStreamInput,
} from "@t3tools/client-runtime/preview/server-browser-stream";
import { EyeIcon, EyeOffIcon, KeyRoundIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "~/components/ui/input-group";

const hostOf = (origin: string) => {
  try {
    return new URL(origin).host || origin;
  } catch {
    return origin;
  }
};

/**
 * Asks for a login when the page shows one. The values go straight to the
 * page's fields and are never stored. These are real inputs in the viewer's
 * own browser, so its password manager can fill them.
 */
export function CredentialPromptCard(props: {
  readonly prompt: PreviewStreamCredentialPrompt;
  readonly canAnswer: boolean;
  readonly send: (input: PreviewStreamInput) => void;
}) {
  const { prompt, canAnswer, send } = props;
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [revealed, setRevealed] = useState(false);
  const host = hostOf(prompt.origin);

  const answer = (action: Extract<PreviewStreamInput, { type: "credential" }>["action"]) =>
    send({ type: "credential", promptId: prompt.id, action });

  const fill = (submit: boolean) => {
    if (prompt.kind !== "password") return;
    send({
      type: "credential",
      promptId: prompt.id,
      action: "fill",
      ...(prompt.username && username ? { username } : {}),
      ...(prompt.password && password ? { password } : {}),
      submit,
    });
    setPassword("");
  };

  return (
    <div
      className="absolute inset-x-2 top-2 z-10 flex flex-col gap-2 rounded-lg border border-border bg-background p-3 shadow-lg"
      role="dialog"
      aria-label={prompt.kind === "passkey" ? "Passkey request" : "Sign in"}
    >
      <div className="flex items-start gap-2">
        <KeyRoundIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="break-words text-sm">
            {prompt.kind === "passkey"
              ? `${prompt.rpId ?? host} wants to ${
                  prompt.action === "create" ? "save a new passkey" : "sign you in with a passkey"
                }${prompt.userName ? ` for ${prompt.userName}` : ""}.`
              : prompt.signup
                ? `Sign up on ${host}?`
                : `Got a login for ${host}?`}
          </p>
          {prompt.topOrigin ? (
            <p className="text-xs text-warning-foreground">
              This form is inside {hostOf(prompt.topOrigin)}. Check that you expect it.
            </p>
          ) : null}
          {prompt.kind === "passkey" ? (
            <p className="text-xs text-muted-foreground">
              T3 Code can't provide passkeys yet. Cancel to fall back to a password, or let the
              browser try.
            </p>
          ) : null}
        </div>
      </div>
      {!canAnswer ? (
        <p className="text-xs text-muted-foreground">Take control to respond.</p>
      ) : prompt.kind === "passkey" ? (
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => answer("deny")}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => answer("allow")}>
            Let the browser try
          </Button>
        </div>
      ) : (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            fill(true);
          }}
        >
          {prompt.username ? (
            <Input
              aria-label="Username"
              placeholder="Username or email"
              autoComplete="username"
              autoCapitalize="off"
              spellCheck={false}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          ) : null}
          {prompt.password ? (
            <InputGroup>
              <InputGroupInput
                aria-label="Password"
                placeholder="Password"
                type={revealed ? "text" : "password"}
                autoComplete={prompt.signup ? "new-password" : "current-password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <InputGroupAddon align="inline-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={revealed ? "Hide password" : "Show password"}
                  onClick={() => setRevealed((value) => !value)}
                >
                  {revealed ? <EyeOffIcon /> : <EyeIcon />}
                </Button>
              </InputGroupAddon>
            </InputGroup>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => answer("dismiss")}>
              Not now
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => fill(false)}>
              Fill
            </Button>
            <Button type="submit" size="sm">
              {prompt.password
                ? prompt.signup
                  ? "Fill and sign up"
                  : "Fill and sign in"
                : "Fill and continue"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
