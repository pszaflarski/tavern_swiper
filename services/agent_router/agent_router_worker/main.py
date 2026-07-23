"""FastAPI entrypoint for agent_router_worker (Pub/Sub push event listener)."""

import base64
import json
import logging
import os
from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel
from worker import process_memory_event

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("agent_router_worker")

app = FastAPI(title="Agent Router Worker", version="1.0.0")


class MemoryEventPayload(BaseModel):
    thread_id: str
    agent_id: str
    history_text: str


@app.get("/health")
def health_check():
    return {"status": "ok", "service": "agent_router_worker"}


@app.post("/pubsub/memory-events")
async def pubsub_memory_event(request: Request):
    """Handle Pub/Sub push message containing memory compaction requests."""
    try:
        body = await request.json()
        logger.info("Received Pub/Sub push message: %s", body)

        # Handle standard Pub/Sub message envelope
        if "message" in body:
            pubsub_message = body["message"]
            if "data" in pubsub_message:
                data_str = base64.b64decode(pubsub_message["data"]).decode("utf-8")
                payload_data = json.loads(data_str)
            elif "attributes" in pubsub_message:
                payload_data = pubsub_message["attributes"]
            else:
                payload_data = body
        else:
            payload_data = body

        thread_id = payload_data.get("thread_id")
        agent_id = payload_data.get("agent_id", "agent")
        history_text = payload_data.get("history_text", "")

        if not thread_id or not history_text:
            logger.warning("Invalid payload: missing thread_id or history_text")
            return {"status": "ignored", "reason": "missing_required_fields"}

        result = process_memory_event(thread_id=thread_id, agent_id=agent_id, history_text=history_text)
        return result

    except Exception as e:
        logger.error("Failed to process memory event: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/process")
def direct_process(payload: MemoryEventPayload):
    """Direct HTTP invoke for local testing/debugging without Pub/Sub envelope."""
    return process_memory_event(thread_id=payload.thread_id, agent_id=payload.agent_id, history_text=payload.history_text)


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8009))
    uvicorn.run(app, host="0.0.0.0", port=port)
