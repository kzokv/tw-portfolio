import type { APIRequestContext } from "@playwright/test";

export abstract class BaseEndpoint {
  constructor(protected readonly request: APIRequestContext) {}
}
