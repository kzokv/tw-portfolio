import type { TAssistantFactoryOptions, TTestAAAOptions } from "../core/types.js";

type TAssistantConstructor<TAssistant> = new (options: TTestAAAOptions<unknown>) => TAssistant;

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
