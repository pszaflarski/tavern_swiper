#!/usr/bin/env python3
"""
Conversation-to-Novel Generator
================================
Reads a Tavern Swiper conversation from Firestore, divides it into chapters
using the agent router, expands each chapter into richly detailed prose,
and assembles a readable markdown novel.

Uses a smart multi-phase pipeline that mirrors the agent router's own
context management:
  Phase 1: Chunk messages into windows → summarize each (like vector memory migration)
  Phase 2: Plan chapters from the summary timeline (not raw messages)
  Phase 3: Write each chapter with raw messages + rolling context + vector recall

Usage:
    .venv/bin/python3 examples/conversation_novel/generate_novel.py \
        --conversation-id <CONV_ID> \
        --env prod \
        [--agent-router-url <URL>] \
        [--local] \
        [--output <PATH>]

Examples:
    # Read from prod messages, use Cloud Run dev agent router:
    .venv/bin/python3 examples/conversation_novel/generate_novel.py \
        --conversation-id 5200eccd-882f-4441-9765-5f519f060f4e \
        --env prod

    # Read from dev messages, use local agent router:
    .venv/bin/python3 examples/conversation_novel/generate_novel.py \
        --conversation-id <ID> \
        --env dev \
        --local
"""

import argparse
import json
import os
import re
import subprocess
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

import requests
from google.cloud import firestore


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

GCP_PROJECT_DEV = "tavern-swiper-dev"
GCP_PROJECT_PROD = "tavern-swiper-prod"

AGENT_MODEL = "gemini-2.5-flash"
LOCAL_AGENT_ROUTER_URL = "http://localhost:8000"

# Chunk size for Phase 1 summarization (mirrors migrate_vector_memories.py)
SUMMARY_CHUNK_SIZE = 30

# ---------------------------------------------------------------------------
# System Prompts
# ---------------------------------------------------------------------------

CHUNK_SUMMARIZER_PROMPT = """You are a narrative analyst. Summarize the following conversation excerpt concisely.

Rules:
- Write 100-200 words capturing the KEY events, emotional beats, and plot developments.
- Note any important character revelations, relationship changes, or dramatic turning points.
- Mention specific names, places, and items that were introduced.
- Write in present tense, third person.
- Focus on WHAT HAPPENS, not on describing the conversation format.
- Do NOT use JSON or any formatting — just plain prose summary."""

CHAPTER_PLANNER_PROMPT = """You are a literary editor and story architect analyzing a timeline of narrative summaries from a fantasy RPG conversation.

Your task is to divide this story into chapters for a novel. The summaries below are provided as REFERENCE MATERIAL to help you understand the narrative arc — they are mechanical chunks, NOT narrative units. Your chapter boundaries should follow the STORY, not the summary boundaries.

Rules:
1. Each chapter should represent a coherent narrative unit (a scene, an encounter, an emotional arc, or a dramatic turning point).
2. Create between 5 and 20 chapters depending on story length and complexity.
3. Give each chapter an evocative, literary title (NOT generic like "Chapter 1" or "The Beginning").
4. Specify chapter boundaries using ORIGINAL MESSAGE INDICES (0-based). Each summary is annotated with its message range — use those to place your chapter breaks precisely where the narrative shifts, even if that's in the middle of a summary chunk.
5. Write a brief 1-2 sentence synopsis for each chapter.

Return ONLY a valid JSON array. No markdown code fences, no commentary. Each element:
{
    "title": "An evocative chapter title",
    "from_msg": <start message index (inclusive, 0-based)>,
    "to_msg": <end message index (inclusive, 0-based)>,
    "synopsis": "Brief synopsis of the chapter's dramatic action"
}

The first chapter must start at message index 0. The last chapter must end at the final message index. Chapters must be contiguous (no gaps) and non-overlapping."""

