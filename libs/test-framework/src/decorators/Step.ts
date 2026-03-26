import { test } from "@playwright/test";

interface TStepActor {
  displayName?: unknown;
  testUser?: unknown;
  userId?: unknown;
}

function humanizeStepName(name: string | symbol): string {
  if (typeof name === "symbol") {
    return "step";
  }

  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (value) => value.toUpperCase());
}

function hasActiveTestContext(): boolean {
  try {
    test.info();
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolves the human-readable label for a step actor.
 * Prefers `testUser.displayName` (e.g. `sa:0:Alice`) over raw `userId`
 * for shorter, more readable step traces. Falls back to userId if displayName
 * is not set (e.g. in non-E2E contexts).
 */
function resolveDisplayName(actor: unknown): string | undefined {
  if (!actor || typeof actor !== "object") {
    return undefined;
  }

  const candidate = actor as TStepActor;
  const nestedTestUser = candidate.testUser as TStepActor | undefined;

  if (typeof nestedTestUser?.displayName === "string" && nestedTestUser.displayName.length > 0) {
    return nestedTestUser.displayName;
  }
  if (typeof candidate.displayName === "string" && candidate.displayName.length > 0) {
    return candidate.displayName;
  }
  if (typeof nestedTestUser?.userId === "string" && nestedTestUser.userId.length > 0) {
    return nestedTestUser.userId;
  }
  if (typeof candidate.userId === "string" && candidate.userId.length > 0) {
    return candidate.userId;
  }

  return undefined;
}

function formatStepLabel(stepLabel: string, actor: unknown): string {
  const name = resolveDisplayName(actor);
  return name ? `User[${name}] ${stepLabel}` : stepLabel;
}

export function Step(label?: string) {
  return function <TThis, TArgs extends unknown[], TReturn>(
    target: (this: TThis, ...args: TArgs) => TReturn | Promise<TReturn>,
    context: ClassMethodDecoratorContext<TThis, (this: TThis, ...args: TArgs) => TReturn | Promise<TReturn>>,
  ) {
    const stepLabel = label ?? humanizeStepName(context.name);

    return async function (this: TThis, ...args: TArgs): Promise<Awaited<TReturn>> {
      const runStep = async (): Promise<Awaited<TReturn>> => await target.apply(this, args);
      const decoratedStepLabel = formatStepLabel(stepLabel, this);

      if (!hasActiveTestContext()) {
        console.info(`[step] ${decoratedStepLabel}`);
        return await runStep();
      }

      return await test.step(decoratedStepLabel, runStep, { box: true });
    };
  };
}
