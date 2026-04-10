import { CommandId, MessageId, ProjectId, ThreadId } from "@t3tools/contracts";
import { type CxOptions, cx } from "class-variance-authority";
import { twMerge } from "tailwind-merge";
import * as Random from "effect/Random";
import * as Effect from "effect/Effect";
import { DraftId } from "../composerDraftStore";

export function cn(...inputs: CxOptions) {
  return twMerge(cx(inputs));
}

export function isMacPlatform(platform: string): boolean {
  return /mac|iphone|ipad|ipod/i.test(platform);
}

export function isWindowsPlatform(platform: string): boolean {
  return /^win(dows)?/i.test(platform);
}

export function isLinuxPlatform(platform: string): boolean {
  return /linux/i.test(platform);
}

export function randomUUID(): string {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return Effect.runSync(Random.nextUUIDv4);
}

export const newCommandId = (): CommandId => CommandId.make(randomUUID());

export const newProjectId = (): ProjectId => ProjectId.make(randomUUID());

export const newThreadId = (): ThreadId => ThreadId.make(randomUUID());

export const newDraftId = (): DraftId => DraftId.make(randomUUID());

export const newMessageId = (): MessageId => MessageId.make(randomUUID());

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

const firstNonEmptyString = (...values: unknown[]): string => {
  for (const value of values) {
    if (isNonEmptyString(value)) {
      return value;
    }
  }
  throw new Error("No non-empty string provided");
};

function getRuntimeServerUrlInput(url?: string): string {
  return firstNonEmptyString(
    url,
    window.desktopBridge?.getLocalEnvironmentBootstrap()?.wsBaseUrl,
    import.meta.env.VITE_WS_URL,
    window.location.origin,
  );
}

function normalizeWsProtocol(rawUrl: URL): void {
  if (rawUrl.protocol === "http:" || rawUrl.protocol === "https:") {
    rawUrl.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  }
}

function normalizeWsEndpointUrl(url: string): string | null {
  try {
    const parsedUrl = new URL(url);
    normalizeWsProtocol(parsedUrl);
    parsedUrl.pathname = "/ws";
    return parsedUrl.toString();
  } catch {
    return null;
  }
}

export function resolveRuntimeWsEndpointUrl(): string | null {
  try {
    return normalizeWsEndpointUrl(getRuntimeServerUrlInput());
  } catch {
    return null;
  }
}

export function hasSensitiveWsToken(url: string): boolean {
  try {
    return new URL(url).searchParams.has("token");
  } catch {
    return false;
  }
}

export function redactWsEndpointUrl(url: string): string {
  try {
    const parsedUrl = new URL(url);
    if (!parsedUrl.searchParams.has("token")) {
      return parsedUrl.toString();
    }

    const redactedSearch = parsedUrl.search
      .slice(1)
      .split("&")
      .map((part) => {
        const [rawKey] = part.split("=");
        if (!rawKey || decodeURIComponent(rawKey) !== "token") {
          return part;
        }
        return `${rawKey}=••••••`;
      })
      .join("&");

    return `${parsedUrl.origin}${parsedUrl.pathname}${redactedSearch ? `?${redactedSearch}` : ""}${parsedUrl.hash}`;
  } catch {
    return url;
  }
}
