# Rapport d'architecture - Chaîne d'audit et de remédiation GitOps sécurisée

Équipe 7 - Hackathon OVHcloud x Ynov, 6-7 juillet 2026.

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
├── Loki / Promtail               ── agrège les logs applicatifs de tous les namespaces
│
├── Namespaces dev / staging / prod / ai-remediation (voir §7.3)
│     dev = seul namespace corrige par l'IA ; staging/prod = promotion manuelle
│
└── Remédiateur (apps/remediator/remediator.py, hors cluster, cible dev)
        1. lit les VulnerabilityReport du namespace dev
        2. lit le manifest actuel depuis GitHub (source de vérité = Git, pas le cluster)
        3. envoie rapport + manifest à l'IA (AI Endpoints OVHcloud, Qwen2.5-VL-72B-Instruct)
        4. reçoit un YAML corrigé + une explication
        5. teste le correctif dans un namespace ephemere avant toute PR (voir §7.1)
        6. ouvre une Pull Request GitHub
                │
                ▼ revue humaine + merge
        Dépôt Git (GitHub) ──► Argo CD détecte le changement ──► resynchronise dev

monitoring-console (Node.js, hors cluster, optionnel) : dashboard qui interroge Argo CD +
Prometheus + Loki pour afficher le statut GitOps, les métriques et les logs par namespace.
```

## 3. Flux détaillé de la boucle

1. Un workload volontairement vulnérable (`apps/vulnerable-app/dev/`) est déployé via Argo CD
   dans le namespace `dev` — le seul environnement sur lequel le remédiateur a le droit d'agir
   (voir §7.3).
2. Trivy-operator le scanne en continu et publie un `VulnerabilityReport` (CVE) et un
   `ConfigAuditReport` (mauvaises pratiques : `privileged`, root, absence de limites).
3. Kyverno évalue les mêmes ressources contre 3 `ClusterPolicy` (`disallow-privileged`,
   `require-limits`, `disallow-latest-tag`) et publie des `PolicyReport`.
4. Falco surveille en parallèle le comportement runtime du pod (ex : lecture de `/etc/shadow`).
5. Le remédiateur (déclenché manuellement dans cette version hackathon) lit le
   `VulnerabilityReport`, lit le manifest **depuis GitHub** (jamais depuis le cluster - Git reste
   la seule source de vérité), et interroge l'IA avec un prompt structuré imposant un format de
   sortie strict (`EXPLICATION:` puis bloc ` ```yaml `).
6. Le YAML retourné est validé (`yaml.safe_load`) avant d'être committé sur une branche dédiée
   et proposé en Pull Request, avec l'explication de l'IA en description.
