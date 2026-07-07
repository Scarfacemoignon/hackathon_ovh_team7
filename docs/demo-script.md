# Script de démo — 10 minutes chrono, de A à Z

Équipe 7 — Hackathon OVHcloud x Ynov. Cluster : `hackathon-equipe-7` (gra11).
Dépôt : https://github.com/Scarfacemoignon/hackathon_ovh_team7

Toutes les commandes sont en bash (poste Linux/macOS). Sous Windows, adapter avec PowerShell
(`Get-Content` au lieu de `cat`, `$env:VAR` au lieu de `export`, etc.) — le principe reste
identique.

## A. Backstage — à faire 15-20 min avant de passer devant le jury

**1. Vérifier l'accès au cluster.**
```bash
kubectl config current-context      # doit afficher kubernetes-admin@hackathon-equipe-7
kubectl get nodes                   # 3 nodes en Ready
```

**2. Se placer à la racine du dépôt et charger les identifiants.**
```bash
cd ~/Desktop/"Hackathon-Challenge OVH"/hackathon_ovh_team7    # toujours revenir ici entre deux étapes
source .env      # si absent : cp .env.example .env, puis remplir (voir README §4)
```

**3. Ouvrir les tunnels, chacun dans un terminal séparé, et les laisser tourner.**
```bash
kubectl port-forward svc/argocd-server -n argocd 8080:443
kubectl port-forward svc/kube-prometheus-stack-grafana -n monitoring 3000:80
kubectl port-forward svc/kube-prometheus-stack-prometheus -n monitoring 9090:9090
kubectl port-forward svc/falco-falcosidekick-ui -n falco 2802:2802
kubectl port-forward svc/loki -n monitoring 3100:3100   # optionnel, requis seulement pour monitoring-console
```
Si une page ne charge pas alors que le process tourne encore (`ps aux | grep port-forward`),
c'est un tunnel mort après une coupure réseau — `curl -sk -o /dev/null -w "%{http_code}\n"
http://localhost:3000` renverra `000`. Solution : `pkill -f "kubectl port-forward"` puis
relancer les 5 commandes ci-dessus (voir `docs/commands-reference.md` §11).

**3bis. (Optionnel) Lancer la console de monitoring** — dashboard visuel montrant que l'IA
n'agit que sur `dev`, jamais `staging`/`prod` ; utile en backup visuel pour la conclusion SLA ou
si le jury pose des questions dessus, pas indispensable au déroulé chronométré :
```bash
cd monitoring-console/backend
NODE_TLS_REJECT_UNAUTHORIZED=0 npm start   # nécessite un .env local, voir monitoring-console/README.md
```
Ouvrir http://localhost:4000. Si `/logs` est vide pour `dev`, générer un peu de trafic
(Promtail ne pousse que les logs écrits *après* son démarrage) :
```bash
POD=$(kubectl get pods -n dev -o jsonpath='{.items[0].metadata.name}')
kubectl port-forward "$POD" -n dev 8888:80 &
curl -s http://localhost:8888/ && curl -s http://localhost:8888/inconnu
```

**4. Vérifier que tout est vert.**
```bash
kubectl get applications -n argocd -o custom-columns=NAME:.metadata.name,SYNC:.status.sync.status,HEALTH:.status.health.status
```
**Sortie attendue** (11 Applications) :
```
NAME                     SYNC        HEALTH
falco                    Synced      Healthy
kube-prometheus-stack    Synced      Healthy
kyverno                  OutOfSync   Healthy      <- normal, CRD nouvelle generation non utilisees, voir README
loki                     Synced      Healthy
namespaces               Synced      Healthy
policies                 Synced      Healthy
root                     Synced      Healthy
trivy-operator           Synced      Healthy
vulnerable-app-dev       Synced      Healthy
vulnerable-app-prod      OutOfSync   Missing      <- normal, promotion manuelle uniquement
vulnerable-app-staging   OutOfSync   Missing      <- normal, promotion manuelle uniquement
```
Seuls `kyverno` (OutOfSync inoffensif), `vulnerable-app-prod` et `vulnerable-app-staging`
(Missing volontaire) s'écartent de `Synced`/`Healthy` — tout le reste doit être vert.

