// Driver Dashboard Logic
import { db, ref, update } from "./firebase-config.js";


let watchId = null;
let isTracking = false;

document.addEventListener('DOMContentLoaded', () => {
    // Check if user is logged in (Simulated)
    const loginSection = document.getElementById('loginSection');
    const dashboardSection = document.getElementById('dashboardSection');
    const loginBtn = document.getElementById('loginBtn');
    const toggleBtn = document.getElementById('toggleTrackingBtn');
    const logoutBtn = document.getElementById('logoutBtn');

    // Restore session if exists
    if (localStorage.getItem('driverBusId')) {
        showDashboard();
    }

    loginBtn.addEventListener('click', () => {
        const busId = document.getElementById('busIdInput').value;
        if (busId) {
            localStorage.setItem('driverBusId', busId);
            showDashboard();
        } else {
            alert('Please enter a Bus ID');
        }
    });

    logoutBtn.addEventListener('click', () => {
        stopTracking();
        localStorage.removeItem('driverBusId');
        showLogin();
    });

    toggleBtn.addEventListener('click', () => {
        if (isTracking) {
            stopTracking();
        } else {
            startTracking();
        }
    });
});

function showDashboard() {
    document.getElementById('loginSection').style.display = 'none';
    document.getElementById('dashboardSection').style.display = 'block';
    document.getElementById('displayBusId').innerText = localStorage.getItem('driverBusId');
}

function showLogin() {
    document.getElementById('loginSection').style.display = 'block';
    document.getElementById('dashboardSection').style.display = 'none';
}

function startTracking() {
    if (!navigator.geolocation) {
        alert("Geolocation is not supported by your browser");
        return;
    }

    const busId = localStorage.getItem('driverBusId');
    const statusEl = document.getElementById('statusIndicator');
    const toggleBtn = document.getElementById('toggleTrackingBtn');

    statusEl.innerHTML = '<span style="color: var(--primary-color);">Starting GPS...</span>';

    watchId = navigator.geolocation.watchPosition(
        (position) => {
            const { latitude, longitude } = position.coords;
            console.log(`Sending Location: ${latitude}, ${longitude}`);

            // Push location to Firebase
            // Using set() to overwrite the location for this busID
            update(ref(db, 'buses/' + busId), {
                lat: latitude,
                lng: longitude,
                timestamp: Date.now(),
                status: 'Active'
            });


            isTracking = true;
            statusEl.innerHTML = '<span style="color: var(--success);"><i class="fa-solid fa-wifi"></i> Online - Sharing Location</span>';
            toggleBtn.innerHTML = '<i class="fa-solid fa-stop"></i> Stop Tracking';
            toggleBtn.classList.replace('btn-primary', 'btn-secondary');
            toggleBtn.style.background = 'var(--danger)';
        },
        (error) => {
            console.error(error);
            statusEl.innerHTML = '<span style="color: var(--danger);">GPS Error</span>';
            isTracking = false;
        },
        {
            enableHighAccuracy: true,
            timeout: 5000,
            maximumAge: 0
        }
    );
}

function stopTracking() {
    if (watchId) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
    }
    isTracking = false;

    // Update status in Firebase to Offline
    const busId = localStorage.getItem('driverBusId');
    if (busId) {
        set(ref(db, 'buses/' + busId + '/status'), 'Offline');
    }

    const statusEl = document.getElementById('statusIndicator');
    const toggleBtn = document.getElementById('toggleTrackingBtn');

    statusEl.innerHTML = '<span style="color: var(--text-muted);">Offline</span>';
    toggleBtn.innerHTML = '<i class="fa-solid fa-play"></i> Start Tracking';
    toggleBtn.classList.replace('btn-secondary', 'btn-primary');
    toggleBtn.style.background = ''; // Reset
}
