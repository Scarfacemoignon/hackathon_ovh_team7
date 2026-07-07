# Aide-mémoire — toutes les commandes utilisées pendant le hackathon

Référence complète, organisée par thème, de toutes les commandes exécutées pour construire et
faire fonctionner cette chaîne GitOps. Utile pour reproduire l'installation sur un autre poste,
dépanner, ou simplement comprendre "avec quoi on a construit ça".

## 1. Installation des outils (sans droits sudo, dans `~/.local/bin`)

```bash
# kubectl
KVER=$(curl -Ls https://dl.k8s.io/release/stable.txt)
curl -LO "https://dl.k8s.io/release/${KVER}/bin/linux/amd64/kubectl"
install -m 0755 kubectl ~/.local/bin/kubectl

# helm
export HELM_INSTALL_DIR="$HOME/.local/bin"
curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 -o get-helm-3.sh
chmod +x get-helm-3.sh
USE_SUDO=false HELM_INSTALL_DIR="$HOME/.local/bin" ./get-helm-3.sh

# gh (GitHub CLI)
GH_VER=$(curl -Ls https://api.github.com/repos/cli/cli/releases/latest | grep -oP '"tag_name": "v\K[^"]+')
curl -LO "https://github.com/cli/cli/releases/download/v${GH_VER}/gh_${GH_VER}_linux_amd64.tar.gz"
tar -xzf "gh_${GH_VER}_linux_amd64.tar.gz"
install -m 0755 "gh_${GH_VER}_linux_amd64/bin/gh" ~/.local/bin/gh

# kubectx / kubens
KX_VER=$(curl -Ls https://api.github.com/repos/ahmetb/kubectx/releases/latest | grep -oP '"tag_name": "v\K[^"]+')
curl -LO "https://github.com/ahmetb/kubectx/releases/download/v${KX_VER}/kubectx_v${KX_VER}_linux_x86_64.tar.gz"
curl -LO "https://github.com/ahmetb/kubectx/releases/download/v${KX_VER}/kubens_v${KX_VER}_linux_x86_64.tar.gz"
tar -xzf "kubectx_v${KX_VER}_linux_x86_64.tar.gz" && tar -xzf "kubens_v${KX_VER}_linux_x86_64.tar.gz"
install -m 0755 kubectx ~/.local/bin/kubectx
install -m 0755 kubens ~/.local/bin/kubens

# k9s
K9S_VER=$(curl -Ls https://api.github.com/repos/derailed/k9s/releases/latest | grep -oP '"tag_name": "\K[^"]+')
curl -LO "https://github.com/derailed/k9s/releases/download/${K9S_VER}/k9s_Linux_amd64.tar.gz"
tar -xzf k9s_Linux_amd64.tar.gz k9s
install -m 0755 k9s ~/.local/bin/k9s

# argocd CLI
curl -sSL -o ~/.local/bin/argocd https://github.com/argoproj/argo-cd/releases/latest/download/argocd-linux-amd64
chmod +x ~/.local/bin/argocd
```

## 2. Accès au cluster

```bash
mkdir -p ~/.kube
cp kubeconfig-equipe-7.yaml ~/.kube/config
chmod 600 ~/.kube/config

kubectl config current-context      # verifier quel cluster/identite est actif
kubectl get nodes                   # verifier que le cluster repond (3 nodes Ready attendus)
```

## 3. Argo CD

```bash
# Installation (seule fois où on touche le cluster en kubectl apply direct)
kubectl create namespace argocd
kubectl apply -n argocd --server-side --force-conflicts \
  -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml
# --server-side est necessaire : la CRD ApplicationSet depasse la limite de 262144 octets
# de l'annotation kubectl.kubernetes.io/last-applied-configuration en mode classique.

kubectl -n argocd wait --for=condition=Ready pods --all --timeout=180s

# Mot de passe admin initial
kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath='{.data.password}' | base64 -d

# Connexion CLI
kubectl port-forward svc/argocd-server -n argocd 8080:443
argocd login localhost:8080 --username admin --password '<mot-de-passe>' --insecure

# Connecter le depot (public, pas de credentials necessaires en lecture)
argocd repo add https://github.com/Scarfacemoignon/hackathon_ovh_team7.git

# Verifier l'etat de toutes les Applications (fiable meme si le tunnel argocd CLI est instable)
kubectl get applications -n argocd -o custom-columns=NAME:.metadata.name,SYNC:.status.sync.status,HEALTH:.status.health.status

# Forcer une synchronisation (equivalent a "argocd app sync" mais sans dependre du tunnel)
kubectl patch application <nom> -n argocd --type merge -p '{"operation":{"sync":{}}}'

# Changer le mot de passe admin (le rendre memorisable pour la demo)
argocd account update-password --account admin \
  --current-password '<ancien>' --new-password '<nouveau>'
```

## 4. Trivy-operator — lire les rapports

```bash
kubectl get vulnerabilityreports -A                          # vue d'ensemble
kubectl get vulnerabilityreports -n dev -o yaml              # detail complet
kubectl get configauditreports -n dev -o yaml                # mauvaises pratiques de config

# Version lisible triee par severite (jq maison en python)
kubectl get vulnerabilityreport <nom> -n dev -o json | python3 -c "
import json,sys
d = json.load(sys.stdin)
vulns = d['report']['vulnerabilities']
order = {'CRITICAL':0,'HIGH':1,'MEDIUM':2,'LOW':3}
vulns.sort(key=lambda v: order.get(v['severity'],9))
for v in vulns[:15]:
    print(f\"{v['vulnerabilityID']:15} [{v['severity']:8}] {v['resource']} {v.get('installedVersion','?')} -> fix: {v.get('fixedVersion','n/a')}\")
"
```

## 5. Kyverno

```bash
kubectl get clusterpolicy                                     # les 3 policies, statut Ready
kubectl get policyreports -A                                  # violations par ressource
kubectl get policyreports -n dev -o wide
```

## 6. Prometheus / Grafana

```bash
kubectl port-forward svc/kube-prometheus-stack-grafana -n monitoring 3000:80
kubectl port-forward svc/kube-prometheus-stack-prometheus -n monitoring 9090:9090

# Interroger Prometheus depuis l'interieur du cluster (sans tunnel) via un pod jetable
kubectl run curl-test --image=curlimages/curl --restart=Never --rm -i --timeout=30s -n monitoring -- \
  curl -s "http://kube-prometheus-stack-prometheus.monitoring.svc:9090/api/v1/query?query=sum(trivy_image_vulnerabilities%7Bseverity=%22Critical%22%7D)"

# Recuperer/changer le mot de passe Grafana (secret fige via existingSecret, voir §7)
kubectl -n monitoring get secret grafana-admin-credentials -o jsonpath='{.data.admin-password}' | base64 -d
kubectl -n monitoring patch secret grafana-admin-credentials --type merge -p '{"stringData":{"admin-password":"<nouveau>"}}'
kubectl delete pods -n monitoring -l app.kubernetes.io/name=grafana   # pour que le pod recharge le secret
```

## 6bis. Loki (logs, pour monitoring-console)

```bash
kubectl port-forward svc/loki -n monitoring 3100:3100

# Namespaces ayant deja des logs indexes (Promtail ne pousse que les NOUVELLES lignes
# depuis son demarrage -- un pod sans trafic recent peut ne pas encore y apparaitre)
curl -s "http://localhost:3100/loki/api/v1/label/namespace/values"
```

## 7. Falco

```bash
kubectl port-forward svc/falco-falcosidekick-ui -n falco 2802:2802
kubectl logs -n falco -l app.kubernetes.io/name=falco --tail=50 | grep -i warning

# Declencher une alerte de demo (sur un pod qui tourne encore en root)
kubectl exec -it deploy/vulnerable-web -n dev -- sh -c "cat /etc/shadow"

# Recuperer/changer les identifiants Falco UI (format "user:motdepasse" dans une seule cle)
kubectl -n falco get secret falco-ui-credentials -o jsonpath='{.data.FALCOSIDEKICK_UI_USER}' | base64 -d
kubectl -n falco patch secret falco-ui-credentials --type merge -p '{"stringData":{"FALCOSIDEKICK_UI_USER":"admin:<nouveau>"}}'
```

