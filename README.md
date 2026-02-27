# AgentWatch

**Observability & Governance PaaS for Autonomous AI Agents**

AgentWatch is a middleware platform designed to provide visibility and control over autonomous AI agents. It acts as a "Mission Control," collecting real-time telemetry from agents, running automated "Jury" evaluations, and providing a "Human-in-the-Loop" voting system to prevent hallucinations and loops.

## Target Audience

- **AI Engineers** — Debug complex agentic traces.
- **Operations Managers** — Monitor costs and success rates of automated workflows.
- **Compliance Officers** — Audit every action an agent took and why.

## Core Features

### 1. Real-Time Trace Collection (The Observer)

Ingest JSON-based "Step Updates" from agents — Thinking, Planning, Tool Use, and Observation — and visualize them as a vertical **Reasoning Tree** showing the hierarchy of agent thoughts.

### 2. The Agent Jury (Automated Evaluation)

For every step an agent takes, a secondary "Judge Agent" (e.g., GPT-4o-mini) votes on:

- **Hallucination Check** — Does the output match the tool data?
- **Safety Check** — Is the agent attempting a restricted action?

If the Jury votes **"Fail,"** the agent is automatically paused.

### 3. Human-in-the-Loop (The Voting UI)

A dashboard where high-stakes actions are queued as "Pending" for human review:

- **Approve** — Agent proceeds to the next step.
- **Reject** — Agent process is killed.
- **Feedback** — Human provides text guidance for the agent to retry.

### 4. The Circuit Breaker

If an agent repeats the same tool call with the same parameters **3 times in a row**, the system triggers an automatic **Loop Kill** to save token costs.

## UI Design

- **Global Health View** — Bird's-eye view of all running agents with status lights:
  - Green: Active
  - Yellow: Pending Vote
  - Red: Halted / Looping
- **NOC Dashboard** — Real-time graphs showing Token Spend vs. Task Completion.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | FastAPI or Node.js |
| Database | Supabase (PostgreSQL) |
| AI Layer | LangGraph + OpenAI / Anthropic APIs |
| Frontend | Next.js + Tailwind CSS + ShadcnUI |

## Success Metrics

| Metric | Description |
|--------|-------------|
| **Mean Time to Detection (MTTD)** | How fast we catch an agent loop |
| **Cost Saved** | Dollar amount of killed hallucinated runs |
| **Trust Score** | Ratio of Human Approvals to Agent Actions over time |

## The Pitch

> We don't just log data; we use a separate LLM to act as a "Police Officer" for the primary agent.

AgentWatch isn't another logging tool — it's an **Agent Jury** system. The value innovation is using a secondary model to evaluate every step of the primary agent in real time, combining automated governance with human oversight to build **trust** and **reliability** into agentic workflows.
