# Tâche de validation — Remediator IA et protection de l’infrastructure

## Objectif

Vérifier que le remediator IA ne casse pas l’infrastructure GitOps et qu’il ne peut proposer des corrections que sur l’environnement `dev`.

## Règles de sécurité

- Le remediator lit uniquement les rapports du namespace `dev`.
- Le remediator modifie uniquement `apps/vulnerable-app/dev/deployment.yaml`.
- Le remediator ne modifie jamais `staging`.
- Le remediator ne modifie jamais `prod`.
- `staging` est promu manuellement après validation complète de `dev`.
- `prod` est promu manuellement après validation complète de `staging`.
- Aucun secret ne doit être commité.

## Namespaces attendus

| Namespace        | Rôle                                      |
| ---------------- | ----------------------------------------- |
| `dev`            | Environnement de test et de correction IA |
| `staging`        | Validation manuelle après dev             |
| `prod`           | Environnement final                       |
| `ai-remediation` | Namespace dédié au remediator IA          |

## Commande de validation

Depuis la racine du repo :

```powershell
.\scripts\validate-remediator-infra.ps1
```
