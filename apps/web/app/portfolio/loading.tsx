import { RouteLoadingState } from "../../components/layout/RouteLoadingState";

export default function Loading() {
  return (
    <RouteLoadingState
      eyebrow="Portfolio"
      title="Loading portfolio workspace"
      body="Preparing holdings, allocation context, and the table-first review surface."
    />
  );
}
