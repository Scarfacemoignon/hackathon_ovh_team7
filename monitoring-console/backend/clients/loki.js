const LOKI_URL = process.env.LOKI_URL || "http://localhost:3100";

/**
 * Interroge Loki via /loki/api/v1/query_range et parse chaque ligne de log.
 * Si la ligne est du JSON valide (cas des logs structures du remediateur),
 * elle est exposee sous `log`. Sinon (logs applicatifs en texte libre),
 * elle est exposee sous `message` et c'est a l'appelant de l'interpreter.
 */
export async function queryLoki(logql, { limit = 200 } = {}) {
  const params = new URLSearchParams({
    query: logql,
    limit: String(limit),
    direction: "backward",
  });
  const res = await fetch(`${LOKI_URL}/loki/api/v1/query_range?${params}`);
  if (!res.ok) {
    throw new Error(`Loki a repondu ${res.status} pour la requete: ${logql}`);
  }
  const data = await res.json();
  return (data.data?.result || []).flatMap((stream) =>
    stream.values.map(([timestampNs, line]) => {
      try {
        return { timestampNs, labels: stream.stream, log: JSON.parse(line) };
      } catch {
        return { timestampNs, labels: stream.stream, message: line };
      }
    })
  );
}

export function timestampNsToIso(timestampNs) {
  return new Date(Number(timestampNs) / 1e6).toISOString();
}