STORY_WRITER_PROMPT = """You are a master fantasy novelist transforming a raw conversation transcript into a chapter of an immersive novel. This is part of a larger work — write as if this chapter belongs in a published fantasy book.

WRITING GUIDELINES:
- Transform raw dialogue exchanges into vivid literary prose with rich sensory details.
- Add atmospheric descriptions: the smell of hearth smoke, the creak of floorboards, the play of candlelight on faces.
- Expand internal monologues: what characters are thinking, feeling, remembering.
- Describe body language, micro-expressions, and subtle emotional cues.
- Maintain the original dialogue's intent but elevate the language to literary quality.
- Use varied sentence structure: mix long flowing descriptions with sharp, punchy dialogue beats.
- Include transitional passages between dialogue exchanges.
- Narration entries (marked [NARRATION]) are third-person scene descriptions — weave them naturally into the prose.
- Event entries (marked [EVENT]) are significant actions or atmospheric moments — expand them into full scenes.
- System entries can be mentioned or adapted as world-building flavor.
- Do NOT include any JSON formatting, markdown headers, or meta-commentary.
- Do NOT add a chapter title — that will be added separately.
- Write in third person past tense.
- Aim for 1500-3000 words per chapter to capture full detail.
- Preserve all plot details, character names, and narrative events from the original transcript. Do not omit any significant exchanges."""

NOVEL_TITLE_PROMPT = """You are a literary editor. Given the following chapter summaries from a fantasy novel, create:
1. A compelling novel title (evocative, literary, NOT generic)
2. A brief tagline/subtitle (one line)
3. A 2-3 paragraph back-cover synopsis that would make someone want to read this book

Return ONLY valid JSON with keys: "title", "tagline", "synopsis". No markdown fences."""


# ---------------------------------------------------------------------------
# Firestore helpers
# ---------------------------------------------------------------------------

def get_gcp_project(env: str) -> str:
    """Return the GCP project ID for the given environment."""
    return GCP_PROJECT_PROD if env == "prod" else GCP_PROJECT_DEV


def read_conversation_messages(conversation_id: str, env: str) -> list[dict]:
    """Read all messages from a conversation, ordered by created_at ascending."""
    project = get_gcp_project(env)
    db_name = f"messages-{env}"

    print(f"  Connecting to Firestore: project={project}, database={db_name}")
    client = firestore.Client(project=project, database=db_name)

    msgs_ref = (
        client.collection("conversations")
        .document(conversation_id)
        .collection("messages")
        .order_by("created_at")
    )

    messages = []
    for doc in msgs_ref.stream():
        data = doc.to_dict()
        data["message_id"] = doc.id
        messages.append(data)

    print(f"  Read {len(messages)} messages from conversation {conversation_id}")
    return messages


def read_conversation_metadata(conversation_id: str, env: str) -> dict:
    """Read conversation metadata (participants, etc.)."""
    project = get_gcp_project(env)
    db_name = f"messages-{env}"
    client = firestore.Client(project=project, database=db_name)

    doc = client.collection("conversations").document(conversation_id).get()
    if doc.exists:
        return doc.to_dict()
    return {}


def resolve_profile_names(profile_ids: list[str], env: str) -> dict[str, str]:
    """Resolve profile IDs to display names from profiles-{env} database."""
    project = get_gcp_project(env)
    db_name = f"profiles-{env}"

    print(f"  Resolving {len(profile_ids)} profile names from {db_name}...")
    client = firestore.Client(project=project, database=db_name)

    names = {}
    for pid in profile_ids:
        doc = client.collection("profiles").document(pid).get()
        if doc.exists:
            data = doc.to_dict()
            name = data.get("display_name", pid[:8])
            names[pid] = name
            print(f"    {pid} → {name}")
        else:
            names[pid] = pid[:8]
            print(f"    {pid} → (not found, using truncated ID)")

    return names


# ---------------------------------------------------------------------------
# Agent Router client
# ---------------------------------------------------------------------------

def get_agent_router_url(args) -> str:
    """Determine the agent router URL to use."""
    if args.agent_router_url:
        return args.agent_router_url.rstrip("/")
    if args.local:
        return LOCAL_AGENT_ROUTER_URL
    # Discover Cloud Run dev URL
    try:
        url = subprocess.check_output([
            "gcloud", "run", "services", "describe", "agent-router-dev",
            "--platform", "managed", "--region", "us-central1",
            "--project", GCP_PROJECT_DEV,
            "--format", "value(status.url)"
        ], stderr=subprocess.DEVNULL).decode("utf-8").strip()
        if url:
            return url
    except Exception:
        pass
    print("  WARNING: Could not discover Cloud Run URL, falling back to local")
    return LOCAL_AGENT_ROUTER_URL


