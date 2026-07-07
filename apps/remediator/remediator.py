"""
Remédiateur IA — Hackathon OVHcloud x Ynov (équipe 7)
Boucle : rapports Trivy -> analyse IA (AI Endpoints OVHcloud) -> validation en
staging ephemere -> Pull Request GitHub (avec, le cas echeant, retentative
informee par l'echec de staging).
"""
import json
import os
import re
import subprocess
import time
import uuid

import yaml
from github import Github
from kubernetes import client, config
from openai import OpenAI

# Cible configurable via l'environnement (voir .env.example) : par contrat, le remediateur
# ne doit jamais agir en dehors de 'dev' -- staging/prod ne se promeuvent qu'a la main.
TARGET_NAMESPACE = os.environ.get("TARGET_NAMESPACE", "dev")
MANIFEST_PATH = os.environ.get("MANIFEST_PATH", f"apps/vulnerable-app/{TARGET_NAMESPACE}/deployment.yaml")
FORBIDDEN_NAMESPACES = {"staging", "prod"}

REMEDIATION_BRANCH = "fix/ai-remediation"
MAX_ATTEMPTS = 2          # 1 essai + 1 retentative informee par l'echec de staging
STAGING_TIMEOUT_S = 60    # temps laisse au pod de test pour devenir Ready
STAGING_FAILURE_REASONS = {
    "CrashLoopBackOff", "Error", "ImagePullBackOff",
    "ErrImagePull", "CreateContainerConfigError",
}

SYSTEM_PROMPT = """Tu es un expert en securite Kubernetes.
On te donne : (1) un resume de vulnerabilites detectees par Trivy,
(2) le manifest YAML actuel du workload concerne, et parfois (3) le rapport
d'echec d'une precedente tentative de correction testee en staging.
Ta mission :
- Proposer le manifest YAML CORRIGE : mets a jour l'image vers une version
  recente corrigeant les CVE, supprime privileged, fais tourner le conteneur
  en utilisateur non-root, ajoute des requests/limits CPU et memoire raisonnables.
- Si tu bascules le conteneur en utilisateur non-root, prevois aussi les volumes
  emptyDir necessaires (ex: /var/cache/nginx et /var/run pour une image nginx)
  afin d'eviter toute erreur de permission au demarrage.
- N'utilise JAMAIS le tag ":latest" ni une image sans tag : choisis toujours une
  version explicite et figee (ex: "nginx:1.30.3-alpine"). Le tag ":latest" est
  interdit par notre policy Kyverno "disallow-latest-tag" et n'est pas reproductible.
- Si un rapport d'echec de staging est fourni, corrige precisement la cause
  indiquee (ne repete pas la meme erreur).
- Le YAML doit rester un Deployment valide et minimal (memes noms, memes labels).
Reponds STRICTEMENT dans ce format :
EXPLICATION:
<3 a 6 lignes en francais expliquant chaque correction>
YAML:
```yaml
<le manifest complet corrige>
```"""


# ----------- 1. Lire les rapports Trivy dans le cluster -----------

def get_vulnerability_reports(namespace: str = TARGET_NAMESPACE) -> list[dict]:
    """Récupère les VulnerabilityReports (CRD de trivy-operator)."""
    config.load_kube_config()  # utilise ~/.kube/config
    api = client.CustomObjectsApi()
    reports = api.list_namespaced_custom_object(
        group="aquasecurity.github.io",
        version="v1alpha1",
        namespace=namespace,
        plural="vulnerabilityreports",
    )
    return reports["items"]


def summarize_report(report: dict, max_cves: int = 15) -> str:
    """Résume un rapport en texte compact pour le prompt (on ne garde que l'essentiel)."""
    vulns = report["report"]["vulnerabilities"]
    order = {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3}
    vulns.sort(key=lambda v: order.get(v["severity"], 9))
    lines = [
        f"Workload: {report['metadata']['labels'].get('trivy-operator.resource.name', '?')}",
        f"Image scannee: {report['report']['artifact']['repository']}:"
        f"{report['report']['artifact'].get('tag', '?')}",
        f"Total: {len(vulns)} vulnerabilites.",
        "Principales CVE (severite, paquet, version installee -> version corrigee):",
    ]
    for v in vulns[:max_cves]:
        lines.append(
            f"- {v['vulnerabilityID']} [{v['severity']}] {v['resource']} "
            f"{v.get('installedVersion', '?')} -> fix: {v.get('fixedVersion', 'n/a')}"
        )
    return "\n".join(lines)


# ----------- 2. Lire le manifest actuel depuis GitHub -----------

def get_manifest_from_github(gh_repo) -> tuple[str, str]:
    f = gh_repo.get_contents(MANIFEST_PATH, ref="main")
    return f.decoded_content.decode(), f.sha


# ----------- 3. Demander le correctif à l'IA -----------

