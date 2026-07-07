import { getArgoApplication } from "../clients/argocd.js";

/**
 * Interroge Argo CD pour le statut GitOps de l'app "vulnerable-app-<namespace>".
 * "ai-remediation" n'est pas geree par Argo CD (c'est un CronJob) : on renvoie
 * null directement sans appeler l'API.
 */
export async function getGitopsStatus(namespace) {
  if (namespace === "ai-remediation") return null;

  const app = await getArgoApplication(`vulnerable-app-${namespace}`);
  if (!app) return null;

  return {
    app: app.metadata?.name || `vulnerable-app-${namespace}`,
    sync_status: app.status?.sync?.status || "Unknown",
    health_status: app.status?.health?.status || "Unknown",
    last_synced_at: app.status?.reconciledAt || app.status?.operationState?.finishedAt || null,
  };
}
