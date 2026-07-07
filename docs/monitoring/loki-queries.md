# Loki - Requetes de logs par namespace

## Objectif

Ce document definit les requetes Loki utilisees par l interface locale de monitoring.

L interface doit afficher les logs par namespace :

- dev
- staging
- prod
- ai-remediation

Les commandes de l IA sont aussi des logs Loki. Elles sont simplement structurees en JSON avec le champ :

    "type": "ai_command"

Cela permet de distinguer les logs applicatifs classiques des actions du remediator IA.

---

## 1. Namespaces surveilles

| Namespace | Role |
|---|---|
| dev | Environnement de test et de correction IA |
| staging | Environnement de validation manuelle |
| prod | Environnement final protege |
| ai-remediation | Namespace ou tourne le remediator IA |

---

## 2. Logs applicatifs par namespace

Dev :

    {namespace="dev"}

Staging :

    {namespace="staging"}

Prod :

    {namespace="prod"}

AI remediation :

    {namespace="ai-remediation"}

---

## 3. Logs d erreurs par namespace

Dev :

    {namespace="dev"} |~ "(?i)error|exception|failed|traceback|panic"

Staging :

    {namespace="staging"} |~ "(?i)error|exception|failed|traceback|panic"

Prod :

    {namespace="prod"} |~ "(?i)error|exception|failed|traceback|panic"

AI remediation :

    {namespace="ai-remediation"} |~ "(?i)error|exception|failed|traceback|panic"

---

## 4. Logs runtime du remediator IA

Le pod du remediator tourne dans :

    ai-remediation

Tous les logs du remediator :

    {namespace="ai-remediation"}

Si le pod possede le label app="remediator" :

    {namespace="ai-remediation", app="remediator"}

Si le nom du pod contient remediator :

    {namespace="ai-remediation", pod=~".*remediator.*"}

---

## 5. Format attendu des commandes IA

Le remediator doit ecrire ses actions en JSON dans stdout.

Exemple :

    {
      "type": "ai_command",
      "actor": "ai-remediator",
      "source_namespace": "ai-remediation",
      "target_namespace": "dev",
      "step": "collect_vulnerability_reports",
      "command": "kubectl get vulnerabilityreports -n dev",
      "status": "success",
      "stdout_summary": "2 vulnerability reports found",
      "stderr_summary": "",
      "duration_ms": 421,
      "timestamp": "2026-06-25T12:44:03Z"
    }

Important :

- source_namespace = namespace ou tourne le remediator
- target_namespace = namespace cible par l action

---

## 6. Toutes les commandes IA

    {namespace="ai-remediation"} | json | type="ai_command"

---

## 7. Commandes IA par namespace cible

Commandes IA ciblant dev :

    {namespace="ai-remediation"} | json | type="ai_command" | target_namespace="dev"

Commandes IA ciblant staging :

    {namespace="ai-remediation"} | json | type="ai_command" | target_namespace="staging"

Commandes IA ciblant prod :

    {namespace="ai-remediation"} | json | type="ai_command" | target_namespace="prod"

Commandes IA ciblant ai-remediation :

    {namespace="ai-remediation"} | json | type="ai_command" | target_namespace="ai-remediation"

---

## 8. Commandes IA par statut

Commandes reussies :

    {namespace="ai-remediation"} | json | type="ai_command" | status="success"

Commandes echouees :

    {namespace="ai-remediation"} | json | type="ai_command" | status="failed"

Commandes bloquees :

    {namespace="ai-remediation"} | json | type="ai_command" | status="blocked"

---

## 9. Verifications de securite

Verifier que staging n est pas modifie directement par l IA :

    {namespace="ai-remediation"} | json | type="ai_command" | target_namespace="staging" | status!="blocked"

Resultat attendu :

    Aucun resultat.

Verifier que prod n est pas modifie directement par l IA :

    {namespace="ai-remediation"} | json | type="ai_command" | target_namespace="prod" | status!="blocked"

Resultat attendu :

    Aucun resultat.

Si cette requete retourne un resultat, l interface doit afficher une alerte critique.

---

## 10. Requetes pour la vue globale

Nombre de commandes IA vers dev sur 1h :

    count_over_time({namespace="ai-remediation"} | json | type="ai_command" | target_namespace="dev" [1h])

Nombre de commandes IA bloquees sur 1h :

    count_over_time({namespace="ai-remediation"} | json | type="ai_command" | status="blocked" [1h])

Erreurs recentes dans dev :

    count_over_time({namespace="dev"} |~ "(?i)error|exception|failed|traceback|panic" [1h])

Erreurs recentes dans staging :

    count_over_time({namespace="staging"} |~ "(?i)error|exception|failed|traceback|panic" [1h])

Erreurs recentes dans prod :

    count_over_time({namespace="prod"} |~ "(?i)error|exception|failed|traceback|panic" [1h])

Erreurs recentes dans ai-remediation :

    count_over_time({namespace="ai-remediation"} |~ "(?i)error|exception|failed|traceback|panic" [1h])

---

## 11. Regles d affichage attendues

### dev

La page dev peut afficher des commandes IA avec les statuts :

- success
- failed
- blocked

Dev est le seul namespace applicatif ou les actions IA sont autorisees.

### staging

La page staging doit normalement afficher :

    No direct AI command found.
    Staging is promoted manually after dev validation.

Si des commandes IA apparaissent, elles doivent etre en statut blocked.

### prod

La page prod doit normalement afficher :

    No direct AI command found.
    Production is protected from direct AI remediation.

Si une commande IA cible prod avec un statut different de blocked, l interface doit afficher une alerte critique.

### ai-remediation

La page ai-remediation affiche :

- les logs runtime du remediator
- les appels a l IA
- la collecte Trivy, Kyverno et Falco
- la creation de branche GitHub
- la creation de Pull Request
- les erreurs eventuelles
- les actions bloquees

---

## 12. Donnees interdites dans les logs

Les logs affiches par l interface ne doivent jamais contenir :

- OVH_AI_TOKEN
- GITHUB_TOKEN
- kubeconfig
- headers Authorization
- contenu du fichier .env
- contenu du fichier ai-endpoints-key.txt
- secrets Kubernetes
- tokens GitHub
- tokens OVH

Les secrets doivent etre masques :

    OVH_AI_TOKEN=****
    GITHUB_TOKEN=****
    Authorization=Bearer ****
