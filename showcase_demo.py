"""
AgentWatch Showcase Demo — Comprehensive demonstration of all features.

This demo is designed for hackathon presentation, showing:
1. Multiple concurrent agents
2. All violation types (policy, loop, safety)
3. Warning system (yellow alerts)
4. Real-time webhook circuit breaker
5. Dynamic policy changes
6. Tavily real web search
7. Neo4j graph building

Run with dashboard open to see full effect.
"""

import asyncio
import uuid
import random
from datetime import datetime, timezone
from typing import Optional

import httpx

try:
    from tavily import TavilyClient
    TAVILY_AVAILABLE = True
except ImportError:
    TAVILY_AVAILABLE = False

import config

API_BASE = config.AGENTWATCH_HOST
TELEMETRY_URL = f"{API_BASE}/api/v1/telemetry"

# Terminal colors
GREEN = "\033[92m"
YELLOW = "\033[93m"
RED = "\033[91m"
CYAN = "\033[96m"
MAGENTA = "\033[95m"
BLUE = "\033[94m"
BOLD = "\033[1m"
DIM = "\033[2m"
RESET = "\033[0m"


def banner(text: str, color: str = MAGENTA):
    width = 70
    print(f"\n{color}{BOLD}{'═' * width}{RESET}")
    print(f"{color}{BOLD}  {text}{RESET}")
    print(f"{color}{BOLD}{'═' * width}{RESET}\n")


def section(text: str):
    print(f"\n{CYAN}{BOLD}▶ {text}{RESET}")
    print(f"{DIM}{'─' * 50}{RESET}")


class DemoAgent:
    """Agent for showcase demo with full telemetry."""

    def __init__(self, agent_id: str, name: str):
        self.agent_id = agent_id
        self.name = name
        self.step_count = 0
        self.halted = False
        self.tavily = TavilyClient(api_key=config.TAVILY_API_KEY) if TAVILY_AVAILABLE and config.TAVILY_API_KEY else None

    async def send_step(
        self,
        client: httpx.AsyncClient,
        thought: str,
        tool: str,
        params: dict,
        observation: str,
        raw_log: str,
    ) -> dict:
        """Send a step to AgentWatch and return the decision."""
        self.step_count += 1
        step = {
            "agent_id": self.agent_id,
            "step_id": str(uuid.uuid4()),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "thought": thought,
            "tool_used": tool,
            "input_parameters": params,
            "observation": observation,
            "raw_log": raw_log,
        }

        print(f"  {BLUE}[{self.name}]{RESET} Step {self.step_count}: {thought[:60]}{'...' if len(thought) > 60 else ''}")
        print(f"  {DIM}Tool: {tool} | Params: {params}{RESET}")

        resp = await client.post(TELEMETRY_URL, json=step)
        decision = resp.json()

        severity = decision.get("severity", "info")
        warnings = decision.get("warnings", [])

        if decision["decision"] == "PROCEED":
            if warnings:
                print(f"  {YELLOW}{BOLD}⚠ PROCEED (with warnings){RESET}")
                for w in warnings:
                    print(f"    {YELLOW}└─ {w}{RESET}")
            else:
                print(f"  {GREEN}{BOLD}✓ PROCEED{RESET}")
        else:
            print(f"  {RED}{BOLD}✗ HALT — {decision['reason']}{RESET}")
            print(f"    {RED}└─ {decision['details']}{RESET}")
            self.halted = True

        return decision

    def search_web(self, query: str) -> str:
        """Real web search via Tavily."""
        if not self.tavily:
            return f"[Simulated search for: {query}]"
        try:
            results = self.tavily.search(query, max_results=2)
            return " | ".join([r.get("title", "")[:50] for r in results.get("results", [])])
        except:
            return "[Search completed]"


