// Admin Route Management Logic
import { db, ref, set, remove, onValue } from "./firebase-config.js";
import { mapConfig } from "./map-config.js";

let map;
let routeLayer;
let currentPathData = []; // Array of {lat, lng}
let currentStops = []; // Array of {name, lat, lng}
let stopMarkers = [];
let savedRoutes = {};

document.addEventListener('DOMContentLoaded', () => {
    initMap();
    loadSavedRoutes();

    document.getElementById('generateBtn').addEventListener('click', generateRoute);
    document.getElementById('saveRouteBtn').addEventListener('click', saveRouteData);
    document.getElementById('clearBtn').addEventListener('click', resetForm);
});

function initMap() {
    const mapElement = document.getElementById("adminMap");
    if (!mapElement) return;

    // Initialize Leaflet Map
    map = L.map(mapElement).setView(mapConfig.defaultCenter, mapConfig.defaultZoom);

    // Add OpenStreetMap Tile Layer
    L.tileLayer(mapConfig.tileLayerUrl, {
        attribution: mapConfig.tileLayerAttribution
    }).addTo(map);

    // Map Click Listener to Add Named Stop
    map.on('click', (e) => {
        addStop(e.latlng);
    });
}

async function generateRoute() {
    const originInput = document.getElementById('originInput').value;
    const destInput = document.getElementById('destInput').value;

    if (!originInput || !destInput) {
        alert("Please enter both Origin and Destination");
        return;
    }

    try {
        // 1. Geocode Origin
        const originCoords = await geocodeLocation(originInput);
        if (!originCoords) throw new Error(`Could not find location: ${originInput}`);

        // 2. Geocode Destination
        const destCoords = await geocodeLocation(destInput);
        if (!destCoords) throw new Error(`Could not find location: ${destInput}`);

        // 3. Get Route from ORS
        await getRouteFromORS(originCoords, destCoords);

    } catch (error) {
        alert(error.message);
        console.error("Route generation failed:", error);
    }
}

async function geocodeLocation(query) {
    // 1. Force search bias towards Vadodara
    const searchQuery = query.toLowerCase().includes("vadodara") ? query : `${query}, Vadodara`;

    console.log(`Searching for: ${searchQuery}`);

    const url = `https://api.openrouteservice.org/geocode/search?api_key=${mapConfig.orsApiKey}&text=${encodeURIComponent(searchQuery)}&boundary.country=IN&focus.point.lat=${mapConfig.defaultCenter[0]}&focus.point.lon=${mapConfig.defaultCenter[1]}`;

    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error("Geocoding API failed");

        const data = await response.json();

        if (data.features && data.features.length > 0) {
            // ORS returns [lng, lat]
            const [lng, lat] = data.features[0].geometry.coordinates;

            // 2. Validate Boundary
            if (isLocationInVadodara(lat, lng)) {
                return [lng, lat];
            } else {
                throw new Error(`Location "${query}" is outside Vadodara. Please select a location within the city.`);
            }
        }
        return null;
    } catch (error) {
        throw error; // Propagate error to be caught in generating function
    }
}

function isLocationInVadodara(lat, lng) {
    const bounds = mapConfig.vadodaraBounds;
    return lat >= bounds.south && lat <= bounds.north &&
        lng >= bounds.west && lng <= bounds.east;
}

async function getRouteFromORS(startCoords, endCoords) {
    // startCoords and endCoords are [lng, lat]
    const url = `https://api.openrouteservice.org/v2/directions/driving-car/geojson`;

    const body = {
        coordinates: [startCoords, endCoords]
    };

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': mapConfig.orsApiKey,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        throw new Error(`OpenRouteService API Error: ${response.statusText}`);
    }

    const data = await response.json();

    if (data.features && data.features.length > 0) {
        const geometry = data.features[0].geometry;
        // ORS returns [lng, lat], Leaflet needs [lat, lng]

        // Extract coordinates for storage (flip to {lat, lng})
        currentPathData = geometry.coordinates.map(coord => ({
            lat: coord[1],
            lng: coord[0]
        }));

        console.log(`Extracted ${currentPathData.length} path coordinates.`);

        // Draw on Map
        if (routeLayer) map.removeLayer(routeLayer);

        // L.geoJSON handles coordinates automatically without manual flipping
        routeLayer = L.geoJSON(data, {
            style: {
                color: '#4f46e5',
                weight: 6,
                opacity: 0.8
            }
        }).addTo(map);

        map.fitBounds(routeLayer.getBounds());

    } else {
        throw new Error("No route found between these locations.");
    }
}

function addStop(latlng) {
    // Validate Click Location
    if (!isLocationInVadodara(latlng.lat, latlng.lng)) {
        alert("Cannot add stop: Location is outside Vadodara city limits.");
        return;
    }

    const stopName = prompt("Enter Bus Stop Name:");
    if (!stopName) return;

    // Save stop data
    currentStops.push({
        name: stopName,
        lat: latlng.lat,
        lng: latlng.lng
    });

    // Add Leaflet Marker
    const marker = L.marker([latlng.lat, latlng.lng]).addTo(map)
        .bindTooltip(stopName, {
            permanent: true,
            direction: 'top',
            className: 'map-label'
        }).openTooltip();

    stopMarkers.push(marker);
}