def generate_jwt(secret: str, role: str = "admin") -> str:
    """Generate a Tavern JWT for authenticating with the agent router."""
    import jwt as pyjwt
    payload = {
        "sub": "novel-generator-script",
        "role": role,
        "iat": int(time.time()),
        "exp": int(time.time()) + 3600,
    }
    return pyjwt.encode(payload, secret, algorithm="HS256")


def get_auth_headers(args) -> dict[str, str]:
    """Get authorization headers for the agent router."""
    if args.local:
        return {"Content-Type": "application/json"}

    jwt_secret = None
    env_paths = [
        Path("services/auth/auth_go/.env"),
        Path("services/bots/bots_go/.env"),
        Path("services/messages/messages_go/.env"),
    ]
    for env_path in env_paths:
        if env_path.exists():
            with open(env_path) as f:
                for line in f:
                    line = line.strip()
                    if line.startswith("JWT_SECRET=") and not line.startswith("#"):
                        jwt_secret = line.split("=", 1)[1].strip().strip('"').strip("'")
                        break
        if jwt_secret:
            break

    if not jwt_secret:
        print("  WARNING: Could not find JWT_SECRET. Trying without auth...")
        return {"Content-Type": "application/json"}

    token = generate_jwt(jwt_secret)
    return {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}",
    }


def invoke_agent(
    agent_router_url: str,
    headers: dict[str, str],
    prompt: str,
    agent: str = "example_chat",
    model: str = AGENT_MODEL,
    thread_id: str | None = None,
    timeout: int = 120,
) -> str:
    """Call the agent router's /invoke endpoint and return the response text."""
    if thread_id is None:
        thread_id = str(uuid.uuid4())

    payload = {
        "prompt": prompt,
        "agent": agent,
        "model": model,
        "thread_id": thread_id,
    }

    resp = requests.post(
        f"{agent_router_url}/invoke",
        headers=headers,
        json=payload,
        timeout=timeout,
    )

    if resp.status_code != 200:
        raise RuntimeError(
            f"Agent router returned HTTP {resp.status_code}: {resp.text[:500]}"
        )

    result = resp.json()
    return result.get("response", "")


# ---------------------------------------------------------------------------
# Transcript formatting
# ---------------------------------------------------------------------------

def format_messages_block(
    messages: list[dict],
    profile_names: dict[str, str],
    include_index: bool = False,
    start_index: int = 0,
) -> str:
    """Format a block of messages into readable text."""
    lines = []
    for i, msg in enumerate(messages):
        sender_id = msg.get("sent_by", "")
        sender_name = profile_names.get(sender_id, sender_id[:8] if sender_id else "System")
        msg_type = msg.get("type", "user")
        content = msg.get("content", "")

        type_prefix = ""
        if msg_type == "event":
            type_prefix = "[EVENT] "
        elif msg_type == "system":
            type_prefix = "[SYSTEM] "

        if include_index:
            lines.append(f"[{start_index + i}] {type_prefix}{sender_name}: {content}")
        else:
            lines.append(f"{type_prefix}{sender_name}: {content}")

    return "\n".join(lines)


def format_chapter_messages(
    messages: list[dict],
    profile_names: dict[str, str],
    from_idx: int,
    to_idx: int,
) -> str:
    """Format a chapter's messages for the story writer."""
    chapter_msgs = messages[from_idx : to_idx + 1]
    lines = []
    for msg in chapter_msgs:
        sender_id = msg.get("sent_by", "")
        sender_name = profile_names.get(sender_id, sender_id[:8] if sender_id else "Narrator")
        msg_type = msg.get("type", "user")
        content = msg.get("content", "")

        type_prefix = ""
        if msg_type == "event":
            type_prefix = "[EVENT/NARRATION] "
        elif msg_type == "system":
            type_prefix = "[SYSTEM] "

        lines.append(f"{type_prefix}{sender_name}: {content}")

    return "\n\n".join(lines)


