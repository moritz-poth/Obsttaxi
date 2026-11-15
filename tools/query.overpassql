[out:json][timeout:300];
(
  way["highway"]({{bbox}});
  way["building"]({{bbox}});
  relation["building"]({{bbox}});
  way["leisure"~"park|playground|pitch"]({{bbox}});
  way["landuse"~"grass|recreation_ground|cemetery|allotments"]({{bbox}});
  way["natural"="water"]({{bbox}});
  relation["natural"="water"]({{bbox}});
  way["railway"~"subway|light_rail|rail"]({{bbox}});
  node["highway"~"traffic_signals|crossing|bus_stop"]({{bbox}});
  node["natural"="tree"]({{bbox}});
);
out geom;
