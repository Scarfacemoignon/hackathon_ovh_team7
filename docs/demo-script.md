# Script de démo - 10 minutes chrono

Équipe 7 - Hackathon OVHcloud x Ynov. Cluster : `hackathon-equipe-7` (gra11).
Dépôt : https://github.com/Scarfacemoignon/hackathon_ovh_team7

## Avant de commencer (backstage, pas devant le jury)

Ouvrir chacun de ces tunnels dans un terminal séparé, **avant** de parler :

```bash
kubectl port-forward svc/argocd-server -n argocd 8080:443
kubectl port-forward svc/kube-prometheus-stack-grafana -n monitoring 3000:80
kubectl port-forward svc/falco-falcosidekick-ui -n falco 2802:2802
```

- Argo CD : https://localhost:8080 — `admin` / `kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath='{.data.password}' | base64 -d`
- Grafana : http://localhost:3000 — `admin` / `kubectl -n monitoring get secret kube-prometheus-stack-grafana -o jsonpath='{.data.admin-password}' | base64 -d`
- Falco UI : http://localhost:2802 — `kubectl -n falco get secret falco-ui-credentials -o jsonpath='{.data.FALCOSIDEKICK_UI_USER}' | base64 -d` (format `admin:motdepasse`)

Aucun de ces mots de passe n'est en clair dans le dépôt — voir README §4 pour le détail.

**Remettre le cluster en état vulnérable avant la démo** (voir procédure de rejeu ci-dessous) pour pouvoir montrer la boucle en direct plutôt qu'un état déjà corrigé.

## Déroulé (10 minutes)

**1. (1 min) Tout part de Git.**
Montrer le dépôt GitHub (structure `apps/`, `infra/argocd-apps/`, `policies/`) et l'UI Argo CD :
les Applications `root`, `vulnerable-app`, `trivy-operator`, `kyverno`, `policies`,
`kube-prometheus-stack`, `falco` - toutes `Synced`/`Healthy`, gérées par le pattern App-of-Apps.

**2. (1 min) L'app vulnérable et sa détection.**
```bash
kubectl get vulnerabilityreports -n demo
kubectl get configauditreports -n demo
```
Montrer le nombre de CVE CRITICAL/HIGH sur `nginx:1.14`, et dans Grafana le graphique
`sum(trivy_image_vulnerabilities{severity="Critical"})`.

**3. (1 min) Violation Kyverno + alerte Falco en direct.**
```bash
kubectl get policyreports -n demo
kubectl exec -it deploy/vulnerable-web -n demo -- sh -c "cat /etc/shadow"
kubectl logs -n falco -l app.kubernetes.io/name=falco --tail=20 | grep -i warning
```
Montrer aussi l'alerte dans la Falco UI (http://localhost:2802) - moment très visuel.

**4. (2 min) Lancer le remédiateur - la PR s'ouvre en direct.**
```bash
cd apps/remediator
export OVH_AI_TOKEN="..."
export OVH_AI_BASE_URL="https://oai.endpoints.kepler.ai.cloud.ovh.net/v1"
export OVH_AI_MODEL="Qwen2.5-VL-72B-Instruct"
export GITHUB_TOKEN="..."
export GITHUB_REPO="Scarfacemoignon/hackathon_ovh_team7"
.venv/bin/python remediator.py
```
Le script affiche : le rapport résumé lu depuis le cluster, l'explication de l'IA, et l'URL de
la Pull Request. L'ouvrir dans le navigateur devant le jury.

**5. (2 min) Revue humaine - merger devant le jury.**
Lire le diff et l'explication de l'IA à voix haute, expliquer *pourquoi* une revue humaine reste
obligatoire (l'IA peut se tromper - cf. les limites ci-dessous), puis merger la PR.

**6. (2 min) Argo CD resynchronise, cluster corrigé.**
```bash
kubectl get pods -n demo -w
```
Montrer le nouveau pod démarrer, l'ancien être supprimé (`prune`), et dans Grafana la courbe
`trivy_image_vulnerabilities{severity="Critical"}` chuter au scan suivant. Vérifier aussi
`kubectl get policyreports -n demo` : 0 violation.

**7. (1 min) Conclusion.**
Tableau récapitulatif CNCF (voir `docs/architecture.md`), limites connues et pistes
d'amélioration (voir ci-dessous).

## Procédure de rejeu (avant la démo, ou en cas de "je remercie" du jury)

Le dépôt a déjà un correctif mergé. Pour remettre le cluster en état vulnérable et
pouvoir rejouer la boucle en live :

```bash
git checkout main
git pull
git show vulnerable-baseline:apps/vulnerable-app/deployment.yaml > apps/vulnerable-app/deployment.yaml
git add apps/vulnerable-app/deployment.yaml
git commit -m "demo: retour a l'etat vulnerable pour rejouer la boucle"
git push
```
Argo CD resynchronise automatiquement (ou forcer : `kubectl patch application vulnerable-app -n argocd --type merge -p '{"operation":{"sync":{}}}'`).
Attendre ~1-2 min que Trivy rescanne l'image avant de commencer la démo.

## Limites connues et pistes d'amélioration (à mentionner en conclusion)

1. **Le remédiateur ne boucle que sur `reports[0]`** (un seul rapport) - en prod, il faudrait
   itérer sur tous les `VulnerabilityReport` et `ConfigAuditReport` du cluster.
2. **Déclenchement manuel** - la vraie automatisation serait un `CronJob` Kubernetes
   (via `config.load_incluster_config()` + un `ServiceAccount` en lecture seule sur les CRD Trivy),
   qu'on a documenté mais pas eu le temps d'implémenter en 2 jours.
3. **Pas de validation `--dry-run=server` avant la PR** - on l'a découvert à nos dépens :
   le premier correctif de l'IA (passage en non-root) cassait le démarrage de nginx
   (`/var/cache/nginx` non accessible en écriture). La revue humaine l'a intercepté, mais un
   `kubectl apply --dry-run=server` automatique avant l'ouverture de la PR aurait évité l'aller-retour.
4. **Secrets en variables d'environnement** - à remplacer par un `Secret` Kubernetes +
   External Secrets Operator (brique optionnelle CNCF) en production.
5. **Pas de garde anti-doublon de PR** - vérifier qu'une PR `fix/ai-remediation` n'est pas déjà
   ouverte avant d'en recréer une.