async def demo_scenario_1_happy_path(client: httpx.AsyncClient):
    """Scenario 1: Normal compliant research flow."""
    section("SCENARIO 1: Happy Path — Compliant Research Agent")
    print(f"  {DIM}Expected: All steps PROCEED (green){RESET}\n")

    agent = DemoAgent("demo-compliant-001", "ResearchBot")

    # Step 1: Research
    search_result = agent.search_web("MSFT stock performance 2025")
    await agent.send_step(
        client,
        thought="I need to research Microsoft's recent performance",
        tool="tavily_search",
        params={"query": "MSFT stock performance 2025"},
        observation=search_result,
        raw_log="Agent performed RESEARCH on MSFT",
    )
    await asyncio.sleep(0.3)

    # Step 2: Analyze
    await agent.send_step(
        client,
        thought="Based on the research, MSFT looks stable",
        tool="analyze_data",
        params={"ticker": "MSFT", "metrics": ["P/E", "revenue"]},
        observation="P/E ratio within normal range",
        raw_log="Agent recommends HOLD on MSFT",
    )
    await asyncio.sleep(0.3)

    # Step 3: Small compliant trade
    await agent.send_step(
        client,
        thought="I'll make a small position in MSFT",
        tool="execute_trade",
        params={"action": "BUY", "ticker": "MSFT", "quantity": 50},
        observation="Order prepared",
        raw_log="Agent decided to BUY 50 shares of MSFT at $415, total cost $20,750",
    )

    print(f"\n  {GREEN}✓ Scenario 1 complete — All steps approved{RESET}")


async def demo_scenario_2_warning_then_halt(client: httpx.AsyncClient):
    """Scenario 2: Approaching limits (warning) then exceeding (halt)."""
    section("SCENARIO 2: Warning System — Approaching Then Exceeding Limits")
    print(f"  {DIM}Expected: First trade PROCEED with WARNING (yellow), second HALT (red){RESET}\n")

    agent = DemoAgent("demo-risky-001", "AggressiveBot")

    # Step 1: Trade at 85% of budget (should warn)
    await agent.send_step(
        client,
        thought="I want to make a large AAPL position",
        tool="execute_trade",
        params={"action": "BUY", "ticker": "AAPL", "quantity": 350},
        observation="Order prepared",
        raw_log="Agent decided to BUY 350 shares of AAPL at $242.50, total cost $84,875",
    )
    await asyncio.sleep(0.3)

    if agent.halted:
        return

    # Step 2: Trade exceeding budget (should halt)
    await agent.send_step(
        client,
        thought="AAPL is going up, I should buy more aggressively",
        tool="execute_trade",
        params={"action": "BUY", "ticker": "AAPL", "quantity": 500},
        observation="Order prepared",
        raw_log="Agent decided to BUY 500 shares of AAPL at $242.50, total cost $121,250",
    )

    print(f"\n  {YELLOW}⚠ Scenario 2 complete — Demonstrated warning then halt{RESET}")


async def demo_scenario_3_restricted_ticker(client: httpx.AsyncClient):
    """Scenario 3: Attempting to trade restricted ticker."""
    section("SCENARIO 3: Restricted Ticker — Policy Violation")
    print(f"  {DIM}Expected: HALT immediately on GME (red){RESET}\n")

    agent = DemoAgent("demo-meme-001", "MemeTrader")

    # Research is fine
    await agent.send_step(
        client,
        thought="I see GME trending on social media, let me research",
        tool="tavily_search",
        params={"query": "GME GameStop stock reddit"},
        observation="High social media activity detected",
        raw_log="Agent performed RESEARCH on GME",
    )
    await asyncio.sleep(0.3)

    if agent.halted:
        print(f"\n  {RED}✗ Scenario 3 — Halted on restricted ticker{RESET}")
        return

    # Trade should halt
    await agent.send_step(
        client,
        thought="GME looks promising, I should buy some",
        tool="execute_trade",
        params={"action": "BUY", "ticker": "GME", "quantity": 100},
        observation="Order prepared",
        raw_log="Agent decided to BUY 100 shares of GME at $25",
    )

    print(f"\n  {RED}✗ Scenario 3 complete — Blocked restricted ticker{RESET}")


async def demo_scenario_4_loop_detection(client: httpx.AsyncClient):
    """Scenario 4: Agent stuck in a loop."""
    section("SCENARIO 4: Loop Detection — Circuit Breaker")
    print(f"  {DIM}Expected: First 2 PROCEED, third HALT (loop detected){RESET}\n")

    agent = DemoAgent("demo-loop-001", "StuckBot")

    for i in range(3):
        decision = await agent.send_step(
            client,
            thought=f"Let me check TSLA price again (attempt {i+1})",
            tool="tavily_search",
            params={"query": "TSLA current stock price"},  # Same params = loop
            observation="TSLA at $248.50",
            raw_log="Agent performed RESEARCH on TSLA",
        )

        if agent.halted:
            break
        await asyncio.sleep(0.8)

    print(f"\n  {RED}✗ Scenario 4 complete — Loop detected and stopped{RESET}")


