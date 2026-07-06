"""
Test de connexion aux AI Endpoints OVHcloud.
Variables d'environnement requises : OVH_AI_TOKEN, OVH_AI_BASE_URL, OVH_AI_MODEL
"""
import os
from openai import OpenAI

client = OpenAI(
    base_url=os.environ["OVH_AI_BASE_URL"],
    api_key=os.environ["OVH_AI_TOKEN"],
)

resp = client.chat.completions.create(
    model=os.environ["OVH_AI_MODEL"],
    messages=[{"role": "user", "content": "Bonjour, réponds en un mot : ça marche ?"}],
)
print(resp.choices[0].message.content)
