# Contrat - Logs de commandes IA

## Objectif

Le remediator IA doit ecrire toutes ses actions sous forme de logs JSON dans stdout.

Ces logs seront collectes par Loki et affiches dans l interface locale de monitoring.

L objectif est de garantir :

- la tracabilite des actions IA
- la separation entre namespace source et namespace cible
- l interdiction d action directe sur staging et prod
- l absence de secrets dans les logs
- une preuve exploitable pour audit et demonstration

---

## Principe

Le remediator IA tourne dans :

    ai-remediation

Mais il cible uniquement :

    dev

Chaque log doit donc distinguer :

| Champ | Description |
|---|---|
| source_namespace | Namespace ou tourne le remediator |
| target_namespace | Namespace cible par l action |
| type | Type du log, ici ai_command |
| actor | Acteur, ici ai-remediator |
| step | Etape du workflow |
| command | Commande ou action executee |
| status | success, failed ou blocked |
| stdout_summary | Resume de sortie standard |
| stderr_summary | Resume d erreur |
| duration_ms | Duree de l action |
| timestamp | Date ISO |

---

## Exemple de log valide

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

---

## Etapes a tracer

Le remediator doit tracer les etapes suivantes :

1. remediator_start
2. load_configuration
3. security_guard
4. collect_vulnerability_reports
5. collect_config_audit_reports
6. collect_policy_reports
7. collect_falco_alerts
8. read_target_manifest
9. build_ai_prompt
10. call_ovh_ai
11. receive_ai_response
12. extract_fixed_yaml
13. validate_yaml
14. kubernetes_dry_run
15. create_github_branch
16. update_manifest_file
17. create_pull_request
18. remediator_finished
19. remediator_error
20. blocked_target_namespace

---

## Regle de securite

Le remediator IA est autorise a cibler uniquement :

    target_namespace=dev

Si target_namespace vaut staging ou prod, l action doit etre bloquee.

Exemple d action bloquee :

    {
      "type": "ai_command",
      "actor": "ai-remediator",
      "source_namespace": "ai-remediation",
      "target_namespace": "prod",
      "step": "security_guard",
      "command": "attempt remediation on prod",
      "status": "blocked",
      "stdout_summary": "",
      "stderr_summary": "AI remediation is only allowed on dev",
      "duration_ms": 0,
      "timestamp": "2026-06-25T12:45:10Z"
    }

---

## Regles de conformite

| Regle | Exigence |
|---|---|
| Confinement IA | L IA ne doit cibler que dev |
| Revue humaine | Toute correction doit passer par Pull Request |
| Promotion manuelle | staging et prod ne doivent pas etre modifies directement par l IA |
| Tracabilite | Chaque etape IA doit etre loggee |
| Secret management | Aucun secret ne doit apparaitre dans les logs |
| GitOps | La source de verite reste le depot Git |
| Auditabilite | Les logs doivent permettre de reconstruire le deroule d une correction |

---

## Donnees interdites dans les logs

Ne jamais logger :

- OVH_AI_TOKEN
- GITHUB_TOKEN
- kubeconfig
- headers Authorization
- contenu de .env
- contenu de ai-endpoints-key.txt
- secrets Kubernetes
- tokens GitHub
- tokens OVH
- valeurs completes de variables d environnement sensibles

Les secrets doivent etre masques :

    OVH_AI_TOKEN=****
    GITHUB_TOKEN=****
    Authorization=Bearer ****

---

## Requetes Loki principales

Toutes les commandes IA :

    {namespace="ai-remediation"} | json | type="ai_command"

Commandes IA ciblant dev :

    {namespace="ai-remediation"} | json | type="ai_command" | target_namespace="dev"

Commandes IA ciblant prod :

    {namespace="ai-remediation"} | json | type="ai_command" | target_namespace="prod"

Commandes IA bloquees :

    {namespace="ai-remediation"} | json | type="ai_command" | status="blocked"

---

## Criteres d acceptation

Le contrat est respecte si :

- chaque action IA produit un log JSON
- chaque log contient source_namespace et target_namespace
- toutes les actions IA autorisees ciblent dev
- toute action ciblant staging ou prod est bloquee
- aucun token ou secret n apparait dans stdout
- Loki peut filtrer les logs par target_namespace
- l interface peut afficher les commandes IA par namespace cible