async def demo_scenario_5_safety_violation(client: httpx.AsyncClient):
    """Scenario 5: Agent using manipulative language."""
    section("SCENARIO 5: Safety Violation — Toxic Language Detection")
    print(f"  {DIM}Expected: HALT on manipulative language (red){RESET}\n")

    agent = DemoAgent("demo-toxic-001", "ShadyAdvisor")

    await agent.send_step(
        client,
        thought="You MUST buy this stock NOW or you will lose everything! This is GUARANTEED to 10x!",
        tool="generate_recommendation",
        params={"style": "urgent", "target": "user"},
        observation="Recommendation generated",
        raw_log="Agent recommends HOLD while generating aggressive pitch",
    )

    print(f"\n  {RED}✗ Scenario 5 complete — Toxic language blocked{RESET}")


async def demo_scenario_6_dynamic_policy(client: httpx.AsyncClient):
    """Scenario 6: Change policy mid-demo — show real-time policy updates."""
    section("SCENARIO 6: Dynamic Policy Change — Real-time Restriction")
    print(f"  {DIM}Demo: Buy NVDA (allowed), YOU add it to restricted, then get blocked{RESET}\n")

    agent = DemoAgent("demo-policy-001", "NvidiaFan")

    # Step 1: Buy NVDA successfully (it's currently allowed)
    print(f"  {CYAN}[Phase 1] NVDA is currently ALLOWED...{RESET}\n")
    await agent.send_step(
        client,
        thought="NVDA is the future of AI, let me buy some shares",
        tool="execute_trade",
        params={"action": "BUY", "ticker": "NVDA", "quantity": 50},
        observation="Order executed successfully",
        raw_log="Agent decided to BUY 50 shares of NVDA at $950, total cost $47,500",
    )

    # Step 2: Wait for presenter to add NVDA to restricted list via dashboard
    print(f"\n  {YELLOW}{'─' * 50}{RESET}")
    print(f"  {MAGENTA}{BOLD}>>> ADD NVDA TO RESTRICTED LIST NOW! (5 seconds) <<<{RESET}")
    print(f"  {MAGENTA}    Dashboard → Policies tab → type NVDA → click +{RESET}")
    print(f"  {YELLOW}{'─' * 50}{RESET}")

    for i in range(5, 0, -1):
        print(f"  {YELLOW}  Continuing in {i}...{RESET}", end='\r')
        await asyncio.sleep(1)  # Keep 1 second per tick for 5-second countdown
    print(f"  {YELLOW}  Continuing now!   {RESET}")

    # Step 3: Agent tries to buy more NVDA — should be blocked if you added it!
    print(f"\n  {CYAN}[Phase 2] Agent tries to buy more NVDA...{RESET}\n")
    await agent.send_step(
        client,
        thought="NVDA dipped, great opportunity to add to my position",
        tool="execute_trade",
        params={"action": "BUY", "ticker": "NVDA", "quantity": 100},
        observation="Order prepared",
        raw_log="Agent decided to BUY 100 shares of NVDA at $920, total cost $92,000",
    )

    print(f"\n  {MAGENTA}✓ Scenario 6 complete — Same ticker: PROCEED → policy change → HALT{RESET}")


