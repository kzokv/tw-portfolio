import { test } from "@playwright/test";

interface TStepActor {
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

function resolveUserId(actor: unknown): string | undefined {
  if (!actor || typeof actor !== "object") {
    return undefined;
  }

  const candidate = actor as TStepActor;
  if (typeof candidate.userId === "string" && candidate.userId.length > 0) {
    return candidate.userId;
  }

  const nestedTestUser = candidate.testUser as TStepActor | undefined;
  if (typeof nestedTestUser?.userId === "string" && nestedTestUser.userId.length > 0) {
    return nestedTestUser.userId;
  }

  return undefined;
}

function formatStepLabel(stepLabel: string, actor: unknown): string {
  const userId = resolveUserId(actor);
  return userId ? `User[${userId}] ${stepLabel}` : stepLabel;
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
