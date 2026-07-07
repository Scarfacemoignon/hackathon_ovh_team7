# Rapport d'architecture — Chaîne d'audit et de remédiation GitOps sécurisée

**Équipe 7 — Hackathon Lille Ynov Campus × OVHcloud, 6-7 juillet 2026**
Dépôt : https://github.com/Scarfacemoignon/hackathon_ovh_team7

## 1. Objectif

Construire, sur un cluster Kubernetes managé OVHcloud, une boucle de sécurité automatisée où
l'IA générative n'est pas un simple assistant mais un **composant actif de la chaîne de
sécurité** :

**Détection d'une faille → analyse et correctif proposé par l'IA → Pull Request automatique →
revue humaine → merge → resynchronisation Argo CD → cluster corrigé.**

## 2. Architecture

```
Cluster Kubernetes managé OVHcloud
│
├── Argo CD (GitOps)          — surveille Git, applique tout automatiquement
├── Trivy-operator (audit)    — scanne images (CVE) et configs
├── Kyverno (policy-as-code)  — évalue les ressources contre des policies (Audit)
├── Falco (runtime)           — détecte les comportements suspects
├── Prometheus / Grafana      — métriques et observabilité
├── Loki / Promtail           — agrégation des logs applicatifs
│
├── Namespaces dev / staging / prod / ai-remediation
│     dev = seul environnement corrigé par l'IA (auto-sync)
│     staging / prod = promotion manuelle uniquement (aucune synchro automatique)
│
└── Remédiateur IA (hors cluster)
      1. lit les VulnerabilityReport du namespace dev
      2. lit le manifest depuis GitHub (Git = source de vérité)
      3. interroge l'IA (AI Endpoints OVHcloud)
      4. teste le correctif dans un namespace éphémère avant toute PR
      5. ouvre une Pull Request avec le résultat du test
              │
              ▼ revue humaine obligatoire + merge
      Argo CD détecte le changement → resynchronise → cluster corrigé
```

## 3. Justification des choix techniques

- **Argo CD (modèle pull)** : l'agent GitOps va chercher les changements dans Git ; aucun
  credential cluster ne transite vers l'extérieur — principe Zero Trust.
- **Trivy-operator** : rapports exposés comme des CRD Kubernetes natives (`VulnerabilityReport`,
  `ConfigAuditReport`), consommables directement par notre script sans dépendance externe.
- **Kyverno en mode `Audit`** : signale les violations sans bloquer, choix pragmatique pour
  garder la démonstration possible pendant le hackathon.
- **Falco (driver `modern_ebpf`)** : seul driver ne nécessitant pas de compilation de module
  noyau — compatible avec un cluster managé où l'on ne contrôle pas les nodes.
- **Séparation dev/staging/prod** : l'IA ne peut agir que sur `dev` (garde-fou explicite dans le
  code du remédiateur) ; la promotion vers `staging`/`prod` reste un geste humain volontaire.
- **Test de staging automatique avant chaque PR** : le correctif est réellement déployé dans un
  namespace jetable avant d'être proposé — pas seulement un `--dry-run` syntaxique.
- **Revue humaine obligatoire avant merge** : le garde-fou central. Constaté en pratique à
  plusieurs reprises — un correctif IA a cassé le démarrage d'un conteneur (permissions), un
  autre a violé notre propre policy Kyverno (`nginx:latest`) — deux incidents que seule la
  combinaison revue humaine + Kyverno + test de staging a permis de rattraper.

## 4. Statut CNCF des composants utilisés

| Composant | Rôle dans la chaîne | Statut CNCF |
|---|---|---|
| Argo CD | GitOps — synchronisation Git → cluster | Graduated |
| Trivy-operator | Audit de sécurité (CVE + configuration) | Projet Aqua Security, scanner validé CNCF |
| Kyverno | Policy-as-code | Graduated |
| Falco | Détection de menaces runtime | Graduated |
| Prometheus | Observabilité & métriques | Graduated |
| Loki | Agrégation de logs | Incubating |
| AI Endpoints OVHcloud | Couche d'IA générative | OVHcloud (hors CNCF, assumé dans le brief) |

## 5. Limites et perspectives

Déclenchement du remédiateur encore manuel (un `CronJob` dans le namespace `ai-remediation`
dédié est la prochaine étape) ; secrets gérés en variables d'environnement locales plutôt que
via External Secrets Operator ; promotion `dev → staging → prod` non automatisée (copie
manuelle du manifest validé). Une évolution vers un déploiement **canary** (Argo Rollouts) avec
rollback automatique piloté par Prometheus compléterait la validation manuelle actuelle pour
répondre à un objectif de disponibilité élevé (SLA).

*Détail technique complet, script de démo et historique des incidents réels : voir
`docs/architecture.md`, `docs/demo-script.md` et `docs/commands-reference.md` dans ce dépôt.*
