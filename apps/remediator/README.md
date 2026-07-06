# Remédiateur IA

Script qui ferme la boucle : lit les `VulnerabilityReport` de Trivy-operator dans le cluster,
demande un correctif à l'IA (AI Endpoints OVHcloud), et ouvre une Pull Request GitHub avec
le manifest corrigé. La PR doit être relue et mergée par un humain — Argo CD applique ensuite
le changement automatiquement.

## Installation

```bash
python3 -m venv .venv
.venv/bin/pip install openai kubernetes PyGithub pyyaml
```

## Variables d'environnement requises

| Variable | Description |
|---|---|
| `OVH_AI_TOKEN` | Clé d'API AI Endpoints OVHcloud |
| `OVH_AI_BASE_URL` | URL de base du modèle, ex: `https://oai.endpoints.kepler.ai.cloud.ovh.net/v1` |
| `OVH_AI_MODEL` | Nom exact du modèle, ex: `Qwen2.5-VL-72B-Instruct` |
| `GITHUB_TOKEN` | Token GitHub *fine-grained*, droits `Contents: Read/Write` + `Pull requests: Read/Write`, scopé sur ce repo uniquement |
| `GITHUB_REPO` | `Scarfacemoignon/hackathon_ovh_team7` |

**Sécurité** : ces variables ne doivent jamais être committées dans Git. En production, on les
gérerait via un `Secret` Kubernetes + External Secrets Operator plutôt qu'en clair dans le shell.
Pour le hackathon, un fichier `.env` à la racine du dépôt (ignoré par Git, voir `.env.example`
pour le modèle) évite d'avoir à les retaper à chaque fois.

## Lancer

```bash
source ../../.env       # ou exporter les 5 variables ci-dessus manuellement
.venv/bin/python remediator.py
```

Résultat attendu : une Pull Request s'ouvre sur GitHub, contenant le YAML corrigé (image récente,
plus de `privileged`, `runAsNonRoot`, limites ajoutées) et l'explication de l'IA en description.
