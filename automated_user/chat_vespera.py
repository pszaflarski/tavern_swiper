#!/usr/bin/env python3
"""Interactive CLI script to chat with the Vespera Nightwhisper agent."""

import json
import sys
import requests

API_URL = "http://127.0.0.1:8000/invoke"

def chat():
    print("====================================================")
    print("    Chatting with Vespera Nightwhisper")
    print("====================================================")
    print("Type your message and press Enter. Type 'exit' to quit.\n")

    thread_id = None

    while True:
        try:
            prompt = input("\nYou: ")
            if not prompt.strip():
                continue
            if prompt.strip().lower() in ("exit", "quit"):
                print("\nExiting chat.")
                break

            payload = {
                "prompt": prompt,
                "agent": "vespera"
            }
            if thread_id:
                payload["thread_id"] = thread_id

            response = requests.post(API_URL, json=payload, timeout=30)
            if response.status_code != 200:
                print(f"\n[Error {response.status_code}]: {response.text}")
                continue

            data = response.json()
            thread_id = data.get("thread_id")
            raw_response = data.get("response", "")

            print(f"\n[Thread ID: {thread_id}]")
            
            # Attempt to parse Vespera's custom JSON array response structure
            try:
                blocks = json.loads(raw_response)
                if isinstance(blocks, list):
                    for block in blocks:
                        btype = block.get("type")
                        content = block.get("content", "")
                        if btype == "narration":
                            # Render narration in italicized gray
                            print(f"\033[3;37m* {content} *\033[0m")
                        elif btype == "message":
                            # Render dialogue in bold magenta
                            print(f"\033[1;35mVespera:\033[0m \"{content}\"")
                        else:
                            print(content)
                else:
                    print(raw_response)
            except json.JSONDecodeError:
                # Fallback to printing raw response if it's not JSON
                print(raw_response)

        except KeyboardInterrupt:
            print("\nExiting chat.")
            break
        except Exception as e:
            print(f"\nConnection Error: {e}")

if __name__ == "__main__":
    chat()
