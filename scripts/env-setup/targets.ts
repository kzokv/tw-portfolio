import { envSchema } from "../../libs/config/src/env-schema.js";
import { dockerDevSchema, dockerProdSchema } from "../../libs/config/src/env-docker.js";
import { webEnvSchema } from "../../libs/config/src/env-web.js";
import {
  envGroups,
  dockerDevGroups,
  dockerProdGroups,
  webEnvGroups,
} from "../../libs/config/src/env-metadata.js";
import type { TargetConfig } from "./types.js";

export const targets: TargetConfig[] = [
  {
    id: "root:local",
    label: "Root: local",
    targetPath: ".env.local",
    schema: envSchema,
    groups: envGroups,
  },
  {
    id: "root:dev",
    label: "Root: dev",
    targetPath: ".env.dev",
    schema: envSchema,
    groups: envGroups,
  },
  {
    id: "root:prod",
    label: "Root: prod",
    targetPath: ".env.prod",
    schema: envSchema,
    groups: envGroups,
  },
  {
    id: "docker:dev",
    label: "Docker: dev",
    targetPath: "infra/docker/.env.dev",
    schema: dockerDevSchema,
    groups: dockerDevGroups,
  },
  {
    id: "docker:prod",
    label: "Docker: prod",
    targetPath: "infra/docker/.env.prod",
    schema: dockerProdSchema,
    groups: dockerProdGroups,
  },
  {
    id: "web:local",
    label: "Web: local",
    targetPath: "apps/web/.env.local",
    schema: webEnvSchema,
    groups: webEnvGroups,
  },
  {
    id: "web:dev",
    label: "Web: dev",
    targetPath: "apps/web/.env.dev",
    schema: webEnvSchema,
    groups: webEnvGroups,
  },
  {
    id: "web:prod",
    label: "Web: prod",
    targetPath: "apps/web/.env.prod",
    schema: webEnvSchema,
    groups: webEnvGroups,
  },
];
