
// Import the functions you need from the SDKs you need
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, set, onValue, push, remove, update }
    from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

// Your web app's Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyBt7ec4oJvJWMfGFiloM0ABzZmc-SrqSzY",
    authDomain: "transport-38881.firebaseapp.com",
    projectId: "transport-38881",
    storageBucket: "transport-38881.firebasestorage.app",
    messagingSenderId: "817338248122",
    appId: "1:817338248122:web:90f3e1b7a3f981de778b83",
    databaseURL: "https://transport-38881-default-rtdb.asia-southeast1.firebasedatabase.app/"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// Google Maps Configuration
export const googleMapsConfig = {
    apiKey: "AIzaSyCo_BKO6K3pxVu3SNjQBtwaCzaexRUlFbk",
    defaultCenter: { lat: 22.3072, lng: 73.1812 },
    defaultZoom: 12,
    restriction: {
        latLngBounds: {
            north: 22.45,
            south: 22.15,
            east: 73.40,
            west: 72.95,
        },
        strictBounds: false
    }
};

// Make it available globally for script tags in HTML
window.googleMapsConfig = googleMapsConfig;

// Export services for use in other modules
export { app, db, ref, set, onValue, push, remove, update };
