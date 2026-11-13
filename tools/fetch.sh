#!/bin/sh
# Downloads the raw OSM data for the map area (Kreuzberg SO36) from Overpass.
cd "$(dirname "$0")/.." && curl -s -A "osm-game-builder/0.1" --data-urlencode data@tools/query.overpassql https://overpass-api.de/api/interpreter -o data/raw.json
