import type { BaseEndpoint } from "./BaseEndpoint.js";
import type { TTestAAAOptions } from "./types.js";
import { AAABase } from "./AAABase.js";

export class ApiAAABase<TInstance extends BaseEndpoint = BaseEndpoint> extends AAABase<TInstance> {
  /**
   * Returns auth headers for API requests.
   *
   * Priority: sessionCookie wins over userId. When a sessionCookie is set,
   * the `x-user-id` header is omitted entirely — the API authenticates via
   * the cookie instead. If both are present, a warning is logged since this
   * typically indicates confused test setup.
   */
  get authHeaders(): Record<string, string> {
    const testUser = this.testUser as { sessionCookie?: string; userId?: string } | undefined;

    if (testUser?.sessionCookie && testUser.userId) {
      console.warn(
        `[ApiAAABase] authHeaders: sessionCookie and userId both set for user "${testUser.userId}" — sessionCookie takes priority, userId header omitted`,
      );
    }

    if (testUser?.sessionCookie) {
      return { cookie: testUser.sessionCookie };
    }

    const userId = testUser?.userId ?? this.userId;
    return userId ? { "x-user-id": userId } : {};
  }

  constructor(options: TTestAAAOptions<TInstance>) {
    super(options);
  }
}
