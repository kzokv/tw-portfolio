import type { BaseEndpoint } from "./BaseEndpoint.js";
import type { TTestAAAOptions } from "./types.js";
import { AAABase } from "./AAABase.js";

export class ApiAAABase<TInstance extends BaseEndpoint = BaseEndpoint> extends AAABase<TInstance> {
  get authHeaders(): Record<string, string> {
    const testUser = this.testUser as { sessionCookie?: string; userId?: string } | undefined;
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
