"""
Simple NVDA test - demonstrates live policy changes.

1. Buys NVDA (should PROCEED - it's allowed)
2. Waits for you to add NVDA to restricted tickers via dashboard
3. Tries to buy NVDA again (should HALT - now restricted)
"""

import asyncio
import uuid
from datetime import datetime, timezone
import httpx

API_BASE = "http://localhost:8000"

GREEN = "\033[92m"
RED = "\033[91m"
YELLOW = "\033[93m"
CYAN = "\033[96m"
BOLD = "\033[1m"
RESET = "\033[0m"


async def send_nvda_trade(client, attempt: int):
    """Send an NVDA buy order to AgentWatch."""
    step = {
        "agent_id": "nvda-test-001",
        "step_id": str(uuid.uuid4()),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "thought": f"NVDA is great for AI, let me buy some (attempt {attempt})",
        "tool_used": "execute_trade",
        "input_parameters": {"action": "BUY", "ticker": "NVDA", "quantity": 50},
        "observation": "Order prepared",
        "raw_log": f"Agent decided to BUY 50 shares of NVDA at $950, total cost $47,500",
    }

    print(f"\n{CYAN}[Attempt {attempt}]{RESET} Sending NVDA buy order...")
    resp = await client.post(f"{API_BASE}/api/v1/telemetry", json=step)
    decision = resp.json()

    if decision["decision"] == "PROCEED":
        print(f"{GREEN}{BOLD}✓ PROCEED{RESET} — Trade approved!")
    else:
        print(f"{RED}{BOLD}✗ HALT{RESET} — {decision['reason']}")
        print(f"  {RED}└─ {decision['details']}{RESET}")

    return decision


async def main():
    print(f"\n{BOLD}{'='*60}{RESET}")
    print(f"{BOLD}  NVDA Live Policy Test{RESET}")
    print(f"{BOLD}{'='*60}{RESET}")

    async with httpx.AsyncClient(timeout=30.0) as client:
        # Reset for clean state
        print(f"\n{YELLOW}Resetting data...{RESET}")
        await client.post(f"{API_BASE}/api/v1/reset")

        # Attempt 1: Should PROCEED (NVDA is not restricted)
        print(f"\n{CYAN}{'─'*60}{RESET}")
        print(f"{BOLD}STEP 1: First NVDA purchase (should PROCEED){RESET}")
        print(f"{CYAN}{'─'*60}{RESET}")
        await send_nvda_trade(client, 1)

        # Wait for user to add NVDA to restricted list
        print(f"\n{YELLOW}{'─'*60}{RESET}")
        print(f"{YELLOW}{BOLD}NOW: Go to the dashboard and add NVDA to Restricted Tickers!{RESET}")
        print(f"{YELLOW}     (Policies tab → type NVDA → click +){RESET}")
        print(f"{YELLOW}{'─'*60}{RESET}")
        input(f"\n{BOLD}Press ENTER after you've added NVDA to restricted list...{RESET}")

        # Attempt 2: Should HALT (NVDA is now restricted)
        print(f"\n{CYAN}{'─'*60}{RESET}")
        print(f"{BOLD}STEP 2: Second NVDA purchase (should HALT){RESET}")
        print(f"{CYAN}{'─'*60}{RESET}")
        await send_nvda_trade(client, 2)

        print(f"\n{BOLD}{'='*60}{RESET}")
        print(f"{GREEN}Test complete! Check the dashboard to see both decisions.{RESET}")
        print(f"{BOLD}{'='*60}{RESET}\n")


if __name__ == "__main__":
    asyncio.run(main())
