import express from "express";
import path from "path";
import { fileURLToPath } from "url";

import { getAiCommandLogs } from "./datasources/aiCommandLogs.js";
import { getAppLogs, getErrorLogs } from "./datasources/appLogs.js";
import { getMetrics } from "./datasources/metrics.js";
import { getGitopsStatus } from "./datasources/gitops.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 4000;

// "ai-remediation" est le namespace du remediateur lui-meme : source de
// toutes les commandes IA (pas une cible), pas forcement gere par Argo CD.
const NAMESPACES = ["dev", "staging", "prod", "ai-remediation"];

// CORS simple pour le dev en local (frontend et backend sur des ports differents)
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET");
  next();
});

function assertKnownNamespace(req, res, next) {
  if (!NAMESPACES.includes(req.params.namespace)) {
    return res.status(404).json({ error: `namespace inconnu: ${req.params.namespace}` });
  }
  next();
}

// Les datasources appellent maintenant Loki/Prometheus/Argo CD en vrai : une
// panne ou un timeout cote infra doit remonter en 502, pas planter le process.
function asyncRoute(handler) {
  return (req, res) => {
    handler(req, res).catch((err) => {
      console.error(`[${req.method} ${req.originalUrl}]`, err.message);
      res.status(502).json({ error: err.message });
    });
  };
}

app.get("/api/namespaces", (req, res) => {
  res.json(NAMESPACES);
});

app.get(
  "/api/summary",
  asyncRoute(async (req, res) => {
    const summary = await Promise.all(
      NAMESPACES.map(async (namespace) => {
        const [aiCommands, errors, metrics, gitops] = await Promise.all([
          getAiCommandLogs(namespace),
          getErrorLogs(namespace),
          getMetrics(namespace),
          getGitopsStatus(namespace),
        ]);
        return {
          namespace,
          metrics,
          gitops,
          last_ai_command: aiCommands[0] || null,
          ai_commands_total: aiCommands.length,
          errors_total: errors.length,
        };
      })
    );
    res.json(summary);
  })
);

app.get(
  "/api/namespaces/:namespace/logs",
  assertKnownNamespace,
  asyncRoute(async (req, res) => {
    res.json(await getAppLogs(req.params.namespace));
  })
);

app.get(
  "/api/namespaces/:namespace/errors",
  assertKnownNamespace,
  asyncRoute(async (req, res) => {
    res.json(await getErrorLogs(req.params.namespace));
  })
);

app.get(
  "/api/namespaces/:namespace/ai-command-logs",
  assertKnownNamespace,
  asyncRoute(async (req, res) => {
    res.json(await getAiCommandLogs(req.params.namespace));
  })
);

app.get(
  "/api/namespaces/:namespace/metrics",
  assertKnownNamespace,
  asyncRoute(async (req, res) => {
    // null est une reponse valide (ex: namespace sans pods connus de Prometheus) :
    // le frontend affiche alors la section comme absente plutot que de planter la page.
    res.json(await getMetrics(req.params.namespace));
  })
);

app.get(
  "/api/namespaces/:namespace/gitops",
  assertKnownNamespace,
  asyncRoute(async (req, res) => {
    // "ai-remediation" n'est typiquement pas gere par Argo CD (c'est un CronJob,
    // pas une app GitOps) : null est donc un resultat normal, pas une erreur.
    res.json(await getGitopsStatus(req.params.namespace));
  })
);

// Sert le frontend statique (fichiers dans ../frontend) pour ne lancer qu'un seul process en dev
app.use(express.static(path.join(__dirname, "..", "frontend")));

app.listen(PORT, () => {
  console.log(`monitoring-console backend en ecoute sur http://localhost:${PORT}`);
  console.log(`Frontend servi depuis http://localhost:${PORT}/`);
  console.log(`Loki:       ${process.env.LOKI_URL || "http://localhost:3100"}`);
  console.log(`Prometheus: ${process.env.PROMETHEUS_URL || "http://localhost:9090"}`);
  console.log(`Argo CD:    ${process.env.ARGOCD_URL || "http://localhost:8080"}`);
});
