import type { ScopedThreadRef } from "@t3tools/contracts";
import { create } from "zustand";

import { useRightPanelStore } from "~/rightPanelStore";

export interface LoginFieldHighlight {
  readonly threadId: string;
  readonly tabId: string;
  readonly field: "username" | "password";
}

/** Held until that tab's browser surface is connected and can draw it. */
export const useLoginFieldHighlight = create<{
  readonly pending: LoginFieldHighlight | null;
}>(() => ({ pending: null }));

export function showLoginField(
  threadRef: ScopedThreadRef,
  tabId: string,
  field: LoginFieldHighlight["field"],
): void {
  useRightPanelStore.getState().openBrowser(threadRef, tabId);
  useLoginFieldHighlight.setState({ pending: { threadId: threadRef.threadId, tabId, field } });
}