**5. Se connecter à chaque outil pour confirmer les mots de passe** (voir README §4) :
- Argo CD : https://localhost:8080 (`admin` / `$ARGOCD_ADMIN_PASSWORD`)
- Grafana : http://localhost:3000 (`admin` / `$GRAFANA_ADMIN_PASSWORD`)
- Falco UI : http://localhost:2802 (`admin` / `$FALCO_UI_PASSWORD`)

**6. Remettre le cluster en état vulnérable — étape indispensable, à faire ici et pas plus
tard.** Toute la valeur de la démo (§C) dépend de partir d'un état vulnérable visible. Suivre la
procédure complète en §B ci-dessous **avant** de passer à la répétition ou à la présentation.

**7. Répéter tout le déroulé (§C) au moins deux fois avant la vraie soutenance**, chrono en
main, en refaisant systématiquement le rejeu (§B) entre deux répétitions. Préparer un plan B :
captures d'écran ou enregistrement de chaque étape, au cas où le Wi-Fi ou le cluster flancherait
pendant la présentation.

## B. Procédure de rejeu — remettre le cluster en état vulnérable

**À faire avant chaque répétition ou avant la vraie démo**, et chaque fois qu'un correctif a été
mergé entre-temps (le vôtre ou celui d'un coéquipier).

```bash
cd ~/Desktop/"Hackathon-Challenge OVH"/hackathon_ovh_team7   # toujours depuis la racine du depot, jamais depuis apps/remediator
git checkout main
git pull
git show vulnerable-baseline:apps/vulnerable-app/dev/deployment.yaml > apps/vulnerable-app/dev/deployment.yaml
git add apps/vulnerable-app/dev/deployment.yaml
git commit -m "demo: retour a l'etat vulnerable pour rejouer la boucle"
git push
```
Argo CD resynchronise automatiquement (`prune`+`selfHeal`), ou forcer :
```bash
kubectl patch application vulnerable-app-dev -n argocd --type merge -p '{"operation":{"sync":{}}}'
```

**Vérifier visuellement que l'état vulnérable est bien en place** (réflexe à avoir avant
d'aller plus loin, pas seulement se fier au statut Argo CD) :
```bash
cat apps/vulnerable-app/dev/deployment.yaml
```
Tu dois voir exactement ces éléments volontairement vulnérables :
```yaml
image: nginx:1.14
securityContext:
  privileged: true
  runAsUser: 0
```
C'est le point de départ qui prouve, en fin de démo, que la chaîne a corrigé quelque chose de
réel — sans cette vérification, impossible de garantir que le "avant/après" sera visible.

Attendre ~1-2 min que Trivy rescanne l'image avant de continuer — vérifier avec
`kubectl get vulnerabilityreports -n dev` que les CVE CRITICAL/HIGH sont bien revenues.

**Important** : avant de relancer le remédiateur, vérifier qu'aucune PR `fix/ai-remediation`
n'est déjà ouverte (`gh pr list` ou l'onglet Pull requests sur GitHub) — sinon le script échoue
en tentant de recréer une branche déjà existante.

