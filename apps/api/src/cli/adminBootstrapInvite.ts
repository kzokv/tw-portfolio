import { z } from "zod";
import { Env } from "@tw-portfolio/config";
import { createPersistence } from "../persistence/index.js";

const emailSchema = z.string().trim().email().transform((value) => value.toLowerCase());
const roleSchema = z.enum(["admin", "member", "viewer"]);

async function main(): Promise<void> {
  const emailArg = process.argv[2];
  const roleArg = process.argv[3];

  if (!emailArg || !roleArg) {
    console.error("Usage: npm run admin:bootstrap-invite -- email@example.com admin");
    process.exitCode = 1;
    return;
  }

  const email = emailSchema.parse(emailArg);
  const role = roleSchema.parse(roleArg);
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

void main();
