import { RouteLoadingState } from "../../components/layout/RouteLoadingState";

export default function Loading() {
  return (
    <RouteLoadingState
      eyebrow="Settings"
      title="Loading settings"
      body="Preparing account, display, and profile controls for this section."
    />
  );
}
