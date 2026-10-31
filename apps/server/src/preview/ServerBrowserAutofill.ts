// Split like Bitwarden's extension: an isolated-world content script finds and fills
// login fields; a main-world page script intercepts WebAuthn and bridges over DOM events.
// Nothing is stored: the viewer is asked every time.
import type { CDPSession } from "playwright-core";

const WORLD = "t3-autofill";
const BINDING = "__t3AutofillReport";

/** Page and isolated worlds share the DOM, so these events are the only bridge. String details cross worlds. */
const PASSKEY_REQUEST = "__t3-passkey-request";
const PASSKEY_ACK = "__t3-passkey-ack";
const PASSKEY_REPLY = "__t3-passkey-reply";
const PASSKEY_DONE = "__t3-passkey-done";

/** Main world. Holds a modal WebAuthn call until the viewer answers; passes it through when no T3 world acknowledges. */
const PASSKEY_HOOK_SCRIPT = `(() => {
  const proto = globalThis.CredentialsContainer?.prototype;
  if (!proto || !globalThis.PublicKeyCredential || proto.__t3Hooked) return;
  Object.defineProperty(proto, "__t3Hooked", { value: true });
  const dispatch = document.dispatchEvent.bind(document);
  const pending = new Map();
  document.addEventListener(${JSON.stringify(PASSKEY_REPLY)}, (event) => {
    let reply;
    try { reply = JSON.parse(event.detail); } catch { return; }
    const settle = pending.get(reply?.id);
    if (settle) settle(reply.allow === true);
  });
  const hook = (name, action) => {
    const original = proto[name];
    if (typeof original !== "function") return;
    const replacement = {
      [name](options) {
        const publicKey = options?.publicKey;
        // Conditional (autofill UI) requests wait silently; holding them would stall the page.
        if (!publicKey || options.mediation === "conditional") return original.call(this, options);
        const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
        let acknowledged = false;
        const onAck = (event) => { if (event.detail === id) acknowledged = true; };
        document.addEventListener(${JSON.stringify(PASSKEY_ACK)}, onAck);
        return new Promise((resolve, reject) => {
          const signal = options.signal;
          const finish = () => {
            pending.delete(id);
            signal?.removeEventListener("abort", abort);
            dispatch(new CustomEvent(${JSON.stringify(PASSKEY_DONE)}, { detail: id }));
          };
          const abort = () => {
            finish();
            reject(signal.reason ?? new DOMException("The operation was aborted.", "AbortError"));
          };
          if (signal?.aborted) return abort();
          signal?.addEventListener("abort", abort, { once: true });
          pending.set(id, (allow) => {
            finish();
            if (allow) original.call(this, options).then(resolve, reject);
            else reject(new DOMException("The passkey request was cancelled in T3 Code.", "NotAllowedError"));
          });
          dispatch(new CustomEvent(${JSON.stringify(PASSKEY_REQUEST)}, {
            detail: JSON.stringify({
              id,
              action,
              rpId: action === "get" ? (publicKey.rpId ?? null) : (publicKey.rp?.id ?? null),
              userName: action === "create" ? String(publicKey.user?.name ?? "") : null,
            }),
          }));
          document.removeEventListener(${JSON.stringify(PASSKEY_ACK)}, onAck);
          // Listeners run synchronously; no acknowledgement means no T3 world is here to answer.
          if (!acknowledged) pending.get(id)?.(true);
        });
      },
    }[name];
    Object.defineProperty(proto, name, { value: replacement, writable: true, configurable: true });
  };
  hook("get", "get");
  hook("create", "create");
})();`;

