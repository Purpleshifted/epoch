"""Probe the local Sprite Lab search API for the 18 natural items (feasibility check, not part of the build).

Usage: python3 tools/sprites/probe_natural.py   (dev server on :3000)
Prints, per term: files scanned, files kept after licence + relevance filters, first titles.
"""
import json
import time
import urllib.parse
import urllib.request

TERMS = [
    "leaf", "flower petal", "mushroom", "seed", "grass", "twig", "tree bark", "insect", "small fish",
    "feather", "animal fur", "bird bone", "animal bone", "tooth", "snail shell", "crab", "sea urchin", "coral",
]

for t in TERMS:
    url = "http://localhost:3000/api/sprites/search?term=" + urllib.parse.quote(t) + "&limit=8"
    try:
        with urllib.request.urlopen(url, timeout=90) as r:
            d = json.load(r)
        res = d.get("results", [])
        print(f"{t:14s} scanned={d.get('scanned')} kept={len(res)}", [x["title"][:30] for x in res[:3]], flush=True)
    except Exception as e:  # noqa: BLE001
        print(f"{t:14s} ERROR {e}", flush=True)
    time.sleep(1.5)
