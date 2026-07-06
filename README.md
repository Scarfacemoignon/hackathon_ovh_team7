# Hackathon OVHcloud x Ynov — Équipe 7

Chaîne d'audit et de remédiation GitOps sécurisée sur Kubernetes.

Boucle cible : détection d'une faille (Trivy Operator) → analyse et correctif proposé par l'IA (AI Endpoints OVHcloud) → Pull Request automatique → revue humaine → merge → resynchronisation Argo CD → cluster corrigé.

## Structure du dépôt

```
apps/
  vulnerable-app/   # le workload volontairement vulnérable (la "cible")
  remediator/       # script IA : lecture des rapports Trivy, génération du correctif, ouverture de PR
infra/
  argocd-apps/      # Applications Argo CD (pattern app-of-apps)
  trivy/
  kyverno/
  prometheus/
  falco/
policies/           # policies Kyverno
docs/               # rapport d'architecture + tableau CNCF
```

## Stack (100% CNCF)

Argo CD · Trivy Operator · Kyverno · Falco · Prometheus · AI Endpoints OVHcloud
