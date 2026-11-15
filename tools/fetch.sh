#!/bin/sh
# Downloads the raw data for the map area (Kreuzberg SO36) into data/:
#  - OpenStreetMap (Overpass): streets, buildings, trees, signals, U-Bahn
#  - Berlin LOR district regions (Bezirksregionen) from gdi.berlin.de
#  - Berlin police crime atlas (Kriminalitätsatlas, PKS) from berlin.de
set -e
cd "$(dirname "$0")/.."
curl -sf -A "osm-game-builder/0.1" --data-urlencode data@tools/query.overpassql https://overpass-api.de/api/interpreter -o data/raw.json
curl -sf -o data/bzr.json "https://gdi.berlin.de/services/wfs/lor_2021?service=WFS&version=2.0.0&request=GetFeature&typeNames=lor_2021:b_lor_bzr_2021&outputFormat=application/json&srsName=EPSG:4326&bbox=52.49,13.405,52.5075,13.447,urn:ogc:def:crs:EPSG::4326"
curl -sf -o data/crime.xlsx https://www.berlin.de/polizei/_assets/dienststellen/lka/fallzahlen_hz-2016-2025.xlsx
# xlsx is a zip; build-map.mjs reads the shared strings + workbook index + sheets
rm -rf data/crime && mkdir data/crime && unzip -q -o data/crime.xlsx 'xl/sharedStrings.xml' 'xl/workbook.xml' 'xl/_rels/workbook.xml.rels' 'xl/worksheets/*' -d data/crime
