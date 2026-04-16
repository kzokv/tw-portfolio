import { z } from "zod";
import { createPersistence } from "../persistence/index.js";

const emailSchema = z.string().trim().email().transform((value) => value.toLowerCase());

async function main(): Promise<void> {
  const emailArg = process.argv[2];
  if (!emailArg) {
    console.error("Usage: npm run admin:promote -- email@example.com");
    process.exitCode = 1;
    return;
  }

  const email = emailSchema.parse(emailArg);
  const persistence = createPersistence();
  await persistence.init();

  try {
    const user = await persistence.promoteUserToAdminByEmail(email, "admin_promote_cli");
    if (!user) {
      console.error("user must sign in first, or issue an invite");
      process.exitCode = 1;
      return;
    }

    console.log(`Promoted ${user.email ?? email} (${user.userId}) to admin`);
  } finally {
    await persistence.close();
  }
}

void main();
