import type { ComponentType } from "react";

export default function dynamic<TProps>(
  _loader: unknown,
  options?: { loading?: ComponentType },
): ComponentType<TProps> {
  const Loading = options?.loading;

  return function DynamicStub(_props: TProps) {
    return Loading ? <Loading /> : null;
  };
}
