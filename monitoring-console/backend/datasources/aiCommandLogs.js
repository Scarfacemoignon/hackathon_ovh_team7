import { queryLoki } from "../clients/loki.js";

/**
 * Interroge Loki pour les commandes IA du remediateur (namespace="ai-remediation",
 * type="ai_command" dans le JSON de la ligne).
 * - "ai-remediation" est la source de toutes les commandes, pas une cible :
 *   pour ce namespace-la on ne filtre pas sur target_namespace.
 * - dev/staging/prod sont des cibles : on filtre sur target_namespace.
 */
export async function getAiCommandLogs(namespace) {
  const logql =
    namespace === "ai-remediation"
      ? `{namespace="ai-remediation"} | json | type="ai_command"`
      : `{namespace="ai-remediation"} | json | type="ai_command" | target_namespace="${namespace}"`;

  const rows = await queryLoki(logql);
  return rows
    .map((r) => r.log)
    .filter(Boolean)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}