/** Isolated world: finds login fields, reports them, and focuses them for filling. */
const AUTOFILL_SCRIPT = `(() => {
  if (globalThis.__t3Autofill) return;
  const send = (message) => {
    try { globalThis[${JSON.stringify(BINDING)}](JSON.stringify(message)); } catch {}
  };
  const doc = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const TEXT_TYPES = new Set(["", "text", "email", "tel"]);
  const USERNAME_HINT = /user|login|identifier|account|e-?mail/i;
  const shown = (field) => {
    if (field.disabled || field.readOnly || field.type === "hidden") return false;
    const rect = field.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    const style = getComputedStyle(field);
    return style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity) > 0.05;
  };
  // Open shadow roots hold login forms on some sites (web components, Salesforce, ...).
  const inputs = (root, out) => {
    for (const field of root.querySelectorAll("input")) out.push(field);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    for (let node = walker.nextNode(); node; node = walker.nextNode())
      if (node.shadowRoot) inputs(node.shadowRoot, out);
    return out;
  };
  const hint = (field) =>
    [field.name, field.id, field.placeholder, field.getAttribute("aria-label")].join(" ");
  const autocompletes = (field, pattern) => pattern.test(field.getAttribute("autocomplete") ?? "");
  const isUsername = (field) =>
    TEXT_TYPES.has(field.type) &&
    (autocompletes(field, /\\b(username|email|webauthn)\\b/) || field.type === "email" || USERNAME_HINT.test(hint(field)));
  const precedes = (a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

  let current = { username: null, passwords: [], signup: false };
  const find = () => {
    const fields = inputs(document, []).filter(shown);
    const passwords = fields.filter((field) => field.type === "password");
    const signup = passwords.length > 0 && passwords.every((field) => autocompletes(field, /new-password/));
    const password = passwords.find((field) => !autocompletes(field, /new-password/)) ?? passwords[0];
    let username = null;
    if (password) {
      const before = fields.filter(
        (field) => TEXT_TYPES.has(field.type) && field.form === password.form && precedes(field, password),
      );
      username = before.findLast(isUsername) ?? before.at(-1) ?? null;
    } else {
      // Identifier-first sign-in (Google, Microsoft, ...) shows the username step alone.
      username =
        fields.find((field) => TEXT_TYPES.has(field.type) && autocompletes(field, /\\b(username|webauthn)\\b/)) ??
        fields.find((field) => TEXT_TYPES.has(field.type) && /user|login|identifier/i.test(hint(field))) ??
        null;
    }
    // A sign-up form gets its confirmation field too.
    const targets = !password ? [] : signup ? passwords.filter((field) => field.form === password.form) : [password];
    return { username, passwords: targets, signup };
  };

  let reported = "";
  let filling = false;
  const scan = (focused) => {
    current = find();
    const state = current.username || current.passwords.length > 0
      ? [!!current.username, current.passwords.length > 0, current.signup].join()
      : "";
    if (state === reported && !focused) return;
    reported = state;
    if (!state) return send({ type: "formGone", doc });
    send({
      type: "form",
      doc,
      origin: location.origin,
      username: !!current.username,
      password: current.passwords.length > 0,
      signup: current.signup,
      focused: !!focused,
    });
  };
  let timer = 0;
  const schedule = () => {
    if (timer) return;
    timer = setTimeout(() => { timer = 0; scan(false); }, 400);
  };
  new MutationObserver(schedule).observe(document, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["type", "hidden", "style", "class", "disabled"],
  });
  addEventListener("DOMContentLoaded", schedule);
  addEventListener("pageshow", schedule);
  // Clicking into a login field asks again, even after a dismissal.
  addEventListener("focusin", (event) => {
    const field = event.composedPath()[0];
    if (filling || !event.isTrusted || !(field instanceof HTMLInputElement)) return;
    if (field.type === "password" || isUsername(field)) scan(true);
  }, true);

  document.addEventListener(${JSON.stringify(PASSKEY_REQUEST)}, (event) => {
    let request;
    try { request = JSON.parse(event.detail); } catch { return; }
    if (typeof request?.id !== "string") return;
    document.dispatchEvent(new CustomEvent(${JSON.stringify(PASSKEY_ACK)}, { detail: request.id }));
    send({
      type: "passkey",
      doc,
      origin: location.origin,
      id: request.id,
      action: request.action === "create" ? "create" : "get",
      rpId: typeof request.rpId === "string" ? request.rpId : null,
      userName: typeof request.userName === "string" ? request.userName : null,
    });
  });
  document.addEventListener(${JSON.stringify(PASSKEY_DONE)}, (event) => {
    if (typeof event.detail === "string") send({ type: "passkeyGone", doc, id: event.detail });
  });

  globalThis.__t3Autofill = {
    // Focus and select a field so typed text replaces it; the caller types with trusted input.
    focus: (which) => {
      const fields = which === "username" ? [current.username] : current.passwords;
      const field = fields[0];
      if (!field?.isConnected) return 0;
      filling = true;
      try {
        field.scrollIntoView({ block: "center" });
        field.focus();
        field.select?.();
      } finally {
        filling = false;
      }
      return fields.length;
    },
    focusNth: (index) => {
      const field = current.passwords[index];
      if (!field?.isConnected) return false;
      filling = true;
      try { field.focus(); field.select?.(); } finally { filling = false; }
      return true;
    },
    answerPasskey: (id, allow) =>
      document.dispatchEvent(new CustomEvent(${JSON.stringify(PASSKEY_REPLY)}, {
        detail: JSON.stringify({ id, allow }),
      })),
  };
  schedule();
})();`;