7. Un humain relit, ajuste si besoin (dans notre cas : changement du tag d'image proposé), puis
   merge.
8. Argo CD détecte le nouveau commit sur `main` et resynchronise automatiquement le cluster
   (`prune` + `selfHeal` activés) - sans jamais donner à l'IA ou au script un accès direct
   d'écriture au cluster.
9. Le scan Trivy suivant confirme la correction (dans notre run : 27 CRITICAL / 50 HIGH → 0 / 0).

## 4. Justification des choix techniques

- **Argo CD plutôt qu'un pipeline CI qui push** : modèle *pull* - l'agent GitOps va chercher les
  changements depuis le cluster, aucun credential cluster ne circule vers l'extérieur.
  Réduit la surface d'attaque (principe Zero Trust).
- **Trivy-operator plutôt que Kubescape** : rapports exposés directement comme des CRD
  Kubernetes (`VulnerabilityReport`, `ConfigAuditReport`), consommables nativement par
  `kubectl` et par notre script Python sans dépendance supplémentaire.
- **Kyverno en mode `Audit` (pas `Enforce`)** : en `Enforce`, Kyverno aurait bloqué la création
  même de notre workload volontairement vulnérable - on n'aurait plus rien eu à démontrer.
  Un choix pragmatique pour la durée du hackathon, à durcir en production.
- **Falco avec driver `modern_ebpf`** : seul driver ne nécessitant pas de compilation de module
  noyau, donc compatible avec un cluster managé où l'on ne contrôle pas le kernel des nodes.
- **Loki plutôt qu'ELK/Fluentd** : projet CNCF Incubating de l'écosystème Grafana, cohérent avec
  Prometheus/Grafana déjà en place ; n'indexe que les labels (pas le texte complet des logs),
  donc léger à faire tourner sur un cluster de la taille d'un hackathon.
- **monitoring-console (Node.js, hors cluster)** : petit dashboard, pas une brique de sécurité,
  qui agrège Argo CD + Prometheus + Loki par namespace pour visualiser en un coup d'œil que
  l'IA n'agit que sur `dev` (jamais `staging`/`prod`) — utile pour la démonstration, développé
  en collaboration avec un membre de l'équipe.
- **AI Endpoints OVHcloud, modèle Qwen2.5-VL-72B-Instruct** : API compatible OpenAI (changement
  de `base_url` uniquement), modèle imposé par la disponibilité du catalogue au moment du
  hackathon. Prompt à `temperature: 0.2` pour privilégier la fiabilité du YAML plutôt que la
  créativité.
- **Revue humaine obligatoire avant merge** : le garde-fou central de toute l'architecture.
  Constaté en pratique - le premier correctif de l'IA (passage en non-root) cassait le
  démarrage du conteneur (`/var/cache/nginx` non accessible en écriture) ; sans revue humaine,
  ce correctif cassé aurait été appliqué tel quel par Argo CD.

## 5. Statut CNCF des composants

| Composant | Rôle dans la chaîne | Statut CNCF |
|---|---|---|
| Argo CD | GitOps - synchronisation Git → cluster | Graduated |
| Trivy-operator | Audit de sécurité (CVE + config) | Projet Aqua Security, scanner validé CNCF |
| Kyverno | Policy-as-code | Graduated |
| Falco | Détection de menaces runtime | Graduated |
| Prometheus | Observabilité & métriques | Graduated |
| Loki | Agrégation de logs applicatifs | Incubating |
| AI Endpoints OVHcloud | Couche d'IA générative | OVHcloud (hors CNCF - assumé dans le brief) |

## 6. Limites et pistes d'amélioration

Voir `docs/demo-script.md` §D pour le détail (déclenchement manuel plutôt que CronJob, secrets
en variables d'environnement plutôt qu'External Secrets Operator, un seul rapport traité par
exécution). La validation avant merge n'est plus une limite théorique : voir §7 ci-dessous, un
test de staging automatique est réellement implémenté dans le remédiateur.

## 7. Vision : fiabilité (SLA) et validation progressive avant la production

Cette section répond à deux questions posées par le jury en soutenance : comment tenir un haut
niveau de disponibilité, et comment garantir qu'un correctif ne casse jamais la production.

### 7.1 Déjà implémenté : un vrai test fonctionnel avant chaque Pull Request

Le remédiateur (`apps/remediator/remediator.py`) ne se contente pas de proposer un YAML : avant
d'ouvrir la PR, il **déploie le correctif dans un namespace Kubernetes éphémère** (nommé
`remediator-staging-<id>`, distinct du namespace persistant `staging` décrit en §7.3), et
attend que le pod atteigne l'état `Ready`. Si ça échoue
(`CrashLoopBackOff`, erreur de permissions, image introuvable...), il **redemande un correctif à
l'IA en lui donnant le rapport d'échec exact** — une boucle d'auto-correction, pas un simple
essai unique. Si l'échec persiste, la PR est quand même ouverte, mais avec un titre et une
description signalant explicitement l'échec, pour que la revue humaine sache exactement quoi
vérifier. Le namespace de test est supprimé dans tous les cas.

