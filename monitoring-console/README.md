# Local Monitoring Console

## Objectif

Cette interface locale doit afficher les logs et metriques par namespace.

Elle sert a visualiser clairement :

- les logs applicatifs
- les erreurs
- les commandes de l IA
- les statuts GitOps
- les metriques d environnement

L objectif principal est de prouver que l IA agit uniquement sur dev et que staging / prod restent sous controle humain.

---

## Namespaces

L interface doit afficher quatre espaces :

| Namespace | Role |
|---|---|
| dev | Environnement corrige par PR IA |
| staging | Validation manuelle |
| prod | Environnement final protege |
| ai-remediation | Namespace du remediator IA |

---

## Principe des logs IA

Les commandes de l IA sont des logs Loki structures en JSON.

Le remediator tourne dans :

    ai-remediation

Mais il cible uniquement :

    dev

Il faut donc utiliser :

    "source_namespace": "ai-remediation"
    "target_namespace": "dev"

Cela permet a l interface d afficher les actions IA dans la page du namespace cible.

---

## Mock data

Un fichier de logs IA est fourni pour developper l interface sans attendre l integration Loki :

    monitoring-console/mock-data/ai-command-logs.jsonl

Ce fichier contient :

- des commandes IA autorisees vers dev
- une tentative bloquee vers staging
- une tentative bloquee vers prod

---

## Pages attendues

### Page globale

Route :

    /

Affiche les cartes :

- dev
- staging
- prod
- ai-remediation

Chaque carte affiche :

- pods
- restarts
- erreurs recentes
- dernier log
- commandes IA
- statut GitOps
- statut securite

### Page detail namespace

Route :

    /namespaces/:namespace

Chaque page affiche :

1. Metrics
2. Application logs
3. Error logs
4. AI command logs
5. GitOps status
6. Security status

---

## Sources prevues

| Source | Usage |
|---|---|
| Loki | Logs applicatifs et commandes IA |
| Prometheus | Metriques Kubernetes |
| Argo CD API | Statut GitOps |
| GitHub API | Statut des Pull Requests si disponible |

---

## Regles de securite

L IA ne doit jamais modifier directement :

- staging
- prod

Si une commande IA cible staging ou prod, elle doit etre affichee comme :

    blocked

Si une commande IA cible prod avec un statut different de blocked, l interface doit afficher une alerte critique.

---

## Donnees interdites

L interface ne doit jamais afficher :

- tokens OVH
- tokens GitHub
- kubeconfig
- secrets Kubernetes
- contenu .env
- contenu ai-endpoints-key.txt
- headers Authorization

---

## Requetes Loki

Voir :

    docs/monitoring/loki-queries.md

---

## Contrats

Voir :

    docs/tasks/ai-command-logs-contract.md
    docs/tasks/local-monitoring-console-contract.md

---

## Criteres d acceptation

L interface est prete si :

- la page globale affiche les quatre namespaces
- chaque namespace possede sa page detail
- les logs applicatifs sont visibles par namespace
- les commandes IA sont visibles par target_namespace
- dev affiche les actions IA autorisees
- staging et prod n affichent aucune action IA non bloquee
- les secrets ne sont jamais affiches
- les mock data permettent de developper sans Loki
