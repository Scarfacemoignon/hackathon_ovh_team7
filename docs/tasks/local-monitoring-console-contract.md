# Contrat - Interface locale de monitoring

## Objectif

L interface locale doit afficher les metriques et les logs par namespace.

Elle doit permettre de prouver que :

- le remediator IA tourne dans ai-remediation
- les actions IA autorisees ciblent uniquement dev
- staging est promu manuellement
- prod n est jamais modifie directement par l IA
- les logs sont exploitables pour audit et demonstration

---

## Namespaces affiches

| Namespace | Role |
|---|---|
| dev | Environnement corrige par PR IA |
| staging | Validation manuelle |
| prod | Environnement final protege |
| ai-remediation | Namespace du remediator IA |

---

## Sources de donnees prevues

| Source | Usage |
|---|---|
| Loki | Logs applicatifs, logs d erreurs, commandes IA |
| Prometheus | Metriques pods, restarts, CPU, memoire |
| Argo CD API | Statut GitOps, synchronisation, sante des applications |
| GitHub API | Statut des Pull Requests si disponible |

L interface ne doit pas lire directement les secrets Kubernetes.

---

## Page globale

Route proposee :

    /

La page globale affiche une carte pour chaque namespace :

- dev
- staging
- prod
- ai-remediation

Chaque carte affiche :

- nombre de pods
- nombre de restarts
- nombre d erreurs recentes
- dernier log
- nombre de commandes IA ciblant ce namespace
- statut GitOps
- statut global

---

## Page detail namespace

Route proposee :

    /namespaces/:namespace

Chaque page contient les sections suivantes :

1. Metrics
2. Application logs
3. Error logs
4. AI command logs
5. GitOps status
6. Security status

---

## API backend proposee

    GET /api/namespaces
    GET /api/summary
    GET /api/namespaces/:namespace/metrics
    GET /api/namespaces/:namespace/logs
    GET /api/namespaces/:namespace/errors
    GET /api/namespaces/:namespace/ai-command-logs
    GET /api/ai/commands
    GET /api/ai/commands?target_namespace=dev
    GET /api/gitops/status
    GET /api/security/status

---

## Exemple de reponse /api/summary

    {
      "dev": {
        "pods": 2,
        "restarts": 0,
        "errors": 1,
        "lastLog": "vulnerable-web started",
        "aiCommands": 14,
        "gitopsStatus": "synced",
        "status": "active"
      },
      "staging": {
        "pods": 1,
        "restarts": 0,
        "errors": 0,
        "lastLog": "staging deployment running",
        "aiCommands": 0,
        "gitopsStatus": "manual-sync",
        "status": "manual-promotion"
      },
      "prod": {
        "pods": 1,
        "restarts": 0,
        "errors": 0,
        "lastLog": "prod deployment running",
        "aiCommands": 0,
        "gitopsStatus": "manual-sync",
        "status": "protected"
      },
      "ai-remediation": {
        "pods": 1,
        "restarts": 0,
        "errors": 0,
        "lastLog": "remediator finished",
        "aiCommands": 16,
        "gitopsStatus": "synced",
        "status": "ready"
      }
    }

---

## Affichage attendu par namespace

### dev

La section AI command logs affiche les commandes IA qui ciblent dev.

Exemple :

    12:44:03 collect_vulnerability_reports success
    12:44:10 call_ovh_ai success
    12:44:13 kubernetes_dry_run success
    12:44:16 create_pull_request success

Dev est le seul namespace applicatif ou des actions IA peuvent etre en statut success.

### staging

La section AI command logs doit normalement afficher :

    No direct AI command found.
    Staging is promoted manually after dev validation.

Si des commandes IA apparaissent, elles doivent etre en statut blocked.

Toute commande IA non bloquee vers staging doit etre affichee comme anomalie.

### prod

La section AI command logs doit normalement afficher :

    No direct AI command found.
    Production is protected from direct AI remediation.

Si une commande IA cible prod avec un statut different de blocked, l interface doit afficher une alerte critique.

### ai-remediation

La section affiche les logs runtime du remediator :

- demarrage
- chargement configuration
- verification du namespace cible
- collecte des rapports Trivy, Kyverno et Falco
- appel OVH AI
- validation YAML
- creation de branche GitHub
- creation de Pull Request
- erreurs eventuelles
- actions bloquees

---

## Regles de conformite cote interface

| Regle | Comportement attendu |
|---|---|
| Pas de secrets | L interface ne doit jamais afficher de token ou secret |
| Prod protegee | Toute action IA non bloquee vers prod declenche une alerte critique |
| Staging controle | Toute action IA non bloquee vers staging declenche une anomalie |
| Auditabilite | Les actions IA doivent etre horodatees et filtrables |
| Separation des environnements | Chaque namespace doit avoir sa propre page |
| Lisibilite | Les commandes IA doivent etre affichees separement des logs applicatifs, meme si elles viennent de Loki |

---

## Donnees interdites cote interface

L interface ne doit jamais afficher :

- tokens OVH
- tokens GitHub
- kubeconfig
- secrets Kubernetes
- contenu .env
- contenu ai-endpoints-key.txt
- headers Authorization

Les secrets doivent etre masques sous la forme :

    ****

---

## Criteres d acceptation

L interface est conforme si :

- elle affiche une carte par namespace
- elle affiche les logs applicatifs par namespace
- elle affiche les erreurs par namespace
- elle affiche les commandes IA par target_namespace
- elle distingue source_namespace et target_namespace
- elle affiche une alerte si l IA cible prod sans statut blocked
- elle n affiche aucun secret
- elle peut fonctionner avec les mock data avant integration Loki
