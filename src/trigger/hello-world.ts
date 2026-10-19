import { logger, task } from "@trigger.dev/sdk";

// Connectivity check for the Trigger.dev dev environment. Carries no business data.
export const helloWorld = task({
  id: "hello-world",
  run: async (payload: { name?: string }) => {
    logger.info("hello-world ran");
    return { message: `Hello ${payload.name ?? "GFS"}` };
  },
});
