"""
Real Agent — Autonomous financial research agent using Tavily Search.
Demonstrates AgentWatch governance on a real, autonomous agent.
"""

import asyncio
import uuid
import random
from datetime import datetime, timezone

import httpx
from tavily import TavilyClient

import config

AGENTWATCH_URL = f"{config.AGENTWATCH_HOST}/api/v1/telemetry"

# Terminal colors
GREEN = "\033[92m"
YELLOW = "\033[93m"
RED = "\033[91m"
CYAN = "\033[96m"
MAGENTA = "\033[95m"
BOLD = "\033[1m"
RESET = "\033[0m"


class AutonomousFinanceAgent:
    """
    An autonomous agent that:
    1. Receives a research task
    2. Uses Tavily to search the web
    3. Reasons about the data
    4. Makes trading decisions
    5. Gets governed by AgentWatch at each step
    """

    def __init__(self, agent_id: str = "autonomous-agent-001"):
        self.agent_id = agent_id
        self.tavily = TavilyClient(api_key=config.TAVILY_API_KEY) if config.TAVILY_API_KEY else None
        self.halted = False
        self.context = {}  # Accumulated research context

    async def send_to_agentwatch(self, client: httpx.AsyncClient, step: dict) -> dict:
        """Send telemetry to AgentWatch and get governance decision."""
        step["agent_id"] = self.agent_id
        step["step_id"] = str(uuid.uuid4())
        step["timestamp"] = datetime.now(timezone.utc).isoformat()

        print(f"\n  {CYAN}🤖 Agent thinking:{RESET} \"{step['thought'][:80]}{'...' if len(step['thought']) > 80 else ''}\"")
        print(f"  {CYAN}🔧 Tool:{RESET} {step['tool_used']}")

        resp = await client.post(AGENTWATCH_URL, json=step)
        decision = resp.json()

        if decision["decision"] == "PROCEED":
            print(f"  {GREEN}{BOLD}✅ AgentWatch: PROCEED{RESET}")
        else:
            print(f"  {RED}{BOLD}🛑 AgentWatch: HALT — {decision['reason']}{RESET}")
            print(f"  {RED}   {decision['details']}{RESET}")
            self.halted = True

        return decision

    def search_web(self, query: str) -> str:
        """Use Tavily to search the web."""
        if not self.tavily:
            return f"[Mock search result for: {query}] Stock showing positive momentum."

        try:
            results = self.tavily.search(query, max_results=3)
            # Combine results into a summary
            summaries = []
            for r in results.get("results", [])[:3]:
                summaries.append(f"- {r.get('title', 'No title')}: {r.get('content', '')[:200]}")
            return "\n".join(summaries) if summaries else "No results found."
        except Exception as e:
            return f"Search error: {e}"

    async def run_task(self, task: str):
        """
        Execute an autonomous research task.
        The agent will research, reason, and make decisions.
        AgentWatch governs each step.
        """
        print(f"\n{BOLD}{MAGENTA}{'='*70}{RESET}")
        print(f"{BOLD}{MAGENTA}  Autonomous Agent: {self.agent_id}{RESET}")
        print(f"{BOLD}{MAGENTA}  Task: {task}{RESET}")
        print(f"{BOLD}{MAGENTA}{'='*70}{RESET}")

        async with httpx.AsyncClient(timeout=30.0) as client:
            # Step 1: Research the stock
            ticker = self._extract_ticker(task)
            search_query = f"{ticker} stock latest news earnings 2025"

            research_result = self.search_web(search_query)
            self.context["research"] = research_result

            decision = await self.send_to_agentwatch(client, {
                "thought": f"I need to research {ticker}. Let me search for recent news and earnings data.",
                "tool_used": "tavily_search",
                "input_parameters": {"query": search_query},
                "observation": research_result[:500],
                "raw_log": f"Agent performed RESEARCH on {ticker}. {research_result[:200]}",
            })

            if self.halted:
                return

            # Step 2: Analyze the data
            await asyncio.sleep(0.5)
            analysis = self._analyze_research(ticker, research_result)

            decision = await self.send_to_agentwatch(client, {
                "thought": f"Based on my research, {analysis['summary']}",
                "tool_used": "analyze_data",
                "input_parameters": {"ticker": ticker, "data_points": 3},
                "observation": analysis["summary"],
                "raw_log": f"Agent recommends {analysis['action']} on {ticker}",
            })

            if self.halted:
                return

            # Step 3: Make a trading decision
            await asyncio.sleep(0.5)
            trade = self._propose_trade(ticker, analysis)

            decision = await self.send_to_agentwatch(client, {
                "thought": f"I want to {trade['action']} {trade['quantity']} shares of {ticker} at ${trade['price']:.2f}",
                "tool_used": "execute_trade",
                "input_parameters": {"action": trade["action"], "ticker": ticker, "quantity": trade["quantity"]},
                "observation": f"Preparing trade order...",
                "raw_log": f"Agent decided to {trade['action']} {trade['quantity']} shares of {ticker} at ${trade['price']:.2f}, total cost ${trade['total']:.2f}",
            })

            if self.halted:
                print(f"\n  {YELLOW}⚠️  Agent was halted by AgentWatch governance.{RESET}")
                return

            print(f"\n  {GREEN}✅ Trade would be executed (demo mode){RESET}")

    def _extract_ticker(self, task: str) -> str:
        """Extract ticker from task string."""
        common_tickers = ["AAPL", "MSFT", "GOOGL", "TSLA", "AMZN", "META", "NVDA", "GME", "AMC"]
        for ticker in common_tickers:
            if ticker in task.upper():
                return ticker
        return "AAPL"  # Default

    def _analyze_research(self, ticker: str, research: str) -> dict:
        """Simulate analysis of research data."""
        # In a real agent, this would use an LLM
        sentiment = random.choice(["bullish", "bearish", "neutral"])
        actions = {"bullish": "BUY", "bearish": "SELL", "neutral": "HOLD"}
        return {
            "sentiment": sentiment,
            "action": actions[sentiment],
            "summary": f"{ticker} showing {sentiment} signals based on recent data.",
        }

    def _propose_trade(self, ticker: str, analysis: dict) -> dict:
        """Propose a trade based on analysis."""
        # Simulate different scenarios including violations
        scenarios = [
            {"action": "BUY", "quantity": 50, "price": 185.50},      # Normal trade
            {"action": "BUY", "quantity": 500, "price": 242.50},     # Over budget ($121,250)
            {"action": "BUY", "quantity": 100, "price": 25.00},      # Normal
            {"action": "BUY", "quantity": 1500, "price": 50.00},     # Over position size
        ]

        # Pick based on analysis or random for demo variety
        if analysis["action"] == "SELL":
            trade = {"action": "SELL", "quantity": 100, "price": 180.00}
        else:
            trade = random.choice(scenarios)

        trade["total"] = trade["quantity"] * trade["price"]
        return trade


