import { GraphError } from "@/lib/graph";
import { AuthRequired } from "@/lib/graph-token";
import { markFailed } from "@/lib/pipeline";

// Shared `onFailure` hook for every task that works on one contract. It runs once all retries are used up.
export const markContractFailed = ({ payload, error }: { payload: { contractId: string }; error: unknown }) =>
  markFailed(payload.contractId, error);

// Retry policy shared by the contract tasks: a lapsed sign-in needs the owner, throttling says when to come back.
export const contractCatchError = ({ error }: { error: unknown }) => {
  if (error instanceof AuthRequired) return { skipRetrying: true };
  if (error instanceof GraphError && error.retryAfterMs) return { retryAt: new Date(Date.now() + error.retryAfterMs) };
};
