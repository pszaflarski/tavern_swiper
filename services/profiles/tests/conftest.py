import sys
import os

# Add the service directory to sys.path so 'from main import app' works during testing
service_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
if service_dir not in sys.path:
    sys.path.insert(0, service_dir)