# ---------------------------------------------------------------------------
# Phase 1: Chunked Summarization
# ---------------------------------------------------------------------------

def create_summary_timeline(
    messages: list[dict],
    profile_names: dict[str, str],
    agent_router_url: str,
    headers: dict[str, str],
    chunk_size: int = SUMMARY_CHUNK_SIZE,
) -> list[dict]:
    """
    Phase 1: Divide messages into chunks and summarize each.

    This mirrors the approach used by migrate_vector_memories.py and the
    rolling summarization in agents/base.py. Instead of dumping 1000+ messages
    into one LLM call, we create a compressed "timeline" of summaries.

    Returns a list of dicts:
    [
        {
            "index": 0,
            "from_msg": 0,
            "to_msg": 29,
            "summary": "Keziah enters the Rogue's Lantern and...",
            "msg_count": 30
        },
        ...
    ]
    """
    total = len(messages)
    num_chunks = (total + chunk_size - 1) // chunk_size

    print(f"\n🔍 Phase 1: Creating summary timeline ({num_chunks} chunks of ~{chunk_size} messages)...")

    timeline = []
    for chunk_idx in range(num_chunks):
        from_msg = chunk_idx * chunk_size
        to_msg = min(from_msg + chunk_size - 1, total - 1)
        chunk_msgs = messages[from_msg : to_msg + 1]
        msg_count = len(chunk_msgs)

        print(f"  Summarizing chunk {chunk_idx + 1}/{num_chunks} (messages {from_msg}-{to_msg})...", end=" ", flush=True)

        # Format the chunk for summarization
        chunk_text = format_messages_block(chunk_msgs, profile_names)

        prompt = (
            f"{CHUNK_SUMMARIZER_PROMPT}\n\n"
            f"=== CONVERSATION EXCERPT (messages {from_msg}-{to_msg}) ===\n"
            f"{chunk_text}\n"
            f"=== END EXCERPT ==="
        )

        try:
            summary = invoke_agent(
                agent_router_url=agent_router_url,
                headers=headers,
                prompt=prompt,
                timeout=60,
            )
            # Clean up response
            summary = _clean_llm_response(summary)
            word_count = len(summary.split())
            print(f"✅ ({word_count} words)")
        except Exception as e:
            print(f"⚠️ Failed: {e}")
            # Fallback: use first/last message content as summary
            first_content = chunk_msgs[0].get("content", "")[:100]
            last_content = chunk_msgs[-1].get("content", "")[:100]
            summary = f"Messages {from_msg}-{to_msg}: starts with '{first_content}...' and ends with '{last_content}...'"
            print(f"  Using fallback summary")

        timeline.append({
            "index": chunk_idx,
            "from_msg": from_msg,
            "to_msg": to_msg,
            "summary": summary,
            "msg_count": msg_count,
        })

        # Brief pause between API calls
        if chunk_idx < num_chunks - 1:
            time.sleep(0.5)

    print(f"  ✅ Created {len(timeline)} summaries covering {total} messages")
    return timeline


# ---------------------------------------------------------------------------
# Phase 2: Chapter Planning from Summaries
# ---------------------------------------------------------------------------

