import { createAssistantFactory } from "@vakwen/test-framework/config";

import { AuthErrorActions } from "./AuthErrorActions.js";
import { AuthErrorArrange } from "./AuthErrorArrange.js";
import { AuthErrorAssert } from "./AuthErrorAssert.js";
import { LoginActions } from "./LoginActions.js";
import { LoginArrange } from "./LoginArrange.js";
import { LoginAssert } from "./LoginAssert.js";
import { SessionActions } from "./SessionActions.js";
import { SessionArrange } from "./SessionArrange.js";
import { SessionAssert } from "./SessionAssert.js";

export const loginAssistantFactory = createAssistantFactory({
  Arrange: LoginArrange,
  Actions: LoginActions,
  Assert: LoginAssert,
});

export type TLoginAssistant = ReturnType<typeof loginAssistantFactory>;

export const authErrorAssistantFactory = createAssistantFactory({
  Arrange: AuthErrorArrange,
  Actions: AuthErrorActions,
  Assert: AuthErrorAssert,
});

export type TAuthErrorAssistant = ReturnType<typeof authErrorAssistantFactory>;

export const sessionAssistantFactory = createAssistantFactory({
  Arrange: SessionArrange,
  Actions: SessionActions,
  Assert: SessionAssert,
});

export type TSessionAssistant = ReturnType<typeof sessionAssistantFactory>;

export * from "./LoginArrange.js";
export * from "./LoginActions.js";
export * from "./LoginAssert.js";
export * from "./AuthErrorArrange.js";
export * from "./AuthErrorActions.js";
export * from "./AuthErrorAssert.js";
export * from "./SessionArrange.js";
export * from "./SessionActions.js";
export * from "./SessionAssert.js";
