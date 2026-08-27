"""
Pytest config for sprite-forge tool tests.
Adds the tools/ directory to sys.path so that test modules can import
the tool scripts directly (e.g. `from map_region_extract import ...`).
"""
import sys
from pathlib import Path

# tools/ directory (parent of this conftest.py)
TOOLS = Path(__file__).resolve().parent
if str(TOOLS) not in sys.path:
    sys.path.insert(0, str(TOOLS))