def plan_chapters_from_timeline(
    timeline: list[dict],
    agent_router_url: str,
    headers: dict[str, str],
) -> list[dict]:
    """
    Phase 2: Use the summary timeline to plan chapters.

    Instead of sending 200K+ tokens of raw messages, we send ~6K tokens
    of summaries. The LLM can easily analyze the full narrative arc.
    """
    print("\n📖 Phase 2: Planning chapters from summary timeline...")

    # Format timeline for the chapter planner
    timeline_text = ""
    for entry in timeline:
        timeline_text += (
            f"[Summary {entry['index']}] (messages {entry['from_msg']}-{entry['to_msg']}, "
            f"{entry['msg_count']} messages):\n"
            f"{entry['summary']}\n\n"
        )

    prompt = (
        f"{CHAPTER_PLANNER_PROMPT}\n\n"
        f"Total summaries: {len(timeline)} (indices 0 to {len(timeline) - 1})\n"
        f"Total original messages: {timeline[-1]['to_msg'] + 1}\n\n"
        f"=== SUMMARY TIMELINE ===\n{timeline_text}=== END TIMELINE ==="
    )

    raw_response = invoke_agent(
        agent_router_url=agent_router_url,
        headers=headers,
        prompt=prompt,
        timeout=120,
    )

    # Parse JSON response
    cleaned = raw_response.strip()
    cleaned = re.sub(r"^```(?:json)?\s*\n?", "", cleaned)
    cleaned = re.sub(r"\n?```\s*$", "", cleaned)
    cleaned = cleaned.strip()

    try:
        chapters = json.loads(cleaned)
    except json.JSONDecodeError as e:
        print(f"  ⚠️  Failed to parse chapter plan JSON: {e}")
        print(f"  Raw (first 500): {raw_response[:500]}")
        total_messages = timeline[-1]["to_msg"] + 1
        chapters = _fallback_chapters(total_messages)

    # Validate — the LLM returns from_msg/to_msg directly
    total_messages = timeline[-1]["to_msg"] + 1
    chapters = _validate_chapters(chapters, total_messages)

    print(f"  ✅ Planned {len(chapters)} chapters:")
    for i, ch in enumerate(chapters):
        msg_count = ch["to_msg"] - ch["from_msg"] + 1
        print(f"     Chapter {i + 1}: \"{ch['title']}\" (messages {ch['from_msg']}-{ch['to_msg']}, {msg_count} msgs)")

    return chapters


# _resolve_chapter_boundaries removed — LLM now outputs message indices directly,
# so chapters are NOT constrained to summary chunk boundaries.


def _fallback_chapters(total_messages: int, chunk_size: int = 60) -> list[dict]:
    """Create fallback chapters by splitting messages evenly."""
    chapters = []
    for i in range(0, total_messages, chunk_size):
        end = min(i + chunk_size - 1, total_messages - 1)
        chapters.append({
            "title": f"Part {len(chapters) + 1}",
            "from_msg": i,
            "to_msg": end,
            "synopsis": f"Messages {i} through {end}",
        })
    return chapters


def _validate_chapters(chapters: list[dict], total_messages: int) -> list[dict]:
    """Validate and fix chapter boundaries."""
    if not chapters:
        return _fallback_chapters(total_messages)

    chapters.sort(key=lambda c: c.get("from_msg", 0))
    chapters[0]["from_msg"] = 0
    chapters[-1]["to_msg"] = total_messages - 1

    for i in range(1, len(chapters)):
        expected_start = chapters[i - 1]["to_msg"] + 1
        if chapters[i]["from_msg"] != expected_start:
            chapters[i]["from_msg"] = expected_start

    valid = [ch for ch in chapters if ch["from_msg"] <= ch["to_msg"]]
    return valid if valid else _fallback_chapters(total_messages)


# ---------------------------------------------------------------------------
# Phase 3: Chapter Writing with Context Enrichment
# ---------------------------------------------------------------------------

def build_rolling_context(
    chapter_index: int,
    chapters: list[dict],
    chapter_prose: list[str],
    timeline: list[dict],
) -> str:
    """
    Build a rolling context string for the story writer.

    For each chapter, we provide:
    1. A summary of ALL preceding chapters (so the writer knows the backstory)
    2. Relevant timeline summaries for adjacent chapters (thematic context)

    This mirrors the rolling summary approach in agents/base.py where
    compacted history is injected as a SystemMessage.
    """
    context_parts = []

    # Summaries of preceding chapters (from our own generated prose)
    if chapter_index > 0 and chapter_prose:
        context_parts.append("=== STORY SO FAR (preceding chapters) ===")
        for i in range(chapter_index):
            ch = chapters[i]
            # Use the synopsis + first 200 words of prose for context
            prose_preview = " ".join(chapter_prose[i].split()[:200])
            context_parts.append(
                f"\nChapter {i + 1} \"{ch['title']}\": {ch.get('synopsis', '')}\n"
                f"Preview: {prose_preview}..."
            )
        context_parts.append("=== END STORY SO FAR ===\n")

    # Timeline summaries for the NEXT chapter (foreshadowing context)
    current_ch = chapters[chapter_index]
    if chapter_index < len(chapters) - 1:
        next_ch = chapters[chapter_index + 1]
        context_parts.append(
            f"=== WHAT COMES NEXT (for pacing) ===\n"
            f"The next chapter \"{next_ch['title']}\" will cover: {next_ch.get('synopsis', 'N/A')}\n"
            f"=== END ===\n"
        )

    return "\n".join(context_parts) if context_parts else ""