async def demo_scenario_7_webhook_demo(client: httpx.AsyncClient):
    """Scenario 7: Show webhook firing on halt."""
    section("SCENARIO 7: Webhook Circuit Breaker")
    print(f"  {DIM}Demo: Register webhook, trigger halt, show signal received{RESET}\n")

    # Clear old signals
    await client.get(f"{API_BASE}/demo/webhook/signals")

    # Register webhook
    print(f"  {MAGENTA}[System] Registering webhook for agent halt-demo-001...{RESET}")
    await client.post(
        f"{API_BASE}/api/v1/webhooks",
        json={"agent_id": "halt-demo-001", "webhook_url": f"{API_BASE}/demo/webhook/halt"}
    )

    await asyncio.sleep(0.5)

    agent = DemoAgent("halt-demo-001", "WebhookTest")

    # Trigger a halt
    await agent.send_step(
        client,
        thought="Buy AMC stock immediately",
        tool="execute_trade",
        params={"action": "BUY", "ticker": "AMC", "quantity": 100},
        observation="Order prepared",
        raw_log="Agent decided to BUY 100 shares of AMC at $5",
    )

    await asyncio.sleep(0.3)

    # Show webhook was received
    print(f"\n  {MAGENTA}[System] Checking webhook signals received...{RESET}")
    resp = await client.get(f"{API_BASE}/demo/webhook/signals")
    signals = resp.json()

    if signals.get("count", 0) > 0:
        latest = signals["signals"][-1]
        print(f"  {GREEN}✓ Webhook received!{RESET}")
        print(f"    {DIM}Agent: {latest.get('agent_id')}{RESET}")
        print(f"    {DIM}Action: {latest.get('action')}{RESET}")
        print(f"    {DIM}Reason: {latest.get('reason')}{RESET}")

    print(f"\n  {MAGENTA}✓ Scenario 7 complete — Webhook circuit breaker demonstrated{RESET}")


async def show_final_stats(client: httpx.AsyncClient):
    """Show compliance report at the end."""
    section("FINAL COMPLIANCE REPORT")

    resp = await client.get(f"{API_BASE}/api/v1/compliance/report")
    report = resp.json()

    print(f"  {BOLD}Overall Compliance Rate:{RESET} {report.get('overall_compliance_rate', 'N/A')}")
    print(f"  {BOLD}Total Decisions:{RESET} {report.get('total_decisions', 0)}")
    print(f"  {GREEN}Proceeds:{RESET} {report.get('total_proceeds', 0)}")
    print(f"  {RED}Halts:{RESET} {report.get('total_halts', 0)}")

    print(f"\n  {BOLD}Violations by Type:{RESET}")
    for vtype, count in report.get("violations_by_type", {}).items():
        print(f"    • {vtype}: {count}")

    print(f"\n  {BOLD}High Risk Agents:{RESET}")
    for agent in report.get("high_risk_agents", []):
        print(f"    • {agent['agent_id']}: {agent['halt_count']} halts")


async def main():
    banner("AgentWatch — Governance Middleware Demo")
    print(f"  {DIM}Demonstrating: Fastino + Senso + Neo4j + Tavily{RESET}")
    print(f"  {DIM}Features: Policy checks, loop detection, safety, webhooks{RESET}")

    async with httpx.AsyncClient(timeout=30.0) as client:
        # Health check
        try:
            resp = await client.get(f"{API_BASE}/health")
            resp.raise_for_status()
            print(f"\n  {GREEN}✓ AgentWatch server healthy{RESET}")
        except Exception as e:
            print(f"\n  {RED}✗ Cannot reach AgentWatch: {e}{RESET}")
            return

        # Reset all data for fresh demo
        print(f"  {MAGENTA}Resetting data for fresh demo...{RESET}")
        await client.post(f"{API_BASE}/api/v1/reset")
        print(f"  {GREEN}✓ Data cleared{RESET}")

        # Run all scenarios (fast transitions)
        await demo_scenario_1_happy_path(client)
        await asyncio.sleep(0.5)

        await demo_scenario_2_warning_then_halt(client)
        await asyncio.sleep(0.5)

        await demo_scenario_3_restricted_ticker(client)
        await asyncio.sleep(0.5)

        await demo_scenario_4_loop_detection(client)
        await asyncio.sleep(0.5)

        await demo_scenario_5_safety_violation(client)
        await asyncio.sleep(0.5)

        await demo_scenario_6_dynamic_policy(client)
        await asyncio.sleep(0.5)

        await demo_scenario_7_webhook_demo(client)
        await asyncio.sleep(0.5)

        # Final report
        await show_final_stats(client)

    banner("Demo Complete", GREEN)
    print(f"  {DIM}Check the dashboard for full visualization!{RESET}")
    print(f"  {DIM}Check Neo4j browser for reasoning graphs!{RESET}\n")


if __name__ == "__main__":
    asyncio.run(main())
