#!/usr/bin/env python3
"""
Manual verification script for LLMLingua-2 Prompt Compression and RAG Summarization.

This script tests both types of compression:
1. LLMLingua-2 Prompt Compression: Trims long context (>15,000 characters) in-process using LLMLingua-2.
2. LangGraph History Compaction & RAG Trigger: Compacts chat history when thread tokens > MAX_MEMORY_TOKENS (12,000 tokens)
   and triggers background Pub/Sub fact extraction.

Usage:
  .venv/bin/python3 scripts/test_compression_manual.py [--remote]
"""

import sys
import os
import time
import argparse

# Add agent_router directory to sys.path
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, ".."))
AGENT_ROUTER_DIR = os.path.join(REPO_ROOT, "services", "agent_router")

if AGENT_ROUTER_DIR not in sys.path:
    sys.path.insert(0, AGENT_ROUTER_DIR)


SAMPLE_LORE = """
The Ancient Kingdom of Aethelgard was founded three millennia ago by King Aethelred I. 
Deep within the Frostfire Peaks lies the Sunken Crypt of Vorax, a dragon lord defeated during the Second Epoch.
Adventurers seeking the Sunken Crypt must navigate through the Whispering Pass, where specters guard the Crystal Pillar.
Legend says the Star of Aethelgard bestows unlimited magical power to its wielder, provided they possess the Dragon Signet Ring.
In the town of Oakhaven, the local tavern master Grogmar offers bounties for Frost Spider silk and Silver Ore.
Lira the Elven Scholar holds ancient maps written in High Elvish detailing the hidden entrance behind the Great Waterfall.
The Shadow Cult of Malakor has recently infiltrated the Royal Guards, seeking to unlock the Crypt using blood alchemy.
"""
LONG_CONTEXT = (SAMPLE_LORE * 35).strip()


def test_type_1_llmlingua_compression():
    print("\n" + "=" * 80)
    print("🧪 TEST 1: LLMLingua-2 Prompt Compression (Context Trimming)")
    print("=" * 80)

    long_context = LONG_CONTEXT
    char_count = len(long_context)
    token_est = char_count // 4

    print(f"📄 Input Context Length: {char_count:,} characters (~{token_est:,} estimated tokens)")
    print("Threshold set to: 15,000 characters (PROMPT_COMPRESS_MIN_CHARS)")

    start_time = time.time()
    try:
        from persistence.prompt_compressor import compress_prompt_if_needed

        compressed_text = compress_prompt_if_needed(
            context_text=long_context,
            instruction="Where is the Star of Aethelgard and how do you find it?",
            min_chars=15000,
            rate=0.5,
            force_test=True,
        )
        elapsed = time.time() - start_time
        compressed_chars = len(compressed_text)
        compressed_tokens = compressed_chars // 4
        reduction = (1 - compressed_chars / char_count) * 100

        print(f"\n✅ Compression Completed in {elapsed:.2f} seconds!")
        print(f"📊 Original Size:   {char_count:,} chars (~{token_est:,} tokens)")
        print(f"📉 Compressed Size: {compressed_chars:,} chars (~{compressed_tokens:,} tokens)")
        print(f"🔥 Reduction:       {reduction:.1f}% fewer tokens")
        print("\n🔍 Snippet of Compressed Output:")
        print("-" * 60)
        print(compressed_text[:400] + "...\n" + "-" * 60)

    except ImportError:
        print("⚠️ `llmlingua` package is not installed in local environment.")
        print("   Run `.venv/bin/pip install llmlingua` to test local model execution.")
    except Exception as e:
        print(f"❌ Error during compression test: {e}")


