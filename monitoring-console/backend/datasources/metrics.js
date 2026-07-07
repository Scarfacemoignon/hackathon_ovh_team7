import { queryPrometheusScalar } from "../clients/prometheus.js";

/**
 * Interroge Prometheus pour les metriques d'un namespace.
 * Renvoie null si le namespace n'a pas de pods connus de Prometheus
 * (namespace pas encore deploye, ou nom incorrect).
 */
export async function getMetrics(namespace) {
  const [podCount, restarts, cpuRate, memBytes, memLimit] = await Promise.all([
    queryPrometheusScalar(`count(kube_pod_info{namespace="${namespace}"})`),
    queryPrometheusScalar(`sum(kube_pod_container_status_restarts_total{namespace="${namespace}"})`),
    queryPrometheusScalar(`sum(rate(container_cpu_usage_seconds_total{namespace="${namespace}"}[5m]))`),
    queryPrometheusScalar(`sum(container_memory_working_set_bytes{namespace="${namespace}"})`),
    queryPrometheusScalar(`sum(kube_pod_container_resource_limits{namespace="${namespace}", resource="memory"})`),
  ]);

  if (podCount === null) return null;

  return {
    pod_count: podCount,
    restarts_total: restarts ?? 0,
    cpu_usage_rate: cpuRate ?? 0,
    memory_usage_ratio: memLimit ? memBytes / memLimit : 0,
  };
}
