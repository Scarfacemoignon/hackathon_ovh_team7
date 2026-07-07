const ARGOCD_URL = process.env.ARGOCD_URL || "http://localhost:8080";
const ARGOCD_TOKEN = process.env.ARGOCD_TOKEN || "";

/**
 * Recupere une Application Argo CD par son nom.
 * Renvoie null si elle n'existe pas (404) — utile pour les namespaces
 * qui ne sont pas geres par GitOps (ex: ai-remediation).
 */
export async function getArgoApplication(appName) {
  const res = await fetch(`${ARGOCD_URL}/api/v1/applications/${appName}`, {
    headers: ARGOCD_TOKEN ? { Authorization: `Bearer ${ARGOCD_TOKEN}` } : {},
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Argo CD a repondu ${res.status} pour l'application: ${appName}`);
  }
  return res.json();
}
