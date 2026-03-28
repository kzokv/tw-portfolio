import type { TAssistantFactoryOptions, TTestAAAOptions } from "../core/types.js";

// Assistant subclasses can narrow the instance type from the generic factory input.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TAssistantConstructor<TAssistant> = new (options: TTestAAAOptions<any>) => TAssistant;

interface TCreateAssistantFactoryOptions<TArrange, TActions, TAssert> {
  Arrange: TAssistantConstructor<TArrange>;
  Actions: TAssistantConstructor<TActions>;
  Assert: TAssistantConstructor<TAssert>;
}

export function createAssistantFactory<TArrange, TActions, TAssert>(
  options: TCreateAssistantFactoryOptions<TArrange, TActions, TAssert>,
) {
  return (factoryOptions: TAssistantFactoryOptions) => ({
    arrange: new options.Arrange(factoryOptions),
    actions: new options.Actions(factoryOptions),
    assert: new options.Assert(factoryOptions),
  });
}
