// Archived configuration; the exposed ORS credential has been removed.
// The current app uses the authenticated /api/geo proxy, not this snapshot.
export const mapConfig = {
    defaultCenter: [22.3072, 73.1812], // Vadodara Coordinates [lat, lng]
    defaultZoom: 13,
    tileLayerUrl: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    tileLayerAttribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    vadodaraBounds: {
        north: 22.45,
        south: 22.15,
        east: 73.40,
        west: 72.95
    }
};