import { rootLocalSchema } from "../../libs/config/src/env-schema.js";
import { dockerCloudSchema, dockerLocalSchema } from "../../libs/config/src/env-docker.js";
import {
  rootLocalGroups,
  dockerCloudGroups,
  dockerLocalGroups,
} from "../../libs/config/src/env-metadata.js";
import type { TargetConfig } from "./types.js";

export const targets: TargetConfig[] = [
  {
    id: "root:local",
    label: "Root: local",
    targetPath: ".env.local",
    schema: rootLocalSchema,
    groups: rootLocalGroups,
  },
  {
    id: "docker:dev",
    label: "Docker: dev",
    targetPath: "infra/docker/.env.dev",
    schema: dockerCloudSchema,
    groups: dockerCloudGroups,
    footerNotes: [
      "Compose-computed — set by docker-compose environment: block, not this file",
      "To change GOOGLE_REDIRECT_URI  → update PUBLIC_DOMAIN_API",
      "To change APP_BASE_URL         → update PUBLIC_DOMAIN_WEB",
      "To change DB_URL               → update POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB",
      "To change REDIS_URL            → update REDIS_PASSWORD",
      "To change ALLOWED_ORIGINS      → update PUBLIC_DOMAIN_WEB",
    ],
  },
  {
    id: "docker:local",
    label: "Docker: local",
    targetPath: "infra/docker/.env.local",
    schema: dockerLocalSchema,
    groups: dockerLocalGroups,
  },
  {
    id: "docker:prod",
    label: "Docker: prod",
    targetPath: "infra/docker/.env.prod",
    schema: dockerCloudSchema,
    groups: dockerCloudGroups,
    footerNotes: [
      "Compose-computed — set by docker-compose environment: block, not this file",
      "To change GOOGLE_REDIRECT_URI  → update PUBLIC_DOMAIN_API",
      "To change APP_BASE_URL         → update PUBLIC_DOMAIN_WEB",
      "To change DB_URL               → update POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB",
      "To change REDIS_URL            → update REDIS_PASSWORD",
      "To change ALLOWED_ORIGINS      → update PUBLIC_DOMAIN_WEB",
    ],
  },
];