## 8. Git / GitHub

```bash
git clone https://github.com/Scarfacemoignon/hackathon_ovh_team7.git
git add <fichiers> && git commit -m "..." && git push

# Verifier l'etat distant sans avoir besoin d'un clone local a jour
git ls-remote https://github.com/Scarfacemoignon/hackathon_ovh_team7.git refs/heads/main

# Lister/fermer une PR (via l'API REST directement, plus fiable que gh si gh n'est pas authentifie)
curl -s -H "Authorization: Bearer $GITHUB_TOKEN" "https://api.github.com/repos/Scarfacemoignon/hackathon_ovh_team7/pulls?state=all"
curl -s -X PATCH -H "Authorization: Bearer $GITHUB_TOKEN" \
  "https://api.github.com/repos/Scarfacemoignon/hackathon_ovh_team7/pulls/<numero>" -d '{"state":"closed"}'

# Creer une branche figee sur un commit precis (reference stable pour le rejeu de demo)
git branch vulnerable-baseline <sha-du-commit>
git push -u origin vulnerable-baseline
```

## 9. Le remédiateur

```bash
cd apps/remediator
python3 -m venv .venv
.venv/bin/pip install openai kubernetes PyGithub pyyaml

source ../../.env      # charge entre autres TARGET_NAMESPACE=dev, MANIFEST_PATH=apps/vulnerable-app/dev/deployment.yaml
.venv/bin/python test_ai_connection.py     # test isole de la connexion IA, sans toucher a GitHub
.venv/bin/python remediator.py             # boucle complete : rapport -> IA -> staging -> PR
# Le script refuse de s'executer si TARGET_NAMESPACE vaut "staging" ou "prod" (garde-fou).
```

## 10. Procédure de rejeu (remettre le cluster en état vulnérable)

```bash
cd ~/Desktop/"Hackathon-Challenge OVH"/hackathon_ovh_team7   # toujours depuis la racine du depot
git checkout main && git pull
git show vulnerable-baseline:apps/vulnerable-app/dev/deployment.yaml > apps/vulnerable-app/dev/deployment.yaml
git add apps/vulnerable-app/dev/deployment.yaml
git commit -m "demo: retour a l'etat vulnerable pour rejouer la boucle"
git push
kubectl patch application vulnerable-app-dev -n argocd --type merge -p '{"operation":{"sync":{}}}'
```

## 12. Promotion manuelle dev → staging → prod

```bash
# Une fois 'dev' valide (0 CVE CRITICAL/HIGH, 3/3 policies Kyverno OK) :
git show main:apps/vulnerable-app/dev/deployment.yaml | sed 's/namespace: dev/namespace: staging/' > apps/vulnerable-app/staging/deployment.yaml
git add apps/vulnerable-app/staging/deployment.yaml
git commit -m "promote: dev -> staging" && git push
kubectl patch application vulnerable-app-staging -n argocd --type merge -p '{"operation":{"sync":{}}}'

# Meme principe pour staging -> prod, avec vulnerable-app-prod.
```

## 11. Dépannage

```bash
# Tunnel port-forward "vivant" mais mort (voir README §4 pour le detail)
curl -sk -o /dev/null -w "%{http_code}\n" http://localhost:3000   # 000 = tunnel mort
pkill -f "kubectl port-forward"
# puis relancer chaque port-forward

# CRD trop volumineuse pour kubectl apply classique
kubectl apply --server-side --force-conflicts -f <fichier-ou-url>

# Forcer un Argo CD Application a resynchroniser sans dependre du tunnel/CLI argocd
kubectl patch application <nom> -n argocd --type merge -p '{"operation":{"sync":{}}}'

# Voir pourquoi un pod ne demarre pas (reflexe systematique, dans cet ordre)
kubectl get pods -n <namespace>
kubectl describe pod <nom> -n <namespace>      # lire la section Events en bas
kubectl logs <nom> -n <namespace>
```
