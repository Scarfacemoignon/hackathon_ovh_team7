import http from "http";

function send(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

// ---- Fake Loki (port 3100) ----
const aiCommandLine = JSON.stringify({
  type: "ai_command",
  actor: "ai-remediator",
  source_namespace: "ai-remediation",
  target_namespace: "dev",
  step: "call_ovh_ai",
  command: "call OVH AI Endpoint",
  status: "success",
  stdout_summary: "AI remediation proposal received",
  stderr_summary: "",
  duration_ms: 3200,
  timestamp: "2026-06-25T12:44:10Z",
});

const lokiServer = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  const query = url.searchParams.get("query") || "";
  if (!url.pathname.startsWith("/loki/api/v1/query_range")) return send(res, 404, { error: "not found" });

  let values = [];
  if (query.includes("ai_command")) {
    values = [["1750850650000000000", aiCommandLine]];
  } else if (query.includes('namespace="dev"')) {
    // Un exemple JSON structure + un exemple texte libre, pour tester les deux chemins
    values = [
      ["1750850700000000000", JSON.stringify({ namespace: "dev", level: "warn", message: "deprecated env var set", timestamp: "2026-06-25T12:40:05Z" })],
      ["1750850800000000000", "2026-06-25 12:40:10 ERROR connection reset by peer"],
    ];
  }
  send(res, 200, { status: "success", data: { resultType: "streams", result: values.length ? [{ stream: { namespace: "dev" }, values }] : [] } });
});
lokiServer.listen(3100, () => console.log("fake loki on :3100"));

// ---- Fake Prometheus (port 9090) ----
const promServer = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  const query = url.searchParams.get("query") || "";
  if (!url.pathname.startsWith("/api/v1/query")) return send(res, 404, { error: "not found" });

  let value = "2";
  if (query.includes("restarts")) value = "4";
  if (query.includes("rate(container_cpu")) value = "0.18";
  if (query.includes("memory_working_set")) value = "440000000";
  if (query.includes("resource_limits")) value = "1073741824";

  send(res, 200, { status: "success", data: { resultType: "vector", result: [{ metric: {}, value: [Date.now() / 1000, value] }] } });
});
promServer.listen(9090, () => console.log("fake prometheus on :9090"));

// ---- Fake Argo CD (port 8080) ----
const argoServer = http.createServer((req, res) => {
  if (req.url.includes("vulnerable-app-dev")) {
    return send(res, 200, {
      metadata: { name: "vulnerable-app-dev" },
      status: {
        sync: { status: "Synced" },
        health: { status: "Healthy" },
        reconciledAt: "2026-06-26T09:13:00Z",
      },
    });
  }
  return send(res, 404, { error: "application not found" });
});
argoServer.listen(8080, () => console.log("fake argocd on :8080"));
