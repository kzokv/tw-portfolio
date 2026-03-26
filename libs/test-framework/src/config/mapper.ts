import type { Constructor, TAssistantFactory, TAssistantFactoryOptions } from "../core/types.js";

type TAnyAssistantFactory = TAssistantFactory<unknown, unknown>;

export class AssistantFactoryRegistry {
  private readonly registry = new Map<Constructor<unknown>, TAnyAssistantFactory>();

  register<TInstance, TAssistant>(
    target: Constructor<TInstance>,
    factory: TAssistantFactory<TInstance, TAssistant>,
  ): this {
    this.registry.set(target as Constructor<unknown>, factory as TAnyAssistantFactory);
    return this;
  }

  has<TInstance>(target: Constructor<TInstance>): boolean {
    return this.registry.has(target as Constructor<unknown>);
  }

  get<TInstance, TAssistant>(
    target: Constructor<TInstance>,
  ): TAssistantFactory<TInstance, TAssistant> | undefined {
    return this.registry.get(target as Constructor<unknown>) as
      | TAssistantFactory<TInstance, TAssistant>
      | undefined;
  }

  async create<TInstance, TAssistant>(
    target: Constructor<TInstance>,
    options: TAssistantFactoryOptions<TInstance>,
  ): Promise<TAssistant> {
    const factory = this.get<TInstance, TAssistant>(target);
    if (!factory) {
      throw new Error(`No assistant factory registered for ${target.name}`);
    }

    return await factory(options);
  }
}

export const webAssistantRegistry = new AssistantFactoryRegistry();
export const appInjectAssistantRegistry = new AssistantFactoryRegistry();
