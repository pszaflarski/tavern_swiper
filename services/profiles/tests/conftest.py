import sys
import os
from unittest.mock import patch

# Add the service directory to sys.path so 'from main import app' works during testing
service_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
if service_dir not in sys.path:
    sys.path.insert(0, service_dir)

# Globally mock the PublisherClient to avoid hanging on network calls
# during module-level initialization in main.py
patch("google.cloud.pubsub_v1.PublisherClient").start()