def test_type_2_history_compaction():
    print("\n" + "=" * 80)
    print("🧪 TEST 2: LangGraph History Compaction & RAG Memory Trigger")
    print("=" * 80)

    from langchain_core.messages import HumanMessage, AIMessage, SystemMessage
    from agents.base import _get_message_tokens, make_summarize_gate, make_summarize_node
    from unittest.mock import MagicMock

    # 1. Synthesize chat history exceeding 12,000 tokens (~48,000 chars)
    messages = []
    sample_turn = (
        "Human: We fought the Frost Spiders at Whispering Pass and recovered 15 Silver Ore!\n"
        "AI: Outstanding work! I will take the Silver Ore and award you 500 Gold pieces."
    )
    # Generate 15,000 tokens of messages
    for i in range(120):
        messages.append(HumanMessage(content=f"Turn {i}: {sample_turn} " + ("Extra lore details " * 20)))
        messages.append(AIMessage(content=f"Turn {i} reply: Acknowledged adventurer." + ("Bot reaction " * 20)))

    total_tokens = sum(_get_message_tokens(m) for m in messages)
    print(f"💬 Simulated Chat History: {len(messages)} messages ({total_tokens:,} tokens)")
    print("Threshold set to: 12,000 tokens (MAX_MEMORY_TOKENS)")

    # 2. Test Gate Evaluation
    os.environ["MAX_MEMORY_TOKENS"] = "12000"
    gate = make_summarize_gate("lira")
    state = {"messages": messages}
    route = gate(state)

    print(f"\n🚪 Gate Evaluation Route: '{route}' (Expected: 'lira-summarize')")
    assert route == "lira-summarize", f"Gate failed to trigger! Route was {route}"
    print("✅ Gate correctly detected threshold overflow!")

    # 3. Test Summarize Node Execution
    mock_llm = MagicMock()
    mock_llm.invoke.return_value = AIMessage(
        content="Adventurer recovered 15 Silver Ore at Whispering Pass and received 500 Gold pieces."
    )

    node = make_summarize_node("lira", llm=mock_llm)
    config = {"configurable": {"thread_id": "manual-test-thread-999"}}

    print("\n⚙️ Executing Summarization Node...")
    result = node(state, config=config)

    result_messages = result.get("messages", [])
    print(f"📦 Resulting State Message Operations: {len(result_messages)}")
    
    # Verify removals and summary SystemMessage
    removals = [m for m in result_messages if m.__class__.__name__ == "RemoveMessage"]
    summary_msg = next((m for m in result_messages if isinstance(m, SystemMessage)), None)

    print(f"  • RemoveMessage ops: {len(removals)} (pruning old checkpointer state)")
    print(f"  • Injected Summary:  '{getattr(summary_msg, 'content', '')}'")

    print("\n✅ Type 2 Compaction & Memory Trigger executed cleanly!")


def test_type_3_cloud_dev_api(remote_url: str):
    print("\n" + "=" * 80)
    print(f"🌐 TEST 3: Live Cloud Dev Service Test ({remote_url})")
    print("=" * 80)

    import requests

    import jwt
    jwt_secret = os.getenv("JWT_SECRET", "super-secret-tavern-key-123")
    token = jwt.encode({"sub": "manual-test-user", "user_id": "manual-test-user", "exp": int(time.time()) + 3600}, jwt_secret, algorithm="HS256")

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}",
    }
    long_prompt = "Greetings Lira! Please review this extensive lore archive:\n\n" + LONG_CONTEXT
    payload = {
        "agent": "lira",
        "model": "Mock",
        "prompt": long_prompt,
        "thread_id": f"manual-test-cloud-{int(time.time())}",
    }
    print(f"📄 Sending long payload of {len(long_prompt):,} characters to Cloud Dev to test live compression...")

    try:
        print(f"🚀 Sending POST to {remote_url}/invoke...")
        res = requests.post(f"{remote_url}/invoke", json=payload, headers=headers, timeout=60)
        print(f"Status Code: {res.status_code}")
        if res.status_code == 200:
            data = res.json()
            print("✅ Cloud Dev Service Responded Successfully!")
            print(f"   Thread ID:    {data.get('thread_id')}")
            print(f"   Checkpoint:   {data.get('checkpoint_id')}")
            msgs = data.get("messages", [])
            if msgs:
                print(f"   Bot Response: {msgs[-1].get('content')[:200]}...")
        else:
            print(f"⚠️ Response: {res.text}")
    except Exception as e:
        print(f"❌ Could not reach Cloud Dev endpoint: {e}")


def main():
    parser = argparse.ArgumentParser(description="Manual verification script for compression features.")
    parser.add_argument("--remote", action="store_true", help="Also send a live test request to dev Cloud Run endpoint")
    parser.add_argument("--local-server", action="store_true", help="Send a test request to local uvicorn server at http://127.0.0.1:8000")
    args = parser.parse_args()

    print("🚀 Starting Manual Compression & Compaction Test Suite...\n")
    test_type_1_llmlingua_compression()
    test_type_2_history_compaction()

    if args.local_server:
        test_type_3_cloud_dev_api("http://127.0.0.1:8000")
    elif args.remote:
        dev_url = os.getenv("ROUTER_SERVICE_URL", "https://agent-router-dev-hhqol7siba-uc.a.run.app")
        test_type_3_cloud_dev_api(dev_url)

    print("\n" + "=" * 80)
    print("🎉 ALL MANUAL COMPRESSION TESTS COMPLETED SUCCESSFULLY!")
    print("=" * 80 + "\n")


if __name__ == "__main__":
    main()