**Si `staging`/`prod` ont été synchronisés pendant une répétition** (test manuel ou via
l'interface Argo CD), les remettre en attente pour que la promotion en direct (§C.6) reste un
vrai moment "live" et pas un onglet déjà vert. Le contenu Git déjà promu n'est **pas** perdu —
seule la ressource déployée est supprimée :
```bash
kubectl delete deployment vulnerable-web -n staging --ignore-not-found
kubectl delete deployment vulnerable-web -n prod --ignore-not-found
```
Vérifier ensuite `kubectl get applications -n argocd` : `vulnerable-app-staging` et
`vulnerable-app-prod` doivent revenir à `OutOfSync`/`Missing`.

## C. Déroulé devant le jury (10 minutes)

*Prérequis : §A et §B déjà faits, cluster confirmé en état vulnérable.*

### 1. (1 min) Tout part de Git — l'architecture GitOps

Ouvrir GitHub et montrer la structure : `apps/`, `infra/`, `policies/`, `docs/`, `root-app.yaml`.

> **Phrase à dire** : *"Tout part de Git. Le dépôt est la source de vérité. Argo CD surveille
> les manifests et applique l'état déclaré dans le cluster."*

Puis montrer Argo CD (UI ou commande) :
```bash
kubectl get applications -n argocd
```
**Objectif visuel** : `root`, `namespaces`, `vulnerable-app-dev`, `trivy-operator`, `kyverno`,
`policies`, `kube-prometheus-stack`, `falco` — tous visibles et gérés par le pattern
App-of-Apps (`root-app.yaml` → `infra/argocd-apps/`).

### 2. (1 min) L'app vulnérable et sa détection

```bash
kubectl get pods -n dev
kubectl get vulnerabilityreports -n dev
kubectl get configauditreports -n dev
kubectl get policyreports -n dev
```
Montrer le nombre de CVE CRITICAL/HIGH sur `nginx:1.14` (27 CRITICAL / 50 HIGH dans nos tests),
et dans Grafana le graphique `sum(trivy_image_vulnerabilities{severity="Critical"})`.

> **Phrase à dire** : *"Notre workload de départ est volontairement vulnérable : image nginx
> ancienne, conteneur privilégié, exécution root et absence de limites de ressources."*

### 3. (1 min) Violation Kyverno + détection runtime Falco en direct

```bash
kubectl exec -it deploy/vulnerable-web -n dev -- sh -c "cat /etc/shadow"
kubectl logs -n falco -l app.kubernetes.io/name=falco --tail=30 | grep -i warning
```
La lecture doit **réussir** (le conteneur tourne encore en root à ce stade) et une alerte Falco
fraîche doit apparaître dans la foulée. Montrer aussi l'alerte dans la Falco UI
(http://localhost:2802) — moment très visuel.

> **Phrase à dire** : *"Trivy et Kyverno détectent les vulnérabilités et mauvaises
> configurations. Falco complète la chaîne avec de la détection runtime."*

### 4. (2 min) Lancer le remédiateur — la PR s'ouvre en direct

```bash
cd apps/remediator
source ../../.env
.venv/bin/python remediator.py
```
**Résultat attendu, dans l'ordre** : lecture des rapports Trivy/Kyverno → appel aux AI Endpoints
OVHcloud → génération d'un YAML corrigé → test dans un namespace de staging éphémère → création
d'une Pull Request GitHub, avec son URL affichée en dernière ligne. L'ouvrir dans le navigateur
devant le jury.

### 5. (2 min) Revue humaine — lire et merger la PR devant le jury

**Checklist à vérifier dans le diff, à voix haute :**
- [ ] image `nginx` mise à jour (plus l'ancienne version vulnérable)
- [ ] `privileged: true` supprimé
- [ ] utilisateur non-root (`runAsUser` ≠ 0, ou `runAsNonRoot: true`)
- [ ] `resources.requests`/`resources.limits` ajoutés
- [ ] volumes `emptyDir` présents si non-root (sinon le pod plantera au démarrage — incident
  réel rencontré, voir README §6)
- [ ] description de la PR lisible : explication de l'IA + résultat du test de staging éphémère

> **Phrase à dire** : *"L'IA ne modifie jamais directement le cluster ni la production. Elle
> propose un correctif dans GitHub. La revue humaine reste obligatoire."* Développer avec
> l'incident réel (README §6) si le temps le permet : un correctif a déjà cassé le démarrage de
> nginx, un autre a proposé un tag `:latest` que notre propre policy Kyverno interdit — deux
> preuves concrètes que ce garde-fou n'est pas cosmétique.

Merger la PR.

### 6. (2 min) Argo CD resynchronise, cluster corrigé

```bash
kubectl get pods -n dev -w
```
Montrer le nouveau pod démarrer, l'ancien être supprimé (`prune`).
```bash
kubectl get applications -n argocd
kubectl get policyreports -n dev
kubectl get vulnerabilityreports -n dev
```
**Objectif** : `vulnerable-app-dev` reste `Synced`/`Healthy`, `kubectl get policyreports -n dev`
montre 0 violation, et le scan Trivy suivant confirme la correction (objectif : CVE
CRITICAL/HIGH passées de plusieurs dizaines à **0/0**). Montrer aussi dans Grafana la courbe
`trivy_image_vulnerabilities{severity="Critical"}` chuter.

> **Phrase à dire** : *"Après merge, Argo CD détecte le nouveau commit et resynchronise
> automatiquement le cluster. La correction passe par Git, pas par une modification manuelle."*

Si le temps le permet, enchaîner sur la promotion manuelle en direct :
```bash
kubectl patch application vulnerable-app-staging -n argocd --type merge -p '{"operation":{"sync":{}}}'
```
(voir aussi `docs/commands-reference.md` §12 pour la procédure de promotion complète avec copie
du manifest vers `staging` puis `prod`).

### 7. (1 min) Conclusion

Tableau récapitulatif CNCF (voir `docs/rapport-architecture.md` — **le livrable officiel du
brief**, 1-2 pages), limites connues et pistes d'amélioration (voir §E). Si le jury relance sur
le SLA ou le risque de casser la prod, enchaîner directement sur `docs/architecture.md` §7 (test
de staging déjà implémenté + vision canary/Argo Rollouts) plutôt que d'improviser. La console de
monitoring (§A.3bis, http://localhost:4000) peut servir d'appui visuel si le jury demande une
preuve que l'IA n'agit que sur `dev`.

## D. Message de démo condensé (à tenir prêt si le fil se perd)

*"Nous partons d'un workload volontairement vulnérable dans `dev`. Trivy détecte les CVE,
Kyverno détecte les mauvaises pratiques Kubernetes, Falco détecte les comportements runtime
suspects. Notre remédiateur lit ces rapports, interroge l'IA OVHcloud, récupère un YAML
corrigé, teste ce correctif dans un namespace éphémère, puis ouvre une Pull Request. Un humain
relit et merge. Argo CD resynchronise ensuite le cluster depuis Git. L'IA ne touche jamais
directement `staging` ou `prod` : elle est confinée à `dev`, et la production reste protégée
par une promotion manuelle."*

## E. Limites connues et pistes d'amélioration (à mentionner en conclusion)

1. **Le remédiateur ne boucle que sur `reports[0]`** (un seul rapport) — en prod, il faudrait
   itérer sur tous les `VulnerabilityReport` et `ConfigAuditReport` du cluster.
2. **Déclenchement manuel** — la vraie automatisation serait un `CronJob` Kubernetes, déployé
   dans le namespace `ai-remediation` déjà réservé à cet effet (via
   `config.load_incluster_config()` + un `ServiceAccount` en lecture seule sur les CRD Trivy),
   qu'on a documenté mais pas eu le temps d'implémenter en 2 jours.
3. **Résolu depuis** : les deux premiers correctifs IA (non-root sans volume inscriptible, puis
   tag `nginx:latest` que notre policy Kyverno `disallow-latest-tag` signale) sont passés en PR
   sans validation préalable — la revue humaine les a rattrapés, mais ça a motivé l'ajout d'un
   **test de staging automatique dans le remédiateur** (déploiement réel dans un namespace
   éphémère + retentative informée par l'échec avant même d'ouvrir la PR, voir
   `docs/architecture.md` §7.1). Bon exemple pour le jury : les garde-fous se sont améliorés en
   cours de route grâce aux incidents réels rencontrés pendant le hackathon.
4. **Secrets en variables d'environnement** — à remplacer par un `Secret` Kubernetes +
   External Secrets Operator (brique optionnelle CNCF) en production.
5. **Résolu depuis** : garde anti-doublon de PR ajoutée directement dans `remediator.py`
   (`pr_already_open()`) — le script s'arrête proprement si une PR `fix/ai-remediation` est
   déjà ouverte, plutôt que d'échouer en tentant de recréer la branche.
6. **Promotion dev → staging → prod non automatisée** — les trois environnements existent
   (voir `docs/architecture.md` §7.3), mais la copie du manifest validé d'un environnement vers
   le suivant reste un geste manuel non outillé pour l'instant.
