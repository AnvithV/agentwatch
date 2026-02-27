import os
from dotenv import load_dotenv

load_dotenv()

# Fastino / GLiNER
FASTINO_API_KEY = os.getenv("FASTINO_API_KEY", "")
FASTINO_API_URL = os.getenv("FASTINO_API_URL", "https://api.pioneer.ai/gliner-2")

# Senso
SENSO_API_KEY = os.getenv("SENSO_API_KEY", "")
SENSO_API_URL = os.getenv("SENSO_API_URL", "https://apiv2.senso.ai/api/v1/org/search")

# Modulate (SDK-based - may need fallback)
MODULATE_API_KEY = os.getenv("MODULATE_API_KEY", "")
MODULATE_API_URL = os.getenv("MODULATE_API_URL", "")

# Neo4j
NEO4J_URI = os.getenv("NEO4J_URI", "bolt://localhost:7687")
NEO4J_USER = os.getenv("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD", "")

# Anthropic
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
