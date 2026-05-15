import type { BaseEndpoint, Constructor, TestUser } from "@vakwen/test-framework/core";

export function createApiFixture<TAssistant>(
  EndpointClass: Constructor<BaseEndpoint>,
) {
  return async (
    { testUser }: { testUser: TestUser },
    use: (assistant: TAssistant) => Promise<void>,
  ) => {
    await use(await testUser.useApiAssistant<BaseEndpoint, TAssistant>(EndpointClass));
  };
}