def ask_ai_for_fix(ai: OpenAI, report_summary: str, current_manifest: str,
                    previous_failure: str = "") -> tuple[str, str]:
    user_content = f"RAPPORT TRIVY:\n{report_summary}\n\nMANIFEST ACTUEL:\n{current_manifest}"
    if previous_failure:
        user_content += (
            "\n\nECHEC DE LA TENTATIVE PRECEDENTE EN STAGING (a corriger absolument) :\n"
            f"{previous_failure}"
        )
    resp = ai.chat.completions.create(
        model=os.environ["OVH_AI_MODEL"],
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ],
        temperature=0.2,  # peu de creativite : on veut du YAML fiable
        max_tokens=2000,
    )
    text = resp.choices[0].message.content
    explanation = text.split("EXPLICATION:")[1].split("YAML:")[0].strip()
    match = re.search(r"```yaml\n(.*?)```", text, re.DOTALL)
    if not match:
        raise ValueError(f"L'IA n'a pas renvoye de bloc YAML :\n{text}")
    fixed_yaml = match.group(1).strip() + "\n"
    yaml.safe_load(fixed_yaml)  # garde-fou : le YAML doit au moins etre parsable
    return explanation, fixed_yaml


# ----------- 3bis. Refuser le tag :latest (verification statique, avant le staging) -----------

def check_no_latest_tag(fixed_yaml: str) -> tuple[bool, str]:
    """Refuse tout tag ':latest' ou image sans tag : ca viole notre policy Kyverno
    'disallow-latest-tag' et ce n'est pas reproductible. Verification statique et
    gratuite, faite avant le test de staging (qui, lui, ne detecterait pas ce
    probleme puisque le pod demarre tres bien avec :latest)."""
    manifest = yaml.safe_load(fixed_yaml)
    for c in manifest["spec"]["template"]["spec"]["containers"]:
        image = c.get("image", "")
        if ":" not in image or image.rsplit(":", 1)[1] == "latest":
            return False, (
                f"Image '{image}' refusee : le tag ':latest' (ou l'absence de tag, "
                f"equivalente) est interdit par la policy Kyverno 'disallow-latest-tag'. "
                f"Utilise une version explicite et figee (ex: nginx:1.30.3-alpine)."
            )
    return True, ""


# ----------- 3ter. Valider le correctif dans un namespace de staging ephemere -----------

def validate_in_staging(fixed_yaml: str, timeout_s: int = STAGING_TIMEOUT_S) -> tuple[bool, str]:
    """Deploie le manifest corrige dans un namespace jetable, isole du namespace TARGET_NAMESPACE
    (dev en temps normal), AVANT meme d'ouvrir la PR. Rend un verdict + les logs du pod de test,
    pour que la revue humaine sache exactement quoi verifier. Nettoie toujours derriere lui."""
    manifest = yaml.safe_load(fixed_yaml)
    ns = f"remediator-staging-{uuid.uuid4().hex[:8]}"
    manifest["metadata"]["namespace"] = ns

    subprocess.run(["kubectl", "create", "namespace", ns], check=True, capture_output=True)
    try:
        subprocess.run(
            ["kubectl", "apply", "-f", "-"],
            input=yaml.dump(manifest), text=True, check=True, capture_output=True,
        )

        deadline = time.time() + timeout_s
        outcome, pod_name = "TIMEOUT : le pod n'est jamais devenu Ready.", None
        while time.time() < deadline:
            out = subprocess.run(
                ["kubectl", "get", "pods", "-n", ns, "-o", "json"],
                check=True, capture_output=True, text=True,
            )
            pods = json.loads(out.stdout)["items"]
            if pods:
                pod = pods[0]
                pod_name = pod["metadata"]["name"]
                conditions = {c["type"]: c["status"] for c in pod["status"].get("conditions", [])}
                waiting_reasons = [
                    cs["state"]["waiting"]["reason"]
                    for cs in pod["status"].get("containerStatuses", [])
                    if "waiting" in cs.get("state", {})
                ]
                bad = [r for r in waiting_reasons if r in STAGING_FAILURE_REASONS]
                if bad:
                    outcome = f"ECHEC : conteneur en {bad[0]}."
                    break
                if conditions.get("Ready") == "True":
                    outcome = "OK : le pod est demarre et Ready."
                    break
            time.sleep(3)

        logs = "(pas de logs disponibles)"
        if pod_name:
            logs_res = subprocess.run(
                ["kubectl", "logs", pod_name, "-n", ns, "--tail=15"],
                capture_output=True, text=True,
            )
            logs = (logs_res.stdout or logs_res.stderr or logs).strip()

        success = outcome.startswith("OK")
        report = f"{outcome}\n\nDerniers logs du pod de test (namespace `{ns}`) :\n```\n{logs}\n```"
        return success, report
    finally:
        subprocess.run(["kubectl", "delete", "namespace", ns, "--wait=false"], capture_output=True)


# ----------- 4. Obtenir un correctif valide (avec 1 retentative informee si besoin) -----------

