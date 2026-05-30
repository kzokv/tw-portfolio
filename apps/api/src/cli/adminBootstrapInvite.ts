import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { Env } from "@vakwen/config";
import { createPersistence } from "../persistence/index.js";

const emailSchema = z.string().trim().email().transform((value) => value.toLowerCase());
const roleSchema = z.enum(["admin", "member", "viewer"]);

export async function main(argv: string[]): Promise<void> {
  const emailArg = argv[2];
  const roleArg = argv[3];

  if (!emailArg || !roleArg) {
    console.error("Usage: npm run admin:bootstrap-invite -- email@example.com admin");
    process.exitCode = 1;
    return;
  }

  let email: string;
  try {
    email = emailSchema.parse(emailArg);
  } catch (err) {
    if (err instanceof z.ZodError) {
      console.error(`invalid email: ${emailArg}`);
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  let role: z.infer<typeof roleSchema>;
  try {
    role = roleSchema.parse(roleArg);
  } catch (err) {
    if (err instanceof z.ZodError) {
      console.error(`invalid role: ${roleArg}`);
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  const persistence = createPersistence();
  await persistence.init();

  try {
    const existingUser = await persistence.getAuthUserByEmail(email);
    if (existingUser) {
      console.error("A user with that email already exists");
      process.exitCode = 1;
      return;
    }

    const invite = await persistence.insertBootstrapInvite({
      email,
      role,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      issuedByUserId: null,
    });

    const appBaseUrl = Env.APP_BASE_URL ?? "http://localhost:3000";
    console.log(`Created invite ${invite.code} for ${invite.email}`);
    console.log(`${appBaseUrl}/invite/${invite.code}`);
  } finally {
    await persistence.close();
  }
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  void main(process.argv);
}