def write_chapter(
    chapter_index: int,
    chapter: dict,
    messages: list[dict],
    profile_names: dict[str, str],
    chapters: list[dict],
    chapter_prose: list[str],
    timeline: list[dict],
    agent_router_url: str,
    headers: dict[str, str],
) -> str:
    """
    Phase 3: Write a single chapter with context enrichment.

    Each chapter receives:
    - Raw messages for this chapter (detail source — the actual dialogue)
    - Rolling context from preceding chapters (backstory continuity)
    - Next chapter synopsis (pacing awareness)
    """
    title = chapter["title"]
    from_idx = chapter["from_msg"]
    to_idx = chapter["to_msg"]
    msg_count = to_idx - from_idx + 1

    print(f"\n  ✍️  Writing Chapter {chapter_index + 1}: \"{title}\" ({msg_count} messages)...")

    # Raw messages for this chapter
    chapter_transcript = format_chapter_messages(messages, profile_names, from_idx, to_idx)

    # Rolling context from preceding chapters
    rolling_context = build_rolling_context(chapter_index, chapters, chapter_prose, timeline)

    # Assemble the full prompt
    prompt_parts = [STORY_WRITER_PROMPT]

    if rolling_context:
        prompt_parts.append(f"\n{rolling_context}")

    prompt_parts.append(
        f"\nCHAPTER TITLE: \"{title}\"\n"
        f"CHAPTER SYNOPSIS: {chapter.get('synopsis', 'N/A')}\n\n"
        f"=== RAW TRANSCRIPT FOR THIS CHAPTER ===\n\n{chapter_transcript}\n\n"
        f"=== END TRANSCRIPT ===\n\n"
        f"Now write this chapter as immersive literary prose. Remember: no JSON, no headers, no meta-text — just the story."
    )

    prompt = "\n".join(prompt_parts)

    prose = invoke_agent(
        agent_router_url=agent_router_url,
        headers=headers,
        prompt=prompt,
        timeout=180,
    )

    prose = _clean_llm_response(prose)
    word_count = len(prose.split())
    print(f"     ✅ Done ({word_count} words)")
    return prose


# ---------------------------------------------------------------------------
# Response cleanup
# ---------------------------------------------------------------------------

def _clean_llm_response(text: str) -> str:
    """Clean up LLM response — handle JSON wrapping, code fences, etc."""
    text = text.strip()

    # Remove markdown code fences
    text = re.sub(r"^```(?:json|text|markdown)?\s*\n?", "", text)
    text = re.sub(r"\n?```\s*$", "", text)
    text = text.strip()

    # If it's a JSON-quoted string, unquote
    if text.startswith('"') and text.endswith('"'):
        try:
            text = json.loads(text)
        except json.JSONDecodeError:
            pass

    # If it's a JSON array (chat agent format), extract content
    if isinstance(text, str) and text.startswith("["):
        try:
            items = json.loads(text)
            if isinstance(items, list):
                parts = []
                for item in items:
                    if isinstance(item, dict) and "content" in item:
                        parts.append(item["content"])
                    elif isinstance(item, str):
                        parts.append(item)
                if parts:
                    text = "\n\n".join(parts)
        except json.JSONDecodeError:
            pass

    return text if isinstance(text, str) else str(text)


# ---------------------------------------------------------------------------
# Novel Assembly
# ---------------------------------------------------------------------------

