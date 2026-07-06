# Rapport d'architecture — Chaîne d'audit et de remédiation GitOps sécurisée

Équipe 7 — Hackathon OVHcloud x Ynov, 6-7 juillet 2026.

## 1. Objectif

Construire une boucle de sécurité automatisée sur un cluster Kubernetes managé OVHcloud :

**Détection d'une faille → analyse et correctif proposé par l'IA → Pull Request automatique
sur Git → revue humaine → merge → resynchronisation Argo CD → cluster corrigé.**

L'IA n'est pas un simple assistant : elle est un composant actif de la chaîne de sécurité,
au même titre que Trivy ou Kyverno.

## 2. Architecture

```
Cluster Kubernetes OVHcloud (hackathon-equipe-7, gra11)
│
├── Argo CD (GitOps)              ── surveille le dépôt Git, applique tout automatiquement
├── Trivy-operator (audit)        ── scanne images (CVE) et configs, publie des CRD
├── Kyverno (policy-as-code)      ── évalue chaque ressource contre 3 policies (mode Audit)
├── Falco (runtime)               ── observe les syscalls, alerte sur comportement suspect
├── Prometheus / Grafana          ── collecte les métriques (dont trivy_image_vulnerabilities)
│
└── Remédiateur (apps/remediator/remediator.py, hors cluster)
        1. lit les VulnerabilityReport (API Kubernetes)
        2. lit le manifest actuel depuis GitHub (source de vérité = Git, pas le cluster)
        3. envoie rapport + manifest à l'IA (AI Endpoints OVHcloud, Qwen2.5-VL-72B-Instruct)
        4. reçoit un YAML corrigé + une explication
        5. ouvre une Pull Request GitHub
                │
                ▼ revue humaine + merge
        Dépôt Git (GitHub) ──► Argo CD détecte le changement ──► resynchronise le cluster
```

## 3. Flux détaillé de la boucle

1. Un workload volontairement vulnérable (`apps/vulnerable-app/`) est déployé via Argo CD.
2. Trivy-operator le scanne en continu et publie un `VulnerabilityReport` (CVE) et un
   `ConfigAuditReport` (mauvaises pratiques : `privileged`, root, absence de limites).
3. Kyverno évalue les mêmes ressources contre 3 `ClusterPolicy` (`disallow-privileged`,
   `require-limits`, `disallow-latest-tag`) et publie des `PolicyReport`.
4. Falco surveille en parallèle le comportement runtime du pod (ex : lecture de `/etc/shadow`).
5. Le remédiateur (déclenché manuellement dans cette version hackathon) lit le
   `VulnerabilityReport`, lit le manifest **depuis GitHub** (jamais depuis le cluster — Git reste
   la seule source de vérité), et interroge l'IA avec un prompt structuré imposant un format de
   sortie strict (`EXPLICATION:` puis bloc ` ```yaml `).
6. Le YAML retourné est validé (`yaml.safe_load`) avant d'être committé sur une branche dédiée
   et proposé en Pull Request, avec l'explication de l'IA en description.
7. Un humain relit, ajuste si besoin (dans notre cas : changement du tag d'image proposé), puis
   merge.
8. Argo CD détecte le nouveau commit sur `main` et resynchronise automatiquement le cluster
   (`prune` + `selfHeal` activés) — sans jamais donner à l'IA ou au script un accès direct
   d'écriture au cluster.
9. Le scan Trivy suivant confirme la correction (dans notre run : 27 CRITICAL / 50 HIGH → 0 / 0).

## 4. Justification des choix techniques

- **Argo CD plutôt qu'un pipeline CI qui push** : modèle *pull* — l'agent GitOps va chercher les
  changements depuis le cluster, aucun credential cluster ne circule vers l'extérieur.
  Réduit la surface d'attaque (principe Zero Trust).
- **Trivy-operator plutôt que Kubescape** : rapports exposés directement comme des CRD
  Kubernetes (`VulnerabilityReport`, `ConfigAuditReport`), consommables nativement par
  `kubectl` et par notre script Python sans dépendance supplémentaire.
- **Kyverno en mode `Audit` (pas `Enforce`)** : en `Enforce`, Kyverno aurait bloqué la création
  même de notre workload volontairement vulnérable — on n'aurait plus rien eu à démontrer.
  Un choix pragmatique pour la durée du hackathon, à durcir en production.
- **Falco avec driver `modern_ebpf`** : seul driver ne nécessitant pas de compilation de module
  noyau, donc compatible avec un cluster managé où l'on ne contrôle pas le kernel des nodes.
- **AI Endpoints OVHcloud, modèle Qwen2.5-VL-72B-Instruct** : API compatible OpenAI (changement
  de `base_url` uniquement), modèle imposé par la disponibilité du catalogue au moment du
  hackathon. Prompt à `temperature: 0.2` pour privilégier la fiabilité du YAML plutôt que la
  créativité.
- **Revue humaine obligatoire avant merge** : le garde-fou central de toute l'architecture.
  Constaté en pratique — le premier correctif de l'IA (passage en non-root) cassait le
  démarrage du conteneur (`/var/cache/nginx` non accessible en écriture) ; sans revue humaine,
  ce correctif cassé aurait été appliqué tel quel par Argo CD.

## 5. Statut CNCF des composants

| Composant | Rôle dans la chaîne | Statut CNCF |
|---|---|---|
| Argo CD | GitOps — synchronisation Git → cluster | Graduated |
| Trivy-operator | Audit de sécurité (CVE + config) | Projet Aqua Security, scanner validé CNCF |
| Kyverno | Policy-as-code | Graduated |
| Falco | Détection de menaces runtime | Graduated |
| Prometheus | Observabilité & métriques | Graduated |
| AI Endpoints OVHcloud | Couche d'IA générative | OVHcloud (hors CNCF — assumé dans le brief) |

## 6. Limites et pistes d'amélioration

Voir `docs/demo-script.md` §"Limites connues" pour le détail (déclenchement manuel plutôt que
CronJob, absence de validation `--dry-run=server` avant PR, secrets en variables
d'environnement plutôt qu'External Secrets Operator, un seul rapport traité par exécution).
