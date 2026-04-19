import { createAssistantFactory } from "@tw-portfolio/test-framework/config";

import { AnonymousShareActions } from "./AnonymousShareActions.js";
import { AnonymousShareArrange } from "./AnonymousShareArrange.js";
import { AnonymousShareAssert } from "./AnonymousShareAssert.js";
import { ContextSwitcherActions } from "./ContextSwitcherActions.js";
import { ContextSwitcherArrange } from "./ContextSwitcherArrange.js";
import { ContextSwitcherAssert } from "./ContextSwitcherAssert.js";
import { SharingActions } from "./SharingActions.js";
import { SharingArrange } from "./SharingArrange.js";
import { SharingAssert } from "./SharingAssert.js";

export const sharingAssistantFactory = createAssistantFactory({
  Arrange: SharingArrange,
  Actions: SharingActions,
  Assert: SharingAssert,
});

export type TSharingAssistant = ReturnType<typeof sharingAssistantFactory>;

export const contextSwitcherAssistantFactory = createAssistantFactory({
  Arrange: ContextSwitcherArrange,
  Actions: ContextSwitcherActions,
  Assert: ContextSwitcherAssert,
});

export type TContextSwitcherAssistant = ReturnType<typeof contextSwitcherAssistantFactory>;

export const anonymousShareAssistantFactory = createAssistantFactory({
  Arrange: AnonymousShareArrange,
  Actions: AnonymousShareActions,
  Assert: AnonymousShareAssert,
});

export type TAnonymousShareAssistant = ReturnType<typeof anonymousShareAssistantFactory>;

export * from "./AnonymousShareActions.js";
export * from "./AnonymousShareArrange.js";
export * from "./AnonymousShareAssert.js";
export * from "./ContextSwitcherActions.js";
export * from "./ContextSwitcherArrange.js";
export * from "./ContextSwitcherAssert.js";
export * from "./SharingActions.js";
export * from "./SharingArrange.js";
export * from "./SharingAssert.js";
