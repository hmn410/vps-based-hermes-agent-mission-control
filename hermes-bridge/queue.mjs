export async function claimRequest(q, id) {
  const result = await q(
    `UPDATE "AgentRequest"
     SET status='running', "startedAt"=now(), "updatedAt"=now()
     WHERE id=$1 AND status IN ('queued','approved')`,
    [id],
  );
  return result.rowCount === 1;
}
