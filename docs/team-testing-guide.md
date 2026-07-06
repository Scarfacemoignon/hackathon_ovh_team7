# Guide de test pour l'équipe — vérifier que la stack fonctionne sur son poste

Ce guide s'adresse à un coéquipier qui veut vérifier, depuis sa propre machine, que la chaîne
GitOps fonctionne bien de bout en bout. À suivre dans l'ordre ; chaque étape a un critère de
réussite explicite ("✅ Attendu :").

## 0. Prérequis (à demander à l'équipe si tu ne les as pas)

- `kubeconfig-equipe-7.yaml` — kubeconfig admin du cluster (partagé, **ne jamais le committer**).
- `ai-endpoints-key.txt` — clé API AI Endpoints OVHcloud (partagée, **ne jamais la committer**).
- Accès en lecture au dépôt GitHub (il est public, donc pas besoin d'invitation).

## 1. Installer les outils

```bash
# Linux (Debian/Ubuntu) — adapter pour macOS (brew install kubectl helm gh kubectx k9s argocd)
curl -LO "https://dl.k8s.io/release/$(curl -Ls https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
sudo install -m 0755 kubectl /usr/local/bin/kubectl

curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash

# GitHub CLI : suivre https://github.com/cli/cli/blob/trunk/docs/install_linux.md
```
✅ Attendu : `kubectl version --client` et `helm version` répondent sans erreur.

## 2. Cloner le dépôt et configurer l'accès au cluster

```bash
git clone https://github.com/Scarfacemoignon/hackathon_ovh_team7.git
cd hackathon_ovh_team7

mkdir -p ~/.kube
cp /chemin/vers/kubeconfig-equipe-7.yaml ~/.kube/config
chmod 600 ~/.kube/config
```
✅ Attendu :
```bash
kubectl get nodes
# doit afficher 3 nodes pool-equipe-7-node-* en Ready
```

**Si erreur `connection refused` / `Unauthorized`** : vérifier que le fichier est bien dans
`~/.kube/config`, ou exporter explicitement `export KUBECONFIG=/chemin/vers/kubeconfig-equipe-7.yaml`.

## 3. Vérifier l'état de la chaîne GitOps

```bash
kubectl get applications -n argocd -o custom-columns=NAME:.metadata.name,SYNC:.status.sync.status,HEALTH:.status.health.status
```
✅ Attendu : 7 Applications (`root`, `vulnerable-app`, `trivy-operator`, `kyverno`, `policies`,
`kube-prometheus-stack`, `falco`), toutes `Synced` / `Healthy`.

**Si une Application est `OutOfSync`** : c'est parfois normal juste après un commit d'un
coéquipier (Argo CD n'a pas encore resynchronisé, ça arrive automatiquement sous 3 min). Pour
forcer : `kubectl patch application <nom> -n argocd --type merge -p '{"operation":{"sync":{}}}'`.

## 4. Vérifier que la détection de sécurité fonctionne

```bash
kubectl get vulnerabilityreports -n demo       # CVE détectées par Trivy
kubectl get configauditreports -n demo         # mauvaises pratiques détectées par Trivy
kubectl get policyreports -n demo              # violations détectées par Kyverno
```
✅ Attendu : des rapports existent, avec des CVE CRITICAL/HIGH visibles (sauf si le correctif IA
a déjà été mergé entre-temps par un coéquipier — dans ce cas 0 CRITICAL est normal aussi).

## 5. Se connecter aux interfaces web

Configurer `.env` : `cp .env.example .env`, puis remplir chaque valeur avec les commandes
`kubectl` indiquées en commentaire dans le fichier (ou demander les mots de passe à l'équipe —
ce sont des valeurs définies manuellement, pas générées, donc stables et partageables).

```bash
source .env
kubectl port-forward svc/argocd-server -n argocd 8080:443            # terminal 1
kubectl port-forward svc/kube-prometheus-stack-grafana -n monitoring 3000:80   # terminal 2
kubectl port-forward svc/falco-falcosidekick-ui -n falco 2802:2802   # terminal 3
```
✅ Attendu : connexion réussie sur https://localhost:8080 (Argo CD), http://localhost:3000
(Grafana), http://localhost:2802 (Falco UI) avec les identifiants du `.env`.

## 6. Tester la brique IA (sans ouvrir de PR)

```bash
cd apps/remediator
python3 -m venv .venv
.venv/bin/pip install openai kubernetes PyGithub pyyaml
source ../../.env
.venv/bin/python test_ai_connection.py
```
✅ Attendu : une réponse courte de l'IA s'affiche (`Oui`, ou équivalent). Si erreur 401, vérifier
`OVH_AI_TOKEN` et `OVH_AI_BASE_URL` dans le `.env`.

## 7. (Optionnel, à coordonner avec l'équipe) Tester la boucle complète

⚠️ Ne lancer `remediator.py` (pas `test_ai_connection.py`) qu'après avoir vérifié avec l'équipe
qu'aucune PR `fix/ai-remediation` n'est déjà ouverte (`gh pr list` sur le dépôt) — sinon conflit
avec une PR existante. Voir `docs/demo-script.md` §B pour remettre le cluster en état vulnérable
avant de tester, et §C étape 4 pour lancer le remédiateur.

## Récapitulatif : ce que "ça fonctionne" veut dire

| Vérification | Commande | Résultat attendu |
|---|---|---|
| Cluster accessible | `kubectl get nodes` | 3 nodes `Ready` |
| GitOps à jour | `kubectl get applications -n argocd` | Toutes `Synced`/`Healthy` |
| Détection active | `kubectl get vulnerabilityreports -n demo` | Rapports présents |
| UIs accessibles | ouvrir les 3 URLs après `port-forward` | Login réussi |
| IA connectée | `test_ai_connection.py` | Réponse de l'IA affichée |
