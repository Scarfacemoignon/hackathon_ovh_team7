import { queryLoki, timestampNsToIso } from "../clients/loki.js";

function inferLevel(line) {
  const upper = (line || "").toUpperCase();
  if (upper.includes("ERROR") || upper.includes(" ERR ")) return "error";
  if (upper.includes("WARN")) return "warn";
  return "info";
}

/**
 * Interroge Loki pour les logs applicatifs d'un namespace.
 * Certaines apps loguent du JSON structure (auquel cas on utilise ses champs
 * namespace/level/message/timestamp), d'autres du texte libre (auquel cas on
 * reconstruit le niveau par mots-cles et on garde la ligne brute comme message).
 */
export async function getAppLogs(namespace) {
  const rows = await queryLoki(`{namespace="${namespace}"}`);
  return rows
    .map((r) => {
      if (r.log && typeof r.log === "object") {
        return {
          namespace: r.log.namespace || namespace,
          level: r.log.level || "info",
          message: r.log.message || JSON.stringify(r.log),
          timestamp: r.log.timestamp || timestampNsToIso(r.timestampNs),
        };
      }
      return {
        namespace,
        level: inferLevel(r.message),
        message: r.message || "",
        timestamp: timestampNsToIso(r.timestampNs),
      };
    })
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}

export async function getErrorLogs(namespace) {
  const logs = await getAppLogs(namespace);
  return logs.filter((log) => log.level === "error");
}
