import { createAssistantFactory } from "@tw-portfolio/test-framework/config";
import { NotificationsApiActions } from "./NotificationsApiActions.js";
import { NotificationsApiArrange } from "./NotificationsApiArrange.js";
import { NotificationsApiAssert } from "./NotificationsApiAssert.js";

export const notificationsApiAssistantFactory = createAssistantFactory({
  Arrange: NotificationsApiArrange,
  Actions: NotificationsApiActions,
  Assert: NotificationsApiAssert,
});

export type TNotificationsApiAssistant = ReturnType<typeof notificationsApiAssistantFactory>;

export * from "./NotificationsApiActions.js";
export * from "./NotificationsApiArrange.js";
export * from "./NotificationsApiAssert.js";
