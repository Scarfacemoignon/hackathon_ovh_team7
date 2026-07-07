$ErrorActionPreference = "Stop"

$CurrentBranch = git branch --show-current

if ($CurrentBranch -eq "main") {
    Write-Error "ERREUR: cette validation doit être lancée sur une branche de feature, pas directement sur main."
}
Write-Host "=== Validation remediator / infra GitOps ==="

$RepoRoot = Resolve-Path "$PSScriptRoot\.."
Set-Location $RepoRoot

$EvidenceDir = Join-Path $RepoRoot "docs\evidence"
New-Item -ItemType Directory -Force $EvidenceDir | Out-Null

$EvidenceFile = Join-Path $EvidenceDir "remediator-infra-validation.txt"

"=== Remediator infra validation ===" | Set-Content -Encoding UTF8 $EvidenceFile
"Date: $(Get-Date)" | Add-Content $EvidenceFile
"Branch: $(git branch --show-current)" | Add-Content $EvidenceFile
"" | Add-Content $EvidenceFile

Write-Host "[1/8] Verification des secrets non suivis"

$GitStatus = git status --ignored -s
$GitStatus | Add-Content $EvidenceFile

$ForbiddenTracked = git ls-files | Select-String -Pattern "(\.env$|secrets/|ai-endpoints-key\.txt|equipe-.*\.yaml|kubeconfig|\.pem$|\.key$|\.crt$)"

if ($ForbiddenTracked) {
    Write-Error "ERREUR: des secrets semblent suivis par Git:`n$ForbiddenTracked"
}

Write-Host "[OK] Aucun secret suivi par Git"

Write-Host "[2/8] Verification des namespaces attendus"

$NamespaceFile = "infra\namespaces\namespaces.yaml"

if (!(Test-Path $NamespaceFile)) {
    Write-Error "ERREUR: fichier $NamespaceFile manquant"
}

$NamespaceContent = Get-Content $NamespaceFile -Raw

foreach ($ns in @("dev", "staging", "prod", "ai-remediation")) {
    if ($NamespaceContent -notmatch "name:\s*$ns") {
        Write-Error "ERREUR: namespace manquant dans $NamespaceFile : $ns"
    }
}

foreach ($app in @("infra\argocd-apps\vulnerable-app-staging.yaml", "infra\argocd-apps\vulnerable-app-prod.yaml")) {
    if (Test-Path $app) {
        $content = Get-Content $app -Raw
        if ($content -match "automated:") {
            Write-Error "ERREUR: $app ne doit pas avoir de sync automatique."
        }
    }
}
"[OK] Namespaces presents: dev, staging, prod, ai-remediation" | Add-Content $EvidenceFile
Write-Host "[OK] Namespaces presents"

Write-Host "[3/8] Dry-run Kubernetes des namespaces"

kubectl apply --dry-run=server -f infra\namespaces\namespaces.yaml | Tee-Object -Append $EvidenceFile

Write-Host "[4/8] Dry-run Kubernetes des Applications Argo CD critiques"

$ArgoApps = @(
    "infra\argocd-apps\namespaces.yaml",
    "infra\argocd-apps\vulnerable-app.yaml",
    "infra\argocd-apps\trivy-operator.yaml",
    "infra\argocd-apps\kyverno.yaml",
    "infra\argocd-apps\policies.yaml",
    "infra\argocd-apps\prometheus.yaml",
    "infra\argocd-apps\falco.yaml"
)

foreach ($app in $ArgoApps) {
    if (Test-Path $app) {
        Write-Host "Dry-run: $app"
        kubectl apply --dry-run=server -f $app | Tee-Object -Append $EvidenceFile
    }
    else {
        Write-Host "[WARN] Fichier absent, ignore: $app"
        "[WARN] Fichier absent, ignore: $app" | Add-Content $EvidenceFile
    }
}

Write-Host "[5/8] Verification du scope du remediator"

