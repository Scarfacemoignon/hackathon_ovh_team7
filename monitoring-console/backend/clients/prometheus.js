const PROMETHEUS_URL = process.env.PROMETHEUS_URL || "http://localhost:9090";

/**
 * Execute une requete PromQL instantanee et renvoie la premiere valeur
 * scalaire du resultat (ou null si la serie est vide, ex: namespace sans pods).
 */
export async function queryPrometheusScalar(promql) {
  const params = new URLSearchParams({ query: promql });
  const res = await fetch(`${PROMETHEUS_URL}/api/v1/query?${params}`);
  if (!res.ok) {
    throw new Error(`Prometheus a repondu ${res.status} pour la requete: ${promql}`);
  }
  const data = await res.json();
  const result = data.data?.result?.[0];
  if (!result || result.value === undefined) return null;
  return Number(result.value[1]);
}
