import { afterEach, assert, beforeEach, describe, it, vi } from "vitest";
import {
  hasSensitiveWsToken,
  isWindowsPlatform,
  redactWsEndpointUrl,
  resolveRuntimeWsEndpointUrl,
} from "./utils";

const originalWindow = globalThis.window;

describe("isWindowsPlatform", () => {
  it("matches Windows platform identifiers", () => {
    assert.isTrue(isWindowsPlatform("Win32"));
    assert.isTrue(isWindowsPlatform("Windows"));
    assert.isTrue(isWindowsPlatform("windows_nt"));
  });

  it("does not match darwin", () => {
    assert.isFalse(isWindowsPlatform("darwin"));
  });
});

describe("runtime websocket endpoint helpers", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        location: {
          origin: "http://localhost:3020",
          protocol: "http:",
        },
        desktopBridge: undefined,
      },
    });
    vi.stubEnv("VITE_WS_URL", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  });

  it("resolves http origins to ws /ws endpoints", () => {
    Object.assign(window.location, {
      origin: "http://localhost:3020",
      protocol: "http:",
    });

    assert.strictEqual(resolveRuntimeWsEndpointUrl(), "ws://localhost:3020/ws");
  });

  it("resolves https origins to wss /ws endpoints", () => {
    Object.assign(window.location, {
      origin: "https://app.example.com",
      protocol: "https:",
    });

    assert.strictEqual(resolveRuntimeWsEndpointUrl(), "wss://app.example.com/ws");
  });

  it("normalizes desktop websocket urls to /ws and preserves token params", () => {
    Object.defineProperty(window, "desktopBridge", {
      configurable: true,
      value: {
        getLocalEnvironmentBootstrap: () => ({
          label: "Local environment",
          httpBaseUrl: "http://127.0.0.1:4123/",
          wsBaseUrl: "ws://127.0.0.1:4123/?token=secret-token",
          bootstrapToken: "bootstrap-token",
        }),
      } as Partial<NonNullable<typeof window.desktopBridge>>,
    });

    assert.strictEqual(resolveRuntimeWsEndpointUrl(), "ws://127.0.0.1:4123/ws?token=secret-token");
  });

  it("preserves non-secret query params when normalizing to /ws", () => {
    vi.stubEnv("VITE_WS_URL", "ws://localhost:4123/?foo=bar&token=secret-token&debug=1");

    assert.strictEqual(
      resolveRuntimeWsEndpointUrl(),
      "ws://localhost:4123/ws?foo=bar&token=secret-token&debug=1",
    );
  });

  it("masks only the token query param", () => {
    assert.strictEqual(
      redactWsEndpointUrl("ws://localhost:4123/ws?foo=bar&token=secret-token&debug=1"),
      "ws://localhost:4123/ws?foo=bar&token=••••••&debug=1",
    );
  });

  it("keeps non-token params visible after redaction", () => {
    const redacted = redactWsEndpointUrl("ws://localhost:4123/ws?foo=bar&token=secret-token");

    assert.isTrue(redacted.includes("foo=bar"));
    assert.isFalse(redacted.includes("secret-token"));
  });

  it("detects token-bearing websocket urls", () => {
    assert.isTrue(hasSensitiveWsToken("ws://localhost:4123/ws?token=secret-token"));
    assert.isFalse(hasSensitiveWsToken("ws://localhost:4123/ws?foo=bar"));
  });

  it("returns null when endpoint resolution input is malformed", () => {
    vi.stubEnv("VITE_WS_URL", "://bad-url");
    Object.assign(window.location, {
      origin: "",
    });

    assert.isNull(resolveRuntimeWsEndpointUrl());
  });
});