function saveRouteData() {
    const busNumber = document.getElementById('busNumber').value;
    const shift = document.getElementById('shiftSelect').value;

    if (!shift) {
        alert("Please select a Shift");
        return;
    }
    if (!busNumber) {
        alert("Please enter a Bus Number");
        return;
    }
    if (currentPathData.length === 0) {
        alert("Please generate a route first");
        return;
    }

    // Save structure directly to routes/BUS_NUMBER
    // Note: To support multiple shifts for same bus, we might need a composite key or sub-collection.
    // The requirement says "Extend existing route storage structure by adding shift field".
    // If a bus runs on multiple shifts, saving with busNumber as key will overwrite.
    // However, adhering to "Do NOT change existing database structure except adding shift field", I will add the field.
    // If the USER intends 1 route per bus per shift, we'd need ID like `BUS_NUM_SHIFT`.
    // Given the prompt "routes/BUS_NUMBER/shift", it implies 1 active route per bus, having a shift property.
    // Or it might imply nested, but "Extend... adding shift field" suggests simple addition.
    // Let's assume unique Bus Number for now or that it overwrites (as per current structure).

    // Actually, "routes/BUS_NUMBER/shift" implies the 'shift' is a child of 'BUS_NUMBER'.

    set(ref(db, 'routes/' + busNumber), {
        busNumber: busNumber,
        shift: shift,
        path: currentPathData,
        stops: currentStops,
        timestamp: Date.now()
    })
        .then(() => {
            alert(`Route saved successfully for Bus ${busNumber} (${shift})`);
            resetForm();
        })
        .catch(err => alert("Error saving: " + err.message));
}

function resetForm() {
    document.getElementById('busNumber').value = '';
    document.getElementById('shiftSelect').value = '';
    document.getElementById('originInput').value = '';
    document.getElementById('destInput').value = '';
    currentPathData = [];
    currentStops = [];

    // Clear map layers
    if (routeLayer) map.removeLayer(routeLayer);
    stopMarkers.forEach(m => map.removeLayer(m));
    stopMarkers = [];
}

function loadSavedRoutes() {
    const routesRef = ref(db, 'routes');
    onValue(routesRef, (snapshot) => {
        const data = snapshot.val();
        savedRoutes = data || {};
        renderRoutesList(savedRoutes);
    });
}

function renderRoutesList(routes) {
    const tbody = document.getElementById('routesTableBody');
    tbody.innerHTML = '';

    Object.keys(routes).forEach(key => {
        const route = routes[key];
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="padding: 1rem;">
                <div style="font-weight: bold;">${route.busNumber || key}</div>
                <div style="font-size: 0.8rem; color: var(--text-muted);">${route.shift || 'No Shift'}</div>
            </td>
            <td style="padding: 1rem;">${route.stops ? route.stops.length : 0} Stops</td>
            <td style="padding: 1rem;">
                <button class="btn btn-secondary edit-btn" data-id="${key}" style="padding: 0.25rem 0.75rem; font-size: 0.8rem; background: rgba(14, 165, 233, 0.2); border-color: var(--primary-color); color: var(--primary-color); margin-right: 0.5rem;">
                    <i class="fa-solid fa-pen"></i>
                </button>
                 <button class="btn btn-secondary delete-btn" data-id="${key}" style="padding: 0.25rem 0.75rem; font-size: 0.8rem; background: rgba(239, 68, 68, 0.2); border-color: var(--danger); color: var(--danger);">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </td>
        `;
        tr.style.borderBottom = '1px solid rgba(148, 163, 184, 0.2)';
        tbody.appendChild(tr);
    });

    document.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', function () {
            const id = this.getAttribute('data-id');
            if (confirm(`Delete route for ${id}?`)) {
                remove(ref(db, 'routes/' + id));
            }
        });
    });

    document.querySelectorAll('.edit-btn').forEach(btn => {
        btn.addEventListener('click', function () {
            const id = this.getAttribute('data-id');
            editRoute(id);
        });
    });
}

function editRoute(busNumber) {
    const route = savedRoutes[busNumber];
    if (!route) {
        alert("Route data not found!");
        return;
    }

    if (confirm(`Edit route for ${busNumber}? Unsaved changes will be lost.`)) {
        // 1. Populate Form
        document.getElementById('busNumber').value = route.busNumber;
        document.getElementById('shiftSelect').value = route.shift;
        // Origin/Dest are not stored in route object, so we leave them blank or maybe set placeholders
        document.getElementById('originInput').value = '';
        document.getElementById('destInput').value = '';

        // 2. Restore Global Data
        currentPathData = route.path || [];
        currentStops = route.stops || [];

        // 3. Visualize on Map
        // Clear existing layers
        if (routeLayer) map.removeLayer(routeLayer);
        stopMarkers.forEach(m => map.removeLayer(m));
        stopMarkers = [];

        // Draw Path
        if (currentPathData.length > 0) {
            // Reconstruct GeoJSON feature for L.geoJSON
            // stored path is {lat, lng}, need to flip to [lng, lat] for GeoJSON
            const coordinates = currentPathData.map(p => [p.lng, p.lat]);
            const geoJsonData = {
                "type": "FeatureCollection",
                "features": [
                    {
                        "type": "Feature",
                        "geometry": {
                            "type": "LineString",
                            "coordinates": coordinates
                        }
                    }
                ]
            };

            routeLayer = L.geoJSON(geoJsonData, {
                style: {
                    color: '#0ea5e9', // Sky Blue
                    weight: 6,
                    opacity: 0.8
                }
            }).addTo(map);

            map.fitBounds(routeLayer.getBounds());
            alert(`Editing Route: ${busNumber}. You can now add/remove stops or regenerate path.`);
        }

        // Draw Stops
        currentStops.forEach(stop => {
            const marker = L.marker([stop.lat, stop.lng]).addTo(map)
                .bindTooltip(stop.name, {
                    permanent: true,
                    direction: 'top',
                    className: 'map-label'
                }).openTooltip();
            stopMarkers.push(marker);
        });

        // Scroll to form
        document.querySelector('.glass-card').scrollIntoView({ behavior: 'smooth' });
    }
}
