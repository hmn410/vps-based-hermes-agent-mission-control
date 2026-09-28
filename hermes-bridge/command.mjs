export function formatHermesCommandError(error, timeoutMs) {
  if (error?.code === "ETIMEDOUT" || (error?.killed && error?.signal === "SIGTERM")) {
    const minutes = Math.max(1, Math.round(timeoutMs / 60000));
    return `Dispatch timed out after ${minutes} minutes. The task may need a more specific target or a browser session.`;
  }

  const detail = error?.stderr || error?.message || "Hermes command failed";
  return String(detail).trim().split("\n")[0].slice(0, 600);
}
