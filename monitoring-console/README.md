# monitoring-console

Dashboard par namespace (`dev` / `staging` / `prod` / `ai-remediation`) affichant :
- les logs applicatifs (Loki)
- les commandes IA du remédiateur, filtrées par `target_namespace` (Loki)
- les métriques (Prometheus)
- le statut GitOps (Argo CD)

Le backend interroge maintenant les vraies API — plus de mock JSONL par défaut.

## Démarrer en local

```bash
cd backend
npm install
cp .env.example .env   # puis renseigner LOKI_URL / PROMETHEUS_URL / ARGOCD_URL / ARGOCD_TOKEN
npm start
```

Le backend écoute sur `http://localhost:4000` et sert aussi le frontend
statique sur la même URL — un seul process à lancer.

Ouvrir `http://localhost:4000/` :
- `#/` → vue d'ensemble des namespaces
- `#/namespace/dev` → détail (logs, pipeline de commandes IA, métriques, GitOps)
- `#/namespace/staging` et `#/namespace/prod` → mêmes pages, mais les
  commandes IA y apparaissent `blocked` (guardrail : IA restreinte à `dev`)
- `#/namespace/ai-remediation` → toutes les commandes IA émises, toutes
  cibles confondues (ce namespace est la source, pas une cible)

## Tester sans l'infra reelle

`tools/fake-infra.js` lance trois petits serveurs HTTP qui imitent les
réponses de Loki, Prometheus et Argo CD (mêmes formes de réponse), pratique
pour développer sans cluster sous la main :

```bash
node tools/fake-infra.js
# dans un autre terminal :
LOKI_URL=http://localhost:3100 PROMETHEUS_URL=http://localhost:9090 ARGOCD_URL=http://localhost:8080 \
  node backend/server.js
```

## Structure

```
backend/
  server.js                routes Express (async, gerent les pannes upstream en 502)
  clients/
    loki.js                 query_range + parsing JSON/texte libre
    prometheus.js            requete PromQL instantanee -> valeur scalaire
    argocd.js                 GET application, 404 -> null
  datasources/
    aiCommandLogs.js        LogQL filtre sur type=ai_command (+ target_namespace)
    appLogs.js                LogQL {namespace="..."}
    metrics.js                 PromQL (pods, restarts, cpu, memoire)
    gitops.js                    Argo CD application vulnerable-app-<namespace>
  mock-data/                donnees utilisees avant le passage en mode API reel
                            (conservees pour reference, plus lues par le code)
frontend/
  index.html + app.js + style.css   SPA vanilla JS, routing par hash, sans build step
tools/
  fake-infra.js            faux Loki/Prometheus/Argo CD pour tester en local
```

## Routes API

```
GET /api/namespaces
GET /api/summary
GET /api/namespaces/:namespace/logs
GET /api/namespaces/:namespace/errors
GET /api/namespaces/:namespace/ai-command-logs
GET /api/namespaces/:namespace/metrics
GET /api/namespaces/:namespace/gitops
```

## Notes sur l'integration

- **Loki** : `queryLoki(logql)` parse chaque ligne en JSON si possible (cas
  des logs structurés du remédiateur), sinon la garde en texte brut et
  déduit le niveau (`error`/`warn`/`info`) par mots-clés.
- **Prometheus** : chaque métrique est une requête PromQL instantanée
  séparée (`pod_count`, `restarts_total`, `cpu_usage_rate`,
  `memory_usage_ratio`). Si `kube_pod_info` ne renvoie rien pour le
  namespace, `getMetrics` renvoie `null` plutôt qu'une erreur.
- **Argo CD** : un 404 (application inexistante) est traité comme un `null`
  normal, pas une erreur — utile pour `ai-remediation`, qui n'est pas géré
  par GitOps et court-circuite l'appel entièrement.
- Toute panne upstream (Loki/Prometheus/Argo CD injoignable ou en erreur)
  remonte en **502** avec le message d'erreur, au lieu de faire planter le
  process — à surveiller si vous manquez de temps pour valider le comportement
  réseau réel avant une démo.

## État après intégration dans le dépôt principal

Testé en local le 2026-07-07, deux corrections apportées :
1. **`dotenv` n'était jamais chargé** dans `server.js` — le `.env` était donc
   silencieusement ignoré et `ARGOCD_TOKEN` jamais transmis (401 systématique
   sur `/api/namespaces/:namespace/gitops`). Corrigé (`import "dotenv/config"`
   + dépendance ajoutée à `package.json`).
2. **`/api/summary` plantait entièrement** dès qu'une seule source (Loki, non
   déployée sur ce cluster) échouait, à cause d'un `Promise.all` sans
   isolation d'erreur — alors que les routes individuelles dégradaient déjà
   proprement en 502. Corrigé avec un helper `safe()` qui isole chaque source.

Avec ces deux correctifs : `/api/summary`, `/api/namespaces/:namespace/gitops`
et `/metrics` fonctionnent et reflètent l'état réel du cluster (testé sur
`dev`/`staging`/`prod`/`ai-remediation`).

**Loki est maintenant déployé** (`infra/argocd-apps/loki.yaml`, chart
`grafana/loki-stack` avec Promtail) — `/logs` fonctionne aussi. Point
important : Promtail ne pousse que les **nouvelles** lignes de log depuis son
démarrage (pas l'historique) — un pod sans trafic récent peut donc ne pas
encore apparaître dans `/loki/api/v1/label/namespace/values` tant qu'il n'a
rien écrit de neuf sur stdout/stderr. `/ai-command-logs` reste vide : le
remédiateur tourne aujourd'hui en local, pas dans le cluster, donc ses logs
ne passent pas par Promtail (voir `docs/architecture.md` §7.4, CronJob
`ai-remediation` documenté comme prochaine étape).

**Important** : `ARGOCD_URL` doit être en `https://` (pas `http://`), le
tunnel `kubectl port-forward svc/argocd-server -n argocd 8080:443` sert du
TLS auto-signé sur ce port. Voir `.env.example` mis à jour.
