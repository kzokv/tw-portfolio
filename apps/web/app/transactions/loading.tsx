import { RouteLoadingState } from "../../components/layout/RouteLoadingState";

export default function Loading() {
  return (
    <RouteLoadingState
      eyebrow="Transactions"
      title="Loading transactions workspace"
      body="Preparing the ledger, inbox context, and transaction entry tools."
    />
  );
}
