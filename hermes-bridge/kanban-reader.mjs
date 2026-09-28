export function readKanbanTaskRows(db, limit = 200) {
  return db.prepare(
    `SELECT tasks.id, title, status, assignee, priority, result,
            started_at, completed_at, worker_pid, worker_started_at,
            last_heartbeat_at, current_run_id, block_kind, current_step_key,
            last_failure_error,
            (SELECT summary FROM task_runs
             WHERE task_id = tasks.id AND status IN ('done', 'completed')
             ORDER BY ended_at DESC, id DESC LIMIT 1) AS run_summary,
            (SELECT payload FROM task_events
             WHERE task_id = tasks.id AND kind = 'completed'
             ORDER BY id DESC LIMIT 1) AS completed_event_payload
     FROM tasks ORDER BY status ASC, priority DESC LIMIT ?`
  ).all(limit);
}
