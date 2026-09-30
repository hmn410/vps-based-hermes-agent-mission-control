function parsedObject(payload) {
  try {
    const value = payload ? JSON.parse(payload) : {};
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

/** Adds the task row's current telemetry to otherwise sparse heartbeat events. */
export function enrichExecutionEventPayload(event, task) {
  if (event.kind !== "heartbeat") return event.payload;
  const payload = parsedObject(event.payload);
  const enriched = {
    ...payload,
    ...(payload.current_step_key || !task.current_step_key ? {} : { current_step_key: task.current_step_key }),
    ...(payload.worker_pid || !task.worker_pid ? {} : { worker_pid: task.worker_pid }),
    ...(payload.current_run_id || !task.current_run_id ? {} : { current_run_id: task.current_run_id }),
  };
  return JSON.stringify(enriched);
}