/** Adds the autofill worlds to a page or frame session. Scripts need Page on and bindings need Runtime on. */
export const installAutofill = async (cdp: CDPSession) => {
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Runtime.addBinding", { name: BINDING, executionContextName: WORLD });
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: PASSKEY_HOOK_SCRIPT,
    runImmediately: true,
  });
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: AUTOFILL_SCRIPT,
    worldName: WORLD,
    runImmediately: true,
  });
};

/** What a viewer sees. `topOrigin` is set when the request comes from a frame of another site. */
export type CredentialPrompt =
  | {
      readonly id: string;
      readonly kind: "password";
      readonly origin: string;
      readonly topOrigin: string | null;
      readonly username: boolean;
      readonly password: boolean;
      readonly signup: boolean;
      readonly dismissed: boolean;
    }
  | {
      readonly id: string;
      readonly kind: "passkey";
      readonly origin: string;
      readonly topOrigin: string | null;
      readonly action: "get" | "create";
      readonly rpId: string | null;
      readonly userName: string | null;
    };

export type AutofillReport =
  | {
      readonly type: "form";
      readonly doc: string;
      readonly origin: string;
      readonly username: boolean;
      readonly password: boolean;
      readonly signup: boolean;
      readonly focused: boolean;
    }
  | { readonly type: "formGone"; readonly doc: string }
  | {
      readonly type: "passkey";
      readonly doc: string;
      readonly origin: string;
      readonly id: string;
      readonly action: "get" | "create";
      readonly rpId: string | null;
      readonly userName: string | null;
    }
  | { readonly type: "passkeyGone"; readonly doc: string; readonly id: string };

const str = (value: unknown, max = 512) => (typeof value === "string" ? value.slice(0, max) : null);

/** The isolated world reports these; the page cannot call the binding, but stay strict anyway. */
export const parseAutofillReport = (event: {
  readonly name: string;
  readonly payload: string;
}): AutofillReport | null => {
  if (event.name !== BINDING) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(event.payload);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const message = raw as Record<string, unknown>;
  const doc = str(message.doc, 64);
  if (!doc) return null;
  switch (message.type) {
    case "form": {
      const origin = str(message.origin);
      if (!origin) return null;
      return {
        type: "form",
        doc,
        origin,
        username: message.username === true,
        password: message.password === true,
        signup: message.signup === true,
        focused: message.focused === true,
      };
    }
    case "formGone":
      return { type: "formGone", doc };
    case "passkey": {
      const origin = str(message.origin);
      const id = str(message.id, 64);
      if (!origin || !id) return null;
      return {
        type: "passkey",
        doc,
        origin,
        id,
        action: message.action === "create" ? "create" : "get",
        rpId: str(message.rpId),
        userName: str(message.userName),
      };
    }
    case "passkeyGone": {
      const id = str(message.id, 64);
      return id ? { type: "passkeyGone", doc, id } : null;
    }
    default:
      return null;
  }
};

const callInWorld = async (cdp: CDPSession, contextId: number, expression: string) => {
  const { result, exceptionDetails } = await cdp.send("Runtime.evaluate", {
    contextId,
    expression,
    returnByValue: true,
  });
  if (exceptionDetails) throw new Error("The page's login form is gone.");
  return result.value as unknown;
};

const pressEnter = async (cdp: CDPSession) => {
  const key = { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 } as const;
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", ...key, text: "\r" });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...key });
};

/**
 * Types the values with trusted input so framework-controlled fields (React,
 * Vue, ...) see real edits. Values never enter logs, spans, or the page's main world.
 */
export const fillLogin = async (
  cdp: CDPSession,
  contextId: number,
  input: { readonly username?: string; readonly password?: string; readonly submit: boolean },
) => {
  let last: "username" | "password" | null = null;
  if (input.username) {
    if (await callInWorld(cdp, contextId, `globalThis.__t3Autofill?.focus("username") ?? 0`)) {
      await cdp.send("Input.insertText", { text: input.username });
      last = "username";
    }
  }
  if (input.password) {
    const count = Number(
      await callInWorld(cdp, contextId, `globalThis.__t3Autofill?.focus("password") ?? 0`),
    );
    for (let index = 0; index < count; index++) {
      if (
        index > 0 &&
        !(await callInWorld(cdp, contextId, `globalThis.__t3Autofill?.focusNth(${index}) ?? false`))
      )
        break;
      await cdp.send("Input.insertText", { text: input.password });
      last = "password";
    }
  }
  if (input.submit && last) await pressEnter(cdp);
  return last !== null;
};

export const answerPasskey = (
  cdp: CDPSession,
  contextId: number,
  requestId: string,
  allow: boolean,
) =>
  callInWorld(
    cdp,
    contextId,
    `globalThis.__t3Autofill?.answerPasskey(${JSON.stringify(requestId)}, ${allow})`,
  ).then(
    () => undefined,
    () => undefined,
  );
