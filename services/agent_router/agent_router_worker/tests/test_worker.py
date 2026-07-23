"""Unit tests for agent_router_worker."""

import sys
import os
import unittest
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from main import app
from fastapi.testclient import TestClient
from worker import process_memory_event


class TestAgentRouterWorker(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_health_check(self):
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "ok")

    @patch("worker.extract_atomic_facts_and_hyde")
    @patch("worker.get_firestore_client")
    @patch("worker.reconcile_and_store_facts")
    def test_process_memory_event(self, mock_reconcile, mock_fs, mock_extract):
        mock_extract.return_value = [{"text": "Adventurer found a magical sword.", "category": "inventory"}]
        mock_reconcile.return_value = 1

        result = process_memory_event("thread-123", "lira", "Adventurer found a magical sword.")
        self.assertEqual(result["status"], "success")
        self.assertEqual(result["facts_stored"], 1)

    @patch("main.process_memory_event")
    def test_direct_process_endpoint(self, mock_process):
        mock_process.return_value = {"status": "success", "facts_stored": 1}
        payload = {"thread_id": "thread-123", "agent_id": "lira", "history_text": "Hello world"}
        response = self.client.post("/process", json=payload)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "success")

    @patch("main.process_memory_event")
    def test_pubsub_endpoint(self, mock_process):
        mock_process.return_value = {"status": "success", "facts_stored": 1}
        payload = {"thread_id": "thread-123", "agent_id": "lira", "history_text": "Hello world"}
        response = self.client.post("/pubsub/memory-events", json=payload)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "success")


if __name__ == "__main__":
    unittest.main()
