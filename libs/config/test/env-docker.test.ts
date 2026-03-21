import { describe, it, expect } from "vitest";
import { dockerDevSchema, dockerProdSchema } from "../src/env-docker.js";

const minDockerEnv = {
  POSTGRES_PASSWORD: "test-pw",
  REDIS_PASSWORD: "test-redis",
  CLOUDFLARE_TUNNEL_TOKEN: "test-token",
};

describe("dockerProdSchema", () => {
  it("defaults COOKIE_DOMAIN to .kzokvdevs.dpdns.org", () => {
    const result = dockerProdSchema.parse(minDockerEnv);
    expect(result.COOKIE_DOMAIN).toBe(".kzokvdevs.dpdns.org");
  });

  it("accepts an explicit COOKIE_DOMAIN override", () => {
    const result = dockerProdSchema.parse({
      ...minDockerEnv,
      COOKIE_DOMAIN: ".custom.com",
    });
    expect(result.COOKIE_DOMAIN).toBe(".custom.com");
  });

  it("defaults SESSION_COOKIE_NAME to g_auth_session (no __Host- prefix)", () => {
    const result = dockerProdSchema.parse(minDockerEnv);
    expect(result.SESSION_COOKIE_NAME).toBe("g_auth_session");
  });
});

describe("dockerDevSchema", () => {
  it("defaults COOKIE_DOMAIN to .kzokvdevs.dpdns.org", () => {
    const result = dockerDevSchema.parse(minDockerEnv);
    expect(result.COOKIE_DOMAIN).toBe(".kzokvdevs.dpdns.org");
  });

  it("accepts an explicit COOKIE_DOMAIN override", () => {
    const result = dockerDevSchema.parse({
      ...minDockerEnv,
      COOKIE_DOMAIN: ".custom.com",
    });
    expect(result.COOKIE_DOMAIN).toBe(".custom.com");
  });

  it("defaults SESSION_COOKIE_NAME to g_auth_session (no __Host- prefix)", () => {
    const result = dockerDevSchema.parse(minDockerEnv);
    expect(result.SESSION_COOKIE_NAME).toBe("g_auth_session");
  });
});
