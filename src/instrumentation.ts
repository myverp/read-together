import type { Instrumentation } from "next";
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initializeErrorReporting } = await import("./lib/error-reporting");
    initializeErrorReporting();
  }
}
export const onRequestError: Instrumentation.onRequestError = async (_error, _request, context) => {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { reportServerError } = await import("./lib/error-reporting");
    reportServerError({ operation: "unhandled-request", route: context.routePath, status: 500 });
  }
};
