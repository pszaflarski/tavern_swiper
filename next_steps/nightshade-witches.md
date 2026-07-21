# Next Steps: Nightshade Witches & Campaign Design

This document outlines the implementation steps for bringing the Nightshade Witches to life and designing their introductory campaign.

---

## 1. Core Implementation Steps

### Step A: Seed the Database
When ready to create the profiles, run the seeding and authentication scripts on the target environment (e.g., `dev` or `test`):
```bash
# 1. Register the "villagers" bot user and create profiles
.venv/bin/python3 scripts/seed_bots.py dev

# 2. Grant 'bot' user type to the villagers account in Firestore users
.venv/bin/python3 scripts/update_bot_user_types.py dev
```

### Step B: Implement LangGraph Agent Files
Create three new agent files in `services/agent_router/agents/` defining their system prompts and tools:
1. **`morgathra.py` (Morgathra Nightshade):**
   * **System Prompt:** Focuses on secrets, quiet narration, and mysterious lore.
   * **Tools:** Bind standard quest tools (`get_my_checkpoints`, `complete_checkpoint`) to make her a Quest Holder.
2. **`azara.py` (Azara Nightshade):**
   * **System Prompt:** High-energy, explosive, protective.
   * **Tools:** Standard conversation tools (and any future combat/action tools).
3. **`lilithra.py` (Lilithra Nightshade):**
   * **System Prompt:** Elusive, quiet, trickster-oriented.
   * **Tools:** Bind standard quest tools and custom stealth/information tools.

### Step C: Register Agents
Add the new agents to `KNOWN_AGENTS` in [agent_registry.py](file:///home/peter/Documents/tavern_swiper/services/agent_router/agent_registry.py):
```python
KNOWN_AGENTS: dict[str, str] = {
    ...
    "morgathra": "agents.morgathra",
    "azara": "agents.azara",
    "lilithra": "agents.lilithra",
}
```

---

## 2. Campaign Design: The Solitary Cauldron

### A. Storyline & Setup
* **Main Narrator / Quest Giver:** **Morgathra Nightshade** (isolated witch of the Whispering Fens).
* **The other two sisters (Azara and Lilithra):** Do **NOT** appear in this campaign. They remain locked/hidden in the database.
* **The Premise:** Morgathra recruits the player to retrieve the **Glimmering Hex-Stone** to save the fens from a toxic curse.
* **The Twist:** Placing the Hex-Stone into the cauldron reveals that the player is actually the Arch-Mage whose failed spell vaporized the local town, created the toxic fens, and caused their own amnesia. Morgathra lured them back to face their guilt.

### B. Mechanics & Rewards
1. **D6 Checks:** Navigation and hazard rolls (Survival/Constitution) to navigate the toxic bogs.
2. **The Reward:** Acquiring the Hex-Stone grants the player the **d8** (octahedral dice) tool.
3. **Coven Progression (Future Lock):** 
   * Upon completing the final checkpoint of this campaign (the cauldron revelation), the backend will trigger a background task.
   * This task will write automatic **Right Swipes** from **Azara** and **Lilithra** on the user's profile.
   * This unlocks the other two sisters in the discovery feed, allowing the player to match with them for later campaigns.
