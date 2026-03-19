import type { z } from "zod";
import type { EnvGroup } from "../../libs/config/src/env-metadata.js";

export type TargetId =
  | "root:local"
  | "root:dev"
  | "root:prod"
  | "docker:dev"
  | "docker:local"
  | "docker:prod"
  | "web:local"
  | "web:dev"
  | "web:prod";

export interface TargetConfig {
  id: TargetId;
  label: string;
  targetPath: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema: z.ZodObject<any>;
  groups: EnvGroup[];
}

export type MergeStrategy = "sync" | "override";

export interface ResolvedValue {
  key: string;
  value: string | undefined;
  source: "default" | "user" | "existing" | "source-file" | "auto-generated";
}
