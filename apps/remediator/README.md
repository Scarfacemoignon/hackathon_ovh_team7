# Remédiateur IA

Script qui ferme la boucle : lit les `VulnerabilityReport` de Trivy-operator dans le cluster,
demande un correctif à l'IA (AI Endpoints OVHcloud), **valide ce correctif en le déployant dans
un namespace de staging éphémère** (isolé du namespace `demo` de production), puis ouvre une
Pull Request GitHub avec le manifest corrigé et le résultat du test. La PR doit être relue et
mergée par un humain — Argo CD applique ensuite le changement automatiquement.

## Ce que fait le test de staging automatique

Avant d'ouvrir la moindre PR, le script :
1. Déploie le manifest corrigé dans un namespace jetable (`remediator-staging-<id>`), jamais
   dans `demo`.
2. Attend jusqu'à 60s que le pod devienne `Ready`.
3. Si le pod échoue (`CrashLoopBackOff`, `Error`, `ImagePullBackOff`...), il **redemande un
   correctif à l'IA en lui donnant le rapport d'échec exact** (une seule retentative), pour
   qu'elle corrige précisément la cause.
4. Si l'échec persiste après la retentative, la PR est quand même ouverte — mais avec un titre
   `[STAGING ECHOUE]` explicite et les logs du pod de test en description, pour que la revue
   humaine sache exactement quoi vérifier avant de merger.
5. Le namespace de test est systématiquement supprimé à la fin, qu'il y ait succès ou échec.

C'est la réponse concrète à "comment tester avant que ça ne casse la prod" : le correctif de
l'IA n'atteint jamais `demo` sans être passé par cette validation fonctionnelle au préalable
(pas seulement un `--dry-run` syntaxique).

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
