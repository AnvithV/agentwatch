# AgentWatch

**Autonomous Governance PaaS for AI Agents**

AgentWatch is a PaaS middleware that acts as "Mission Control" for autonomous AI agents. It intercepts agent actions in real-time, evaluates them against business policies, and autonomously halts dangerous or costly operations — no human intervention required.

## Problem

Autonomous agents in production lack safety guardrails:

- **Token Drainage** — Infinite loops burning thousands of dollars
- **Policy Violations** — Unauthorized actions (e.g., spending over budget)
- **Hallucinations** — Operating on false information, causing brand damage

## Architecture

```
Agent SDK                AgentWatch                    Sponsor APIs
   |                         |                              |
   |--- Telemetry Event ---->|                              |
   |                         |--- raw_log -----> Fastino GLiNER (entity extraction)
   |                         |<-- {price, ticker, action} --|
   |                         |                              |
   |                         |--- entities ----> Senso (policy check)
   |                         |<-- compliant? ---------------|
   |                         |                              |
   |                         |--- thought -----> Modulate (safety check)
   |                         |<-- safe? --------------------|
   |                         |                              |
   |                         |--- step --------> Neo4j (loop detection + audit)
   |                         |<-- loop? --------------------|
   |                         |                              |
   |<-- HALT / PROCEED ------|                              |
```

## Core Features

### 1. Real-Time Telemetry Ingestion

Accepts JSON telemetry events from any agent SDK:

```json
{
  "agent_id": "agent-001",
  "step_id": "uuid",
  "timestamp": "2026-02-27T11:45:00Z",
  "thought": "I should look up the latest revenue figures for AAPL",
  "tool_used": "tavily_search",
  "input_parameters": {"query": "AAPL Q4 2025 revenue"},
  "observation": "Apple reported $94.9B in Q4 2025 revenue...",
  "raw_log": "Agent decided to BUY 500 shares of AAPL at $242.50, total cost $121,250"
}
```

### 2. In-Flight Governance Pipeline

Every agent action passes through an autonomous decision pipeline:

1. **Fastino GLiNER** — Extracts structured entities (price, ticker, action) from raw logs
2. **Senso Policy Check** — Compares entities against live business policies (budget limits, restricted tickers)
3. **Modulate Safety Check** — Analyzes agent output for manipulative or unsafe language
4. **Circuit Breaker** — Neo4j detects if the agent is repeating the same action 3+ times (loop kill)

Pipeline is **fail-closed**: if any check errors out, the default decision is HALT.

### 3. Neo4j Reasoning Trace Auditing

Every reasoning step is stored as a graph node in Neo4j, enabling:
- Full reasoning chain visualization
- Loop detection via Cypher queries
- Audit trail of every decision and why it was made

### 4. Governance Decision Output

```json
{
  "agent_id": "agent-001",
  "step_id": "uuid",
  "decision": "HALT",
  "reason": "POLICY_VIOLATION",
  "details": "Extracted cost $121,250 exceeds budget limit $100,000",
  "triggered_by": "senso_policy_check",
  "timestamp": "2026-02-27T11:45:01Z"
}
```

## Sponsor Integrations

| Sponsor | Role | Integration |
|---------|------|-------------|
| **Fastino (GLiNER)** | Entity extraction | Parses raw agent logs into structured JSON (price, ticker, action) |
| **Senso.ai** | Policy enforcement | Checks extracted entities against live business rules |
| **Neo4j** | Reasoning graph + loop detection | Stores agent steps as graph nodes; Cypher queries detect loops |
| **Modulate** | Safety compliance | Analyzes agent text output for manipulative/unsafe language |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | FastAPI (async, low-latency) |
| Database | Neo4j (reasoning graphs) + PostgreSQL (policy storage) |
| AI Layer | Anthropic Claude (Judge Agent) + Fastino GLiNER (extraction) |
| Demo Agent | Python + httpx |

## Project Structure

```
agentwatch/
├── main.py              # FastAPI app + endpoints
├── governance.py         # Governance pipeline (Fastino, Senso, Modulate)
├── neo4j_driver.py       # Neo4j operations + loop detection
├── demo_agent.py         # Simulated agent for demo scenarios
├── models.py             # Shared Pydantic models
├── config.py             # API keys, Neo4j creds, env vars
├── requirements.txt
├── .env.example
└── README.md
```

## Quick Start

```bash
# Clone and setup
git clone https://github.com/AnvithV/agentwatch.git
cd agentwatch
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Configure (copy and fill in API keys)
cp .env.example .env

# Start the server
uvicorn main:app --reload

# In another terminal, run the demo
python3 demo_agent.py
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Health check |
| `POST` | `/api/v1/telemetry` | Submit agent telemetry for governance evaluation |
| `GET` | `/api/v1/agent/{agent_id}/graph` | Get reasoning graph for an agent |

## Demo Scenarios

The demo agent (`demo_agent.py`) runs 4 scenarios:

1. **Happy Path** — Agent researches stocks, stays within policy → PROCEED
2. **Policy Violation** — Agent tries to buy $121,250 of AAPL (budget is $100,000) → HALT
3. **Loop Detection** — Agent searches for TSLA price 3 times in a row → HALT
4. **Safety Violation** — Agent generates manipulative investment advice → HALT

## Success Metrics

| Metric | Description |
|--------|-------------|
| **Mean Time to Detection (MTTD)** | How fast we catch an agent loop |
| **Cost Saved** | Dollar amount of killed hallucinated runs |
| **Trust Score** | Ratio of Human Approvals to Agent Actions over time |

## The Pitch

> We don't just log agent data — we use a separate governance pipeline to act as an autonomous "Police Officer" for the primary agent, halting dangerous actions before they execute.

AgentWatch is **not** another observability dashboard. It's an **autonomous governance layer** that intercepts, evaluates, and controls agent behavior in real-time using sponsor APIs (Fastino, Senso, Neo4j, Modulate) — turning unreliable agents into trustworthy production systems.