C'est délibérément plus strict qu'un simple `kubectl apply --dry-run=server` : un dry-run
valide la conformité au schéma Kubernetes, mais n'aurait pas détecté notre propre incident réel
(pod qui *démarre* selon l'API mais qui *crash* juste après faute de volume inscriptible). Seul
un déploiement réel, même éphémère, révèle ce genre de défaut fonctionnel.

### 7.2 Fiabilité et disponibilité (SLA)

Approche SRE classique : on raisonne en **budget d'erreur** plutôt qu'en "zéro incident". Pour
un objectif de disponibilité élevé (ex. 99,99 %, soit environ 4 minutes d'indisponibilité
tolérées par mois), deux leviers comptent autant l'un que l'autre : réduire le **MTTD** (temps
de détection) et le **MTTR** (temps de réparation) — plutôt que de viser l'absence totale
d'incident, irréaliste.

Ce qui contribue déjà à ça dans l'architecture actuelle :
- **Argo CD `selfHeal`** : tout drift ou suppression accidentelle est corrigé automatiquement,
  sans intervention humaine — MTTR proche de zéro pour cette classe d'incidents.
- **Prometheus + Grafana** : détection proactive (MTTD bas) via les métriques de sécurité et de
  santé applicative.

Ce qu'on ajouterait pour un objectif de disponibilité formel en production :
- **Réplication (`replicas >= 2`) + anti-affinité de pods + `PodDisruptionBudget`** : le service
  survit à la perte d'un node ou à une maintenance planifiée.
- **Stratégie de rollout `RollingUpdate` avec `maxUnavailable: 0`** couplée à des
  **readiness/liveness probes** : aucun trafic n'est jamais routé vers un pod pas encore prêt,
  donc aucun déploiement ne cause de coupure visible.
- **Istio** (brique CNCF optionnelle déjà mentionnée dans le brief) : retries automatiques,
  circuit breaking, et mTLS entre services — utile dès que l'architecture applicative devient
  multi-services.
- **Alertmanager** branché sur Prometheus pour notifier l'équipe avant que le budget d'erreur ne
  soit consommé, plutôt qu'après coup.

### 7.3 Validation progressive : de dev à la production

Le test de staging éphémère du §7.1 est la première brique d'un pipeline de promotion plus
large. Une partie est désormais **réellement implémentée** (grâce au travail d'un membre de
l'équipe, intégré et adapté) plutôt que purement théorique :

**Déjà en place** :
1. **Trois namespaces déclarés par répertoire** (`apps/vulnerable-app/dev/`, `staging/`,
   `prod/`) plutôt que par branches Git longues : un seul historique, un diff explicite entre
   environnements, aucun risque de divergence entre branches qui ne se synchronisent plus. Un
   quatrième namespace, `ai-remediation`, est réservé à une future exécution du remédiateur
   *dans* le cluster (voir §7.4).
2. **Une Application Argo CD par environnement**, avec des politiques de synchronisation
   volontairement différentes : `vulnerable-app-dev` est en `syncPolicy.automated` (l'IA peut y
   proposer des correctifs librement, Argo CD les applique dès qu'ils sont mergés) ;
   `vulnerable-app-staging` et `vulnerable-app-prod` **n'ont pas** de synchronisation
   automatique — leur Application existe et affiche l'état cible, mais rien ne s'applique tant
   qu'un humain ne déclenche pas la synchronisation manuellement.
3. **Garde-fou dans le code du remédiateur** : `remediator.py` refuse explicitement de
   s'exécuter si `TARGET_NAMESPACE` vaut `staging` ou `prod` — la contrainte n'est pas qu'une
   convention documentée, elle est vérifiée avant toute action.

**Reste à faire pour un pipeline de promotion complet** :
4. Automatiser la promotion `dev → staging → prod` par un commit qui copie le manifest validé
   d'un environnement vers le suivant (aujourd'hui, la copie initiale existe mais la promotion
   reste un geste manuel non outillé).
5. **Argo Rollouts** (projet de la famille Argo, donc du même écosystème CNCF qu'Argo CD) pour
   un déploiement **canary** en production : le nouveau correctif reçoit d'abord 10 % du trafic,
   une `AnalysisTemplate` interroge Prometheus (taux d'erreur, latence) à chaque palier, et
   promeut automatiquement (25 % → 50 % → 100 %) ou déclenche un **rollback automatique** si les
   métriques se dégradent — sans qu'un humain ait à surveiller le rollout en temps réel.

Ce pipeline (namespaces séparés + promotion manuelle + à terme canary/rollback automatique) est
la réponse structurelle à "comment ne jamais bloquer la prod" : chaque étape est un filtre
supplémentaire, et aucune n'est laissée à la seule discrétion de l'IA.

### 7.4 Ce qu'il resterait à faire pour une vraie mise en production

- Étendre le test de staging du remédiateur à un déploiement Argo Rollouts canary réel (au lieu
  d'un simple pod isolé).
- External Secrets Operator pour ne plus jamais manipuler de credentials en variables
  d'environnement, même en local.
- Déclenchement du remédiateur par `CronJob` plutôt que manuellement, déployé dans le namespace
  `ai-remediation` déjà réservé à cet effet (voir §D du script de démo).
- Automatiser la promotion `dev → staging → prod` (aujourd'hui : manifests dupliqués mais
  promotion non outillée, voir §7.3).
- Traiter tous les `VulnerabilityReport`/`ConfigAuditReport` du cluster, pas seulement le
  premier trouvé.