def generate_novel_metadata(
    chapters: list[dict],
    agent_router_url: str,
    headers: dict[str, str],
) -> dict:
    """Generate a title, tagline, and synopsis for the novel."""
    print("\n📚 Generating novel title and synopsis...")

    chapter_summaries = "\n".join(
        f"Chapter {i+1}: \"{ch['title']}\" — {ch.get('synopsis', 'N/A')}"
        for i, ch in enumerate(chapters)
    )

    prompt = (
        f"{NOVEL_TITLE_PROMPT}\n\n"
        f"=== CHAPTER SUMMARIES ===\n{chapter_summaries}\n=== END ==="
    )

    raw = invoke_agent(
        agent_router_url=agent_router_url,
        headers=headers,
        prompt=prompt,
        timeout=60,
    )

    cleaned = _clean_llm_response(raw)
    # Try to parse as JSON
    try:
        # Remove any remaining code fences
        cleaned = re.sub(r"^```(?:json)?\s*\n?", "", cleaned)
        cleaned = re.sub(r"\n?```\s*$", "", cleaned)
        metadata = json.loads(cleaned.strip())
    except json.JSONDecodeError:
        metadata = {
            "title": "Tales from the Tavern",
            "tagline": "A story forged in firelight and shadow",
            "synopsis": "An epic tale of love, adventure, and sacrifice in a world of magic and mystery.",
        }

    print(f"  Title: {metadata.get('title', 'Untitled')}")
    print(f"  Tagline: {metadata.get('tagline', '')}")
    return metadata