$EnvExample = "apps\remediator\.env.example"
$RemediatorPy = "apps\remediator\remediator.py"

if (Test-Path $EnvExample) {
    $EnvContent = Get-Content $EnvExample -Raw

    if ($EnvContent -notmatch "TARGET_NAMESPACE=dev") {
        Write-Error "ERREUR: .env.example doit cibler TARGET_NAMESPACE=dev"
    }

    if ($EnvContent -notmatch "MANIFEST_PATH=apps/vulnerable-app/dev/deployment.yaml") {
        Write-Error "ERREUR: .env.example doit cibler apps/vulnerable-app/dev/deployment.yaml"
    }

    "[OK] .env.example cible dev uniquement" | Add-Content $EvidenceFile
    Write-Host "[OK] .env.example cible dev uniquement"
}
else {
    Write-Host "[WARN] apps\remediator\.env.example absent"
    "[WARN] apps\remediator\.env.example absent" | Add-Content $EvidenceFile
}

if (Test-Path $RemediatorPy) {
    $RemediatorContent = Get-Content $RemediatorPy -Raw

    if ($RemediatorContent -match "apps/vulnerable-app/staging/deployment.yaml") {
        Write-Error "ERREUR: remediator.py référence staging directement"
    }

    if ($RemediatorContent -match "apps/vulnerable-app/prod/deployment.yaml") {
        Write-Error "ERREUR: remediator.py référence prod directement"
    }

    python -m py_compile $RemediatorPy

    "[OK] remediator.py compile et ne référence pas staging/prod directement" | Add-Content $EvidenceFile
    Write-Host "[OK] remediator.py compile et ne référence pas staging/prod directement"
}
else {
    Write-Host "[WARN] apps\remediator\remediator.py absent"
    "[WARN] apps\remediator\remediator.py absent" | Add-Content $EvidenceFile
}

Write-Host "[6/8] Verification des manifests vulnerable-app par environnement"

$EnvManifests = @(
    "apps\vulnerable-app\dev\deployment.yaml",
    "apps\vulnerable-app\staging\deployment.yaml",
    "apps\vulnerable-app\prod\deployment.yaml"
)

foreach ($manifest in $EnvManifests) {
    if (Test-Path $manifest) {
        Write-Host "Client dry-run: $manifest"
        kubectl apply --dry-run=client -f $manifest | Tee-Object -Append $EvidenceFile
    }
    else {
        Write-Host "[WARN] Fichier absent, ignore: $manifest"
        "[WARN] Fichier absent, ignore: $manifest" | Add-Content $EvidenceFile
    }
}

Write-Host "[7/8] VVerification que staging/prod ne sont pas modifiés par l’IA"

if (Test-Path "apps\vulnerable-app\staging\deployment.yaml") {
    $Staging = Get-Content "apps\vulnerable-app\staging\deployment.yaml" -Raw
    if ($Staging -match "ai-security-remediation|remediator|OVH_AI|Qwen") {
        Write-Error "ERREUR: staging contient des traces de remediator/IA"
    }
}

if (Test-Path "apps\vulnerable-app\prod\deployment.yaml") {
    $Prod = Get-Content "apps\vulnerable-app\prod\deployment.yaml" -Raw
    if ($Prod -match "ai-security-remediation|remediator|OVH_AI|Qwen") {
        Write-Error "ERREUR: prod contient des traces de remediator/IA"
    }
}

"[OK] staging/prod non couples au remediator IA" | Add-Content $EvidenceFile
Write-Host "[OK] staging/prod non couples au remediator IA"

Write-Host "[8/8] Resume cluster actuel"

kubectl get ns | Tee-Object -Append $EvidenceFile
kubectl get applications -n argocd | Tee-Object -Append $EvidenceFile

Write-Host ""
Write-Host "=== VALIDATION OK ==="
Write-Host "Preuve generee dans: $EvidenceFile"