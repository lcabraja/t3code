import { describe, expect, it } from "vite-plus/test";

import { parseAutofillReport } from "./ServerBrowserAutofill.ts";

const report = (payload: unknown, name = "__t3AutofillReport") => ({
  name,
  payload: typeof payload === "string" ? payload : JSON.stringify(payload),
});

describe("parseAutofillReport", () => {
  it("reads login forms and passkey requests from the autofill world", () => {
    expect(
      parseAutofillReport(
        report({
          type: "form",
          doc: "d1",
          origin: "https://acme.test",
          username: true,
          password: true,
          signup: false,
          usernameLabel: "Email address",
          focused: true,
        }),
      ),
    ).toEqual({
      type: "form",
      doc: "d1",
      origin: "https://acme.test",
      username: true,
      password: true,
      signup: false,
      usernameLabel: "Email address",
      passwordLabel: null,
      focused: true,
    });
    expect(
      parseAutofillReport(
        report({
          type: "passkey",
          doc: "d1",
          origin: "https://acme.test",
          id: "p1",
          action: "create",
          rpId: "acme.test",
          userName: "luka",
        }),
      ),
    ).toEqual({
      type: "passkey",
      doc: "d1",
      origin: "https://acme.test",
      id: "p1",
      action: "create",
      rpId: "acme.test",
      userName: "luka",
    });
  });

  it.each([
    ["another binding", report({ type: "formGone", doc: "d1" }, "pageBinding")],
    ["malformed JSON", report("{")],
    ["no document", report({ type: "formGone" })],
    ["a form without an origin", report({ type: "form", doc: "d1", password: true })],
    ["a passkey without a request id", report({ type: "passkey", doc: "d1", origin: "o" })],
    ["an unknown type", report({ type: "steal", doc: "d1" })],
  ])("ignores %s", (_, event) => {
    expect(parseAutofillReport(event)).toBeNull();
  });
});
