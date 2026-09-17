# 🚌 PU Transit - Smart University Bus Tracking System

**PU Transit** is a comprehensive, real-time transportation management solution designed specifically for Parul University. It bridges the gap between the transport administration and students by providing a seamless, digital platform for route planning and live tracking.

This project replaces manual schedule charts with an interactive, map-based experience, ensuring students can easily find their bus, view the exact route, and know precisely where stops are located.

---

## 🌐 Live Demo
👉 https://pu-transit.vercel.app/

---

## 🔥 Key Highlights

- Vadodara-only geolocation restriction  
- Shift-based bus filtering system  
- Open-source mapping architecture (Leaflet + OpenRouteService)  
- Real-time Firebase sync  
- Lightweight framework-free design  

---

## 🚀 Future Enhancements

- Live bus GPS tracking  
- Driver mobile application  
- Push notifications for bus arrival  
- Route analytics dashboard  
- Multi-university support  

---

## 🏛️ Project Architecture & Workflow

The system is built on a **Serverless Architecture** using Firebase for real-time data syncing and Leaflet.js for open-source mapping.

### 🔄 Data Flow
1.  **Admin Creation**: The Transport Admin logs in and uses the dashboard to create a route. They enter an *Origin* and *Destination*.
2.  **Route Calculation**: The system calls the **OpenRouteService API** to calculate the best driving path between these points.
3.  **Customization**: The Admin sees the calculated route on the map and clicks on specific points along the blue polyline to add **Bus Stops** (e.g., "Amit Circle", "Kala Ghora").
4.  **Storage**: When saved, the entire route object—containing the path coordinates (Latitude/Longitude array), Stop markers, Bus Number, and Shift—is pushed to the **Firebase Realtime Database**.
5.  **Student Access**: A student opens the app, selects their Shift (e.g., "Morning Shift") and enters their Bus Number.
6.  **Real-Time Retrieval**: The app queries Firebase. If the bus matches the shift, it instantly downloads and renders the route path and stops on the student's map.
7.  **Live Updates**: Any change made by the Admin (e.g., changing a stop location) is instantly reflected on the Student's screen without refreshing.

---

## 🌟 Detailed Features

### 🎓 Student Portal (`student.html`)
Designed for simplicity and speed on mobile devices.
*   **Smart Search**: Students verify their bus by `Shift` + `Bus Number` to avoid confusion between buses with the same number running different shifts.
*   **Visual Route Tracking**: Instead of just text, students see a **Polyline Path** on the map showing the exact road the bus will take.
*   **Stop Details**: Numbered markers (1, 2, 3...) indicate the sequence of stops. Clicking a stop reveals its name.
*   **Live User Location**: Uses the device's GPS (`navigator.geolocation`) to show the student's current position relative to the bus stops, helping them navigate to the nearest pickup point.
*   **University Marker**: A fixed anchor point showing Parul University for orientation.

### 🛡️ Admin Dashboard (`admin.html`)
A powerful desktop-optimized control center.
*   **Authentication**: Simple password-based entry to prevent unauthorized access.
*   **Intelligent Geocoding**:
    *   Inputting "Alkapuri" automatically searches logic biased towards **Vadodara**, preventing results from other cities.
    *   Validates that points are within city limits to prevent erroneous routes.
*   **Route Generator**:
    *   Uses **ORS Directions API** to snap routes to roads (not just straight lines).
    *   Calculates geometry automatically.
*   **CRUD Operations**:
    *   **Create**: Generate and save new routes.
    *   **Read**: View a list of all active buses.
    *   **Update**: Edit an existing route (loads the path back onto the map for modification).
    *   **Delete**: Remove obsolete routes.

---

## 🛠️ Technical Implementation Details

### Core Technologies
*   **Frontend**: Native HTML5, CSS3, JavaScript (ES6 Modules). No heavy frameworks (React/Angular) used to keep it lightweight.
*   **Styling**: Custom CSS with **Glassmorphism** effects (translucent cards, blur filters) for a modern UI.

### Integration Modules
| Module | Purpose | Implementation File |
| :--- | :--- | :--- |
| **Leaflet.js** | Rendering interactive maps and markers. | `js/map-config.js` |
| **OpenRouteService** | Geocoding (Address -> Coords) & Pathfinding. | `js/admin.js` |
| **Firebase Realtime DB** | JSON-based NoSQL cloud database for data persistence. | `js/firebase-config.js` |

### Database Structure
Data is stored in a simple JSON tree:
```json
{
  "routes": {
    "GJ-06-XX-1234": {
      "busNumber": "GJ-06-XX-1234",
      "shift": "First Shift",
      "path": [ {...}, {...} ],
      "stops": [
        { "name": "Stop A", "lat": 22.3, "lng": 73.1 },
        { "name": "Stop B", "lat": 22.4, "lng": 73.2 }
      ],
      "timestamp": 1700000000000
    }
  }
}
```

---

## 🚀 Getting Started

### Prerequisites
*   A Google Firebase account.
*   An OpenRouteService API Key (free tier available).

### Installation

1.  **Clone the Repository**
    ```bash
    git clone https://github.com/your-username/pu-transit.git
    cd pu-transit
    ```

2.  **Configure Firebase**
    *   Create a project in the Firebase Console.
    *   Enable Realtime Database.
    *   Paste credentials in `js/firebase-config.js`.

3.  **Configure Maps API**
    *   Get ORS API key.
    *   Paste in `js/map-config.js`.

4.  **Run Locally**
    *   Open `index.html` in browser.
    *   Recommended: Use Live Server.

---

## 📂 Project Structure

```
├── admin.html
├── index.html
├── student.html
├── css/
│   └── style.css
├── js/
│   ├── admin.js
│   ├── student.js
│   ├── firebase-config.js
│   └── map-config.js
└── README.md
```

---

## 📜 License
This project is open-source and available under the MIT License.

<p align="center">
  Built with ❤️ for Parul University
</p>
