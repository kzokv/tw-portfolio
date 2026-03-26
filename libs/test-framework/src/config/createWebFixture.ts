import type { BasePage } from "../core/BasePage.js";
import type { TestUser } from "../core/TestUser.js";
import type { Constructor } from "../core/types.js";

export function createWebFixture<TAssistant>(
  PageClass: Constructor<BasePage<unknown>>,
) {
  return async (
    { testUser }: { testUser: TestUser },
    use: (assistant: TAssistant) => Promise<void>,
  ) => {
    await use(await testUser.useWebAssistant<BasePage<unknown>, TAssistant>(PageClass));
  };
}
