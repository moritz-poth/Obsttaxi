[out:json][timeout:120];
(
  way["highway"](52.4900,13.4050,52.5075,13.4470);
  way["building"](52.4900,13.4050,52.5075,13.4470);
  relation["building"](52.4900,13.4050,52.5075,13.4470);
  way["leisure"~"park|playground|pitch"](52.4900,13.4050,52.5075,13.4470);
  way["landuse"~"grass|recreation_ground|cemetery|allotments"](52.4900,13.4050,52.5075,13.4470);
  way["natural"="water"](52.4900,13.4050,52.5075,13.4470);
  relation["natural"="water"](52.4900,13.4050,52.5075,13.4470);
);
out geom;
