export function readKanbanTaskRows(db, limit = 200) {
  return db.prepare(
    `SELECT tasks.id, title, status, assignee, priority, result,
            started_at, completed_at, worker_pid, worker_started_at,
            last_heartbeat_at, current_run_id, block_kind, block_recurrences, current_step_key,
            COALESCE(
              last_failure_error,
              (SELECT payload FROM task_events
               WHERE task_id = tasks.id AND kind = 'blocked'
               ORDER BY id DESC LIMIT 1)
            ) AS last_failure_error,
            (SELECT summary FROM task_runs
             WHERE task_id = tasks.id AND status IN ('done', 'completed')
             ORDER BY ended_at DESC, id DESC LIMIT 1) AS run_summary,
            (SELECT payload FROM task_events
             WHERE task_id = tasks.id AND kind = 'completed'
             ORDER BY id DESC LIMIT 1) AS completed_event_payload
     FROM tasks
     WHERE status != 'archived'
     ORDER BY
       CASE status
         WHEN 'triage' THEN 0
         WHEN 'todo' THEN 1
         WHEN 'ready' THEN 2
         WHEN 'running' THEN 3
         WHEN 'review' THEN 4
         WHEN 'blocked' THEN 5
         WHEN 'done' THEN 6
         ELSE 7
       END ASC,
       CASE WHEN status = 'done' THEN completed_at END DESC,
       priority DESC,
       id ASC
     LIMIT ?`
  ).all(limit);
}

// One task's complete lifecycle event history (oldest first). Used to derive
// the CURRENT block reason/recurrence independently of the bounded global
// event feed, which drops older block events for long-lived tasks.
export function readKanbanTaskEvents(db, taskId) {
  return db.prepare(
    `SELECT id, kind, payload, created_at FROM task_events
     WHERE task_id = ? AND kind != 'heartbeat'
     ORDER BY id ASC`
  ).all(taskId);
}