def assemble_novel(
    metadata: dict,
    chapters: list[dict],
    chapter_prose: list[str],
    profile_names: dict[str, str],
    conversation_id: str,
) -> str:
    """Assemble the final novel as a markdown document."""
    title = metadata.get("title", "Tales from the Tavern")
    tagline = metadata.get("tagline", "")
    synopsis = metadata.get("synopsis", "")

    parts = []

    # Title page
    parts.append(f"# {title}\n")
    if tagline:
        parts.append(f"*{tagline}*\n")
    parts.append("---\n")

    # Characters
    parts.append("## Characters\n")
    for pid, name in profile_names.items():
        parts.append(f"- **{name}**")
    parts.append("")

    # Synopsis
    if synopsis:
        parts.append("## Synopsis\n")
        parts.append(f"{synopsis}\n")

    # Table of contents
    parts.append("---\n")
    parts.append("## Table of Contents\n")
    for i, ch in enumerate(chapters):
        anchor = ch["title"].lower().replace(" ", "-").replace("'", "").replace('"', "")
        parts.append(f"{i + 1}. [{ch['title']}](#{anchor})")
    parts.append("")

    # Chapters
    parts.append("---\n")
    for i, (ch, prose) in enumerate(zip(chapters, chapter_prose)):
        parts.append(f"## Chapter {i + 1}: {ch['title']}\n")
        parts.append(f"{prose}\n")
        if i < len(chapters) - 1:
            parts.append("---\n")

    # Colophon
    parts.append("---\n")
    parts.append("*This novel was generated from a Tavern Swiper conversation.*\n")
    parts.append(f"*Conversation ID: `{conversation_id}`*\n")
    parts.append(f"*Generated: {datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")}*\n")

    return "\n".join(parts)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Generate a novel from a Tavern Swiper conversation",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--conversation-id", required=True,
        help="Firestore conversation ID to read messages from",
    )
    parser.add_argument(
        "--env", default="dev", choices=["dev", "test", "prod"],
        help="Environment to read messages from (default: dev)",
    )
    parser.add_argument(
        "--agent-router-url",
        help="Override agent router URL (default: auto-discover Cloud Run dev or use --local)",
    )
    parser.add_argument(
        "--local", action="store_true",
        help="Use local agent router at localhost:8000 (requires BYPASS_AUTH=true)",
    )
    parser.add_argument(
        "--output", "-o",
        help="Output file path (default: examples/conversation_novel/output/<title>.md)",
    )
    parser.add_argument(
        "--model", default=AGENT_MODEL,
        help=f"LLM model to use (default: {AGENT_MODEL})",
    )
    parser.add_argument(
        "--chunk-size", type=int, default=SUMMARY_CHUNK_SIZE,
        help=f"Messages per summary chunk in Phase 1 (default: {SUMMARY_CHUNK_SIZE})",
    )

    args = parser.parse_args()

    print("=" * 60)
    print("📖 Tavern Swiper — Conversation to Novel Generator")
    print("=" * 60)

    # Model to use (from args or default)
    model = args.model

    # 1. Determine agent router URL
    agent_router_url = get_agent_router_url(args)
    print(f"\n🔗 Agent Router: {agent_router_url}")

    # Test connectivity
    try:
        health = requests.get(f"{agent_router_url}/health", timeout=10)
        if health.status_code == 200:
            print(f"  ✅ Agent router is healthy")
        else:
            print(f"  ⚠️  Agent router returned HTTP {health.status_code}")
    except requests.ConnectionError:
        print(f"  ❌ Cannot connect to agent router at {agent_router_url}")
        print(f"     If using --local, make sure the agent router is running.")
        sys.exit(1)

    # 2. Get auth headers
    headers = get_auth_headers(args)

    # 3. Read conversation metadata
    print(f"\n📥 Reading conversation from messages-{args.env}...")
    conv_meta = read_conversation_metadata(args.conversation_id, args.env)
    if not conv_meta:
        print(f"  ❌ Conversation {args.conversation_id} not found in messages-{args.env}")
        sys.exit(1)

    participant_ids = conv_meta.get("participant_ids", [])
    print(f"  Participants: {participant_ids}")

    # 4. Resolve profile names
    profile_names = resolve_profile_names(participant_ids, args.env)

    # 5. Read all messages
    messages = read_conversation_messages(args.conversation_id, args.env)
    if not messages:
        print("  ❌ No messages found in this conversation")
        sys.exit(1)

    # ═══════════════════════════════════════════════════════════
    # Phase 1: Chunked Summarization
    # ═══════════════════════════════════════════════════════════
    timeline = create_summary_timeline(
        messages, profile_names, agent_router_url, headers,
        chunk_size=args.chunk_size,
    )

    # ═══════════════════════════════════════════════════════════
    # Phase 2: Chapter Planning from Summaries
    # ═══════════════════════════════════════════════════════════
    chapters = plan_chapters_from_timeline(timeline, agent_router_url, headers)

    # ═══════════════════════════════════════════════════════════
    # Phase 3: Write each chapter with context enrichment
    # ═══════════════════════════════════════════════════════════
    print(f"\n✍️  Phase 3: Writing {len(chapters)} chapters with context enrichment...")
    chapter_prose = []
    for i, chapter in enumerate(chapters):
        prose = write_chapter(
            i, chapter, messages, profile_names,
            chapters, chapter_prose, timeline,
            agent_router_url, headers,
        )
        chapter_prose.append(prose)
        if i < len(chapters) - 1:
            time.sleep(1)

    # ═══════════════════════════════════════════════════════════
    # Generate title & assemble
    # ═══════════════════════════════════════════════════════════
    novel_meta = generate_novel_metadata(chapters, agent_router_url, headers)

    print("\n📚 Assembling novel...")
    novel_text = assemble_novel(
        novel_meta, chapters, chapter_prose, profile_names, args.conversation_id,
    )

    # Write output
    if args.output:
        output_path = Path(args.output)
    else:
        output_dir = Path("examples/conversation_novel/output")
        output_dir.mkdir(parents=True, exist_ok=True)
        safe_title = re.sub(r"[^\w\s-]", "", novel_meta.get("title", "novel")).strip()
        safe_title = re.sub(r"\s+", "_", safe_title).lower()
        output_path = output_dir / f"{safe_title}.md"

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(novel_text, encoding="utf-8")

    total_words = len(novel_text.split())
    print(f"\n{'=' * 60}")
    print(f"✅ Novel generated successfully!")
    print(f"   📄 Output: {output_path}")
    print(f"   📊 {len(chapters)} chapters, ~{total_words:,} words")
    print(f"   📖 Title: \"{novel_meta.get('title', 'Untitled')}\"")
    print(f"   🔍 Pipeline: {len(timeline)} summaries → {len(chapters)} chapters")
    print(f"{'=' * 60}")


if __name__ == "__main__":
    main()