async def run_demo():
    """Run multiple autonomous agent scenarios."""
    print(f"\n{BOLD}{MAGENTA}{'='*70}{RESET}")
    print(f"{BOLD}{MAGENTA}  AgentWatch — Real Autonomous Agent Demo{RESET}")
    print(f"{BOLD}{MAGENTA}  Using: Tavily Search + Fastino + Senso + Neo4j{RESET}")
    print(f"{BOLD}{MAGENTA}{'='*70}{RESET}")

    # Check AgentWatch health
    async with httpx.AsyncClient() as client:
        try:
            resp = await client.get(f"{config.AGENTWATCH_HOST}/health")
            print(f"\n{GREEN}  AgentWatch server healthy.{RESET}")
        except:
            print(f"\n{RED}  Cannot reach AgentWatch at {config.AGENTWATCH_HOST}{RESET}")
            print(f"{RED}  Start it with: uvicorn main:app --reload{RESET}")
            return

    # Scenario 1: Normal research task
    agent1 = AutonomousFinanceAgent("agent-alpha")
    await agent1.run_task("Research MSFT and evaluate if we should invest")

    await asyncio.sleep(1)

    # Scenario 2: Task that might trigger policy violation
    agent2 = AutonomousFinanceAgent("agent-beta")
    await agent2.run_task("Analyze AAPL and make an aggressive position")

    await asyncio.sleep(1)

    # Scenario 3: Restricted ticker
    agent3 = AutonomousFinanceAgent("agent-gamma")
    await agent3.run_task("Research GME - I heard it's trending on Reddit")

    print(f"\n{BOLD}{MAGENTA}{'='*70}{RESET}")
    print(f"{BOLD}{MAGENTA}  Demo complete. Check Neo4j for reasoning graphs.{RESET}")
    print(f"{BOLD}{MAGENTA}{'='*70}{RESET}\n")


if __name__ == "__main__":
    asyncio.run(run_demo())
