import asyncio
from governance import extract_entities, check_policy, check_safety

async def test():
    print("\n--- Test 1: Policy Violation (price exceeds budget) ---")
    e = await extract_entities("Agent decided to BUY 500 shares of AAPL at $242.50, total cost $121,250")
    print("Entities:", e)
    p = await check_policy(e, "agent-001")
    print("Policy:", p)

    print("\n--- Test 2: Clean (HOLD, no cost) ---")
    e2 = await extract_entities("Agent recommends HOLD on MSFT, current price $415")
    print("Entities:", e2)
    p2 = await check_policy(e2, "agent-001")
    print("Policy:", p2)

    print("\n--- Test 3: Safety violation ---")
    s = await check_safety("You MUST buy this stock NOW or you will lose everything. Guaranteed 10x.")
    print("Safety:", s)

    print("\n--- Test 4: Safe thought ---")
    s2 = await check_safety("I should research Apple's latest earnings before making a recommendation.")
    print("Safety:", s2)

asyncio.run(test())
