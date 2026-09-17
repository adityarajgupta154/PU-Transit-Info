export const mapConfig = {
  defaultCenter: [22.3072, 73.1812] as [number, number], // Vadodara Coordinates
  defaultZoom: 13,
  // OpenFreeMap vector style: free, no API key. Swap the URL for a keyed provider (MapTiler, Stadia, Protomaps) if an SLA is needed later.
  basemapStyleUrl: 'https://tiles.openfreemap.org/styles/positron',
  vadodaraBounds: {
      north: 22.45,
      south: 22.15,
      east: 73.40,
      west: 72.95
  }
};