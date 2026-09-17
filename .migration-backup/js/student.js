// Student Dashboard Logic (Admin-Controlled Routes)
import { db, ref, onValue } from "./firebase-config.js";
import { mapConfig } from "./map-config.js";

let routeData = {};
let map;
let routeLayer;
let stopMarkers = [];
let userMarker;
let puMarker;

document.addEventListener('DOMContentLoaded', () => {
    initMap();
    fetchRoutes();
});


function initMap() {
    const mapElement = document.getElementById("map");
    if (!mapElement) return;

    // Initialize Leaflet Map
    map = L.map(mapElement).setView(mapConfig.defaultCenter, mapConfig.defaultZoom);

    // Add OpenStreetMap Tile Layer
    L.tileLayer(mapConfig.tileLayerUrl, {
        attribution: mapConfig.tileLayerAttribution
    }).addTo(map);

    // Fixed Marker for Parul University
    const puLocation = [22.2887, 73.3637];

    // Custom Icon for University
    const universityIcon = L.divIcon({
        html: '<i class="fa-solid fa-graduation-cap" style="color: #ea4335; font-size: 24px;"></i>',
        className: 'custom-div-icon',
        iconSize: [24, 24],
        iconAnchor: [12, 12]
    });

    puMarker = L.marker(puLocation, { icon: universityIcon }).addTo(map)
        .bindPopup('<div style="color: black; font-weight: bold;">Parul University<br><span style="font-weight: normal; font-size: 0.9em;">Central Campus</span></div>');

    // Get student current location
    if (navigator.geolocation) {
        navigator.geolocation.watchPosition(
            (position) => {
                const userLocation = [position.coords.latitude, position.coords.longitude];

                if (userMarker) {
                    userMarker.setLatLng(userLocation);
                } else {
                    const userIcon = L.divIcon({
                        html: '<i class="fa-solid fa-circle-user" style="color: #22c55e; font-size: 24px; background: white; border-radius: 50%;"></i>',
                        className: 'custom-div-icon',
                        iconSize: [24, 24],
                        iconAnchor: [12, 12]
                    });

                    userMarker = L.marker(userLocation, { icon: userIcon }).addTo(map)
                        .bindPopup("You are here");
                }
            },
            (error) => {
                console.error("User location error:", error);
            },
            { enableHighAccuracy: true }
        );
    }
}

function fetchRoutes() {
    // Initial load - just get data reference. 
    // We don't populate a dropdown anymore, we search on demand.
    const routesRef = ref(db, 'routes');

    // Listen to changes to keep local data fresh
    onValue(routesRef, (snapshot) => {
        const data = snapshot.val();
        routeData = data || {};
    });

    const searchBtn = document.getElementById('searchRouteBtn');
    searchBtn.addEventListener('click', searchAndDrawRoute);
}

function searchAndDrawRoute() {
    const shift = document.getElementById('shiftSelect').value;
    const busNumber = document.getElementById('busNumberInput').value.trim();

    if (!shift) {
        alert("Please select a valid Shift.");
        return;
    }

    if (!busNumber) {
        alert("Please enter a Bus Number.");
        return;
    }

    // Search logic: Looking for a route that matches Bus Number AND Shift
    // Since we store routes by busNumber in Firebase (e.g. routes/GJ-01-XX-1234), we can lookup directly.

    const route = routeData[busNumber];

    if (!route) {
        alert(`No route found for Bus ${busNumber}.`);
        updateInfoPanel(null);
        return;
    }

    // Check if shift matches
    if (route.shift !== shift) {
        alert(`Bus ${busNumber} is not scheduled for ${shift}. matching shift: ${route.shift || 'None'}`);
        updateInfoPanel(null);
        return;
    }

    // If match found
    drawRoute(busNumber);
    updateInfoPanel(busNumber);
}

function drawRoute(routeId) {
    const route = routeData[routeId];
    if (!route) return;

    // Clear existing layers
    if (routeLayer) map.removeLayer(routeLayer);

    stopMarkers.forEach(m => map.removeLayer(m));
    stopMarkers = [];

    // 1. Draw Polyline from Saved Path
    if (route.path) {
        // route.path is array of {lat, lng} objects. Leaflet L.polyline accepts array of [lat, lng] arrays or objects {lat, lng}
        // So we can pass it directly if format matches, but let's ensure it is {lat, lng} or [lat, lng]

        // Ensure pathCoordinates is in a format Leaflet accepts
        const pathCoordinates = route.path.map(p => [p.lat, p.lng]);

        routeLayer = L.polyline(pathCoordinates, {
            color: '#4f46e5',
            weight: 5,
            opacity: 0.8
        }).addTo(map);

        // Fit bounds
        map.fitBounds(routeLayer.getBounds());
    }

    // 2. Draw Stops
    if (route.stops) {
        route.stops.forEach((stop, index) => {
            // Leaflet default marker

            // Or custom number marker
            const stopIcon = L.divIcon({
                html: `<div style="background-color: #ea4335; color: white; width: 20px; height: 20px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: bold; border: 2px solid white;">${index + 1}</div>`,
                className: 'custom-div-icon',
                iconSize: [24, 24],
                iconAnchor: [12, 12]
            });

            const marker = L.marker([stop.lat, stop.lng], { icon: stopIcon }).addTo(map);

            marker.bindPopup(`<div style="color:black; font-weight:bold;">${stop.name}</div>`);

            stopMarkers.push(marker);
        });
    }
}

function updateInfoPanel(routeId) {
    if (!routeId) {
        document.getElementById('busStatus').innerHTML = '<p style="text-align: center; color: var(--text-muted);">Select a route to view status</p>';
        return;
    }

    const route = routeData[routeId];
    // if (!route) return; // Already handled above

    const routeName = route.busNumber || route.name || "Unknown Route";

    document.getElementById('busStatus').innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center;">
            <div>
                <span style="font-weight: 600; color: #4f46e5; display: block;"><i class="fa-solid fa-bus"></i> ${routeName}</span>
                <small style="color: var(--text-muted);">${route.shift || ''}</small>
            </div>
            <span class="badge" style="position: static; background: var(--success);">Active Route</span>
        </div>
        <div style="margin-top: 1rem;">
            <p style="color: var(--text-muted); font-size: 0.9rem; margin-bottom: 0.5rem;"><i class="fa-solid fa-map-pin"></i> Stops:</p>
            <ul style="list-style: none; padding-left: 0; color: var(--text-main); font-size: 0.9rem;">
                ${route.stops ? route.stops.map((s, i) => `<li style="margin-bottom: 4px; display: flex; align-items: center;"><span style="width: 20px; height: 20px; border-radius: 50%; background: #0ea5e9; display: inline-flex; justify-content: center; align-items: center; margin-right: 8px; font-size: 0.7rem; color: white;">${i + 1}</span> ${s.name}</li>`).join('') : '<li style="color: var(--text-muted);">No stops defined</li>'}
            </ul>
        </div>
    `;
}