def get_validated_fix(ai: OpenAI, summary: str, manifest: str):
    previous_failure = ""
    explanation = fixed_yaml = staging_report = ""
    staging_ok = False
    for attempt in range(1, MAX_ATTEMPTS + 1):
        print(f"\n=== Appel a l'IA (tentative {attempt}/{MAX_ATTEMPTS})... ===")
        explanation, fixed_yaml = ask_ai_for_fix(ai, summary, manifest, previous_failure)
        print("\n=== Explication de l'IA ===\n" + explanation)

        tag_ok, tag_report = check_no_latest_tag(fixed_yaml)
        if not tag_ok:
            print(f"\n=== Verification du tag d'image... ===\nECHEC : {tag_report}")
            staging_ok, staging_report = False, tag_report
            previous_failure = tag_report
            continue  # inutile de deployer en staging, ':latest' demarre tres bien -- ce n'est pas la ce qu'on teste ici

        print(f"\n=== Test en staging (namespace ephemere, isole de '{TARGET_NAMESPACE}')... ===")
        staging_ok, staging_report = validate_in_staging(fixed_yaml)
        print(staging_report)

        if staging_ok:
            break
        previous_failure = staging_report
    return explanation, fixed_yaml, staging_ok, staging_report


# ----------- 5 & 6. Brancher, committer, ouvrir la PR -----------

def pr_already_open(gh_repo) -> str | None:
    """Retourne l'URL d'une PR deja ouverte sur la branche de remediation, sinon None."""
    owner = gh_repo.owner.login
    existing = gh_repo.get_pulls(state="open", head=f"{owner}:{REMEDIATION_BRANCH}")
    return existing[0].html_url if existing.totalCount > 0 else None


def open_pull_request(gh_repo, file_sha: str, fixed_yaml: str, explanation: str,
                       report_summary: str, staging_ok: bool, staging_report: str) -> str:
    branch = REMEDIATION_BRANCH
    main = gh_repo.get_branch("main")
    try:
        gh_repo.get_git_ref(f"heads/{branch}").delete()
    except Exception:
        pass
    gh_repo.create_git_ref(ref=f"refs/heads/{branch}", sha=main.commit.sha)

    gh_repo.update_file(
        path=MANIFEST_PATH,
        message="fix(security): remediation automatique proposee par l'IA",
        content=fixed_yaml,
        sha=file_sha,
        branch=branch,
    )

    staging_badge = "✅ Test de staging reussi" if staging_ok else "⚠️ TEST DE STAGING ECHOUE — a examiner avant de merger"
    title_prefix = "[IA]" if staging_ok else "[IA][STAGING ECHOUE]"
    pr = gh_repo.create_pull(
        title=f"{title_prefix} Remediation automatique des vulnerabilites detectees",
        body=(f"## Correctif propose par l'IA\n\n{explanation}\n\n"
              f"## {staging_badge}\n{staging_report}\n\n"
              f"## Rapport Trivy ayant declenche l'analyse\n```\n{report_summary}\n```\n\n"
              f"*PR generee automatiquement — relecture humaine requise avant merge.*"),
        head=branch,
        base="main",
    )
    return pr.html_url


# ----------- Orchestration -----------

def main():
    if TARGET_NAMESPACE in FORBIDDEN_NAMESPACES:
        print(f"REFUS : TARGET_NAMESPACE='{TARGET_NAMESPACE}' est un environnement a promotion "
              f"manuelle uniquement (staging/prod). Le remediateur ne doit agir que sur 'dev'.")
        return

    ai = OpenAI(base_url=os.environ["OVH_AI_BASE_URL"],
                api_key=os.environ["OVH_AI_TOKEN"])
    gh_repo = Github(os.environ["GITHUB_TOKEN"]).get_repo(os.environ["GITHUB_REPO"])

    existing_url = pr_already_open(gh_repo)
    if existing_url:
        print(f"Une PR est deja ouverte sur la branche {REMEDIATION_BRANCH} : {existing_url}")
        print("Merge-la ou ferme-la avant de relancer le remediateur.")
        return

    reports = get_vulnerability_reports(TARGET_NAMESPACE)
    if not reports:
        print(f"Aucun VulnerabilityReport dans le namespace {TARGET_NAMESPACE}. Trivy a-t-il fini de scanner ?")
        return

    summary = summarize_report(reports[0])
    print("=== Rapport resume ===\n" + summary)

    manifest, sha = get_manifest_from_github(gh_repo)
    explanation, fixed_yaml, staging_ok, staging_report = get_validated_fix(ai, summary, manifest)

    url = open_pull_request(gh_repo, sha, fixed_yaml, explanation, summary, staging_ok, staging_report)
    print(f"\n✅ Pull Request ouverte : {url}")
    if not staging_ok:
        print("⚠️  Le test de staging a echoue apres toutes les tentatives — la PR le signale clairement.")


if __name__ == "__main__":
    main()
