---
max_turns: 2
allowed_tools: []
---

Write a git commit message (summary line and body) for this change in my space game. Just give me the message.

My notes:
- NPCs, contracts and balance test runs all fly using "orders" (Move here, Dock, Approach, Mine, Salvage)
- Before, an order just flew at normal speed no matter how far. We're about to spread the map out so distances get big
- Now: if an order's leg is more than 20 km past where the cruise drive would drop out, the order spools up the cruise drive, cruises, then flies the last bit normally
- 120 km in 46 s; 200 km home to dock in 35 s
- If the order ends (player grabs the stick, gives a new order, or the order finishes) the cruise stops. Orders don't cruise during a fight
- Client predicts it exactly like the server
- Saved test outputs ("goldens") for 5 checks changed only in their hash digests because those tests park ships 40-60 km from the station and they now cruise home. Balance goldens unchanged.
