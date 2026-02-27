import os
from dotenv import load_dotenv

load_dotenv()

# Fastino / GLiNER
FASTINO_API_KEY = os.getenv("FASTINO_API_KEY", "")
FASTINO_API_URL = os.getenv("FASTINO_API_URL", "https://api.fastino.ai/v1/extract")

# Senso
SENSO_API_KEY = os.getenv("SENSO_API_KEY", "")
SENSO_API_URL = os.getenv("SENSO_API_URL", "https://apiv2.senso.ai/api/v1/org/search")

# Neo4j
NEO4J_URI = os.getenv("NEO4J_URI", "bolt://localhost:7687")
NEO4J_USER = os.getenv("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD", "password")


# Mock policy store (fallback if Senso is unavailable)
MOCK_POLICIES = {
    "budget_limit": 100_000,
    "restricted_tickers": ["GME", "AMC", "BBBY"],
    "max_position_size": 1000,
    "allowed_actions": ["BUY", "SELL", "HOLD", "RESEARCH"],
}
