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

# AgentWatch Server
AGENTWATCH_HOST = os.getenv("AGENTWATCH_HOST", "http://localhost:8000")

# Tavily Search
TAVILY_API_KEY = os.getenv("TAVILY_API_KEY", "")

# Mock policy store (fallback if Senso is unavailable)
MOCK_POLICIES = {
    "budget_limit": 100_000,
    "restricted_tickers": ["GME", "AMC", "BBBY"],
    "max_position_size": 1000,
    "allowed_actions": ["BUY", "SELL", "HOLD", "RESEARCH"],
}
