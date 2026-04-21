import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { createPersistence } from "../persistence/index.js";

const emailSchema = z.string().trim().email().transform((value) => value.toLowerCase());

export async function main(argv: string[]): Promise<void> {
  const emailArg = argv[2];
  if (!emailArg) {
    console.error("Usage: npm run admin:promote -- email@example.com");
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

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  void main(process.argv);
}
