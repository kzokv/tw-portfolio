import { RouteLoadingState } from "../../../components/layout/RouteLoadingState";

export default function Loading() {
  return (
    <RouteLoadingState
      eyebrow="Ticker detail"
      title="Loading ticker detail"
      body="Preparing price history, fundamentals, and your current position context."
    />
  );
}
