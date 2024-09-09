let isTracking = false;
let watchId = null;
let locationData = [];
let map = null;
let marker = null;
let polyline = null;
/** @type {Route?} */ let currentRoute = null;

/**
 *
 * @param {Number} number
 * @returns {String}
 */
function humanize(number) {
  return number.toLocaleString("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
    compactDisplay: "short",
    useGrouping: false,
  });
}

const secondUnits = {
  d: 86400,
  h: 3600,
  m: 60,
  s: 1,
};

/**
 *
 * @param {Number} number
 * @returns {String}
 */
function humanizeSeconds(number) {
  let string = "";
  for (const unit of Object.keys(secondUnits)) {
    const conversion = secondUnits[unit];
    const amount = Math.floor(number / conversion);
    if (amount) {
      if (string.length) string += ", ";
      string += `${amount} ${unit}`;
    }
    number %= conversion;
  }
  return string;
}
class Coordinate {
  /**
   *
   * @param {Number} lat
   * @param {Number} lon
   * @param {Date?} timestamp
   */
  constructor(lat, lon, timestamp = null) {
    this.lat = lat;
    this.lon = lon;
    this.timestamp = timestamp || new Date();
  }
}

/**
 *
 * @param {Coordinate} pointA
 * @param {Coordinate} pointB
 * @returns {Number} haversine distance
 */
function haversine(pointA, pointB) {
  const R = 6371;

  const pointALatRad = (pointA.lat * Math.PI) / 180;
  const pointALonRad = (pointA.lon * Math.PI) / 180;
  const pointBLatRad = (pointB.lat * Math.PI) / 180;
  const pointBLonRad = (pointB.lon * Math.PI) / 180;

  const latDelta = pointBLatRad - pointALatRad;
  const lonDelta = pointBLonRad - pointALonRad;

  const a =
    Math.sin(latDelta / 2) * Math.sin(latDelta / 2) +
    Math.cos(pointALatRad) *
      Math.cos(pointBLatRad) *
      Math.sin(lonDelta / 2) *
      Math.sin(lonDelta / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  const distance = R * c;
  return distance;
}

class Route {
  /**
   *
   * @param {Number?} id
   * @param {Date?} created
   * @param {Coordinate[]?} coordinates
   */
  constructor(id = null, created = null, coordinates = null) {
    this.id = id;
    this.created = created || new Date();
    this.coordinates = coordinates || [];
  }

  /**
   * Add coordinate
   * @param {Number} lat
   * @param {Number} lon
   */
  add(lat, lon) {
    this.coordinates.push(new Coordinate(lat, lon));
  }

  /**
   * Get total length of the route.
   * @returns {Number} distance in km
   */
  getLength() {
    let totalDistance = 0;
    if (this.coordinates.length < 2) return totalDistance;
    for (let i = 1; i < this.coordinates.length; i++) {
      totalDistance += haversine(this.coordinates[i - 1], this.coordinates[i]);
    }
    return totalDistance;
  }

  /**
   * Get the duration of the route (time distance between first and last coordinate).
   * @returns {Number} duration in seconds
   */
  getDuration() {
    if (this.coordinates.length < 2) return 0;
    return (
      (this.coordinates[this.coordinates.length - 1].timestamp.getTime() -
        this.coordinates[0].timestamp.getTime()) /
      1000
    );
  }

  /**
   * Get average speed in km/h.
   */
  getAvgSpeed() {
    if (this.coordinates.length < 2) return 0;
    return this.getLength() / (this.getDuration() / 3600);
  }

  /**
   * Pretty-print the route.
   * @returns {String}
   */
  toHtml() {
    let coordinates = this.coordinates.slice(-10, -1).reverse();
    let ellipsis = this.coordinates.length > 9 ? "<li>...</li>" : "";
    return `
    <h2>${this.created.toLocaleString()}</h2>
    <p><strong>Distance: </strong>${humanize(this.getLength())}&nbsp;km</p>
    <p><strong>Duration: </strong>${humanizeSeconds(this.getDuration())}</p>
    <p><strong>Avg. Speed: </strong>${humanize(
      this.getAvgSpeed()
    )}&nbsp;km/h</p>
    <ul id="locationList">
        ${coordinates
          .map(
            (coord) =>
              `<li>[${coord.timestamp.toLocaleString()}] Lat: ${
                coord.lat
              }, Lon: ${coord.lon}</li>`
          )
          .join("")}
          ${ellipsis}
    </ul>
    `;
  }

  /**
   *
   * @param {Object} obj
   * @returns {Route}
   */
  static fromPlainObject(obj) {
    const coordinates = obj.coordinates.map(
      (coord) => new Coordinate(coord.lat, coord.lon, coord.timestamp)
    );
    const route = new Route(obj.id, obj.created, coordinates);
    return route;
  }
}

class RouteDatabase {
  /**
   *
   * @param {Number?} version
   */
  constructor(version) {
    this.version = version;
    this.isOpen = false;
  }

  /**
   *
   * @returns {Promise<IDBDatabase>}
   */
  #open() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("RoutesDB", this.version);
      request.onupgradeneeded = function (event) {
        const db = event.target.result;
        if (!db.objectStoreNames.contains("routes")) {
          const store = db.createObjectStore("routes", {
            keyPath: "id",
            autoIncrement: true,
          });
          store.createIndex("created", "created", { unique: false });
        }
      };

      request.onsuccess = function (event) {
        resolve(event.target.result);
      };

      request.onerror = function (event) {
        reject("Database error: " + event.target.errorCode);
      };
    });
  }

  /**
   * @param {IDBDatabase} db
   * @param {Route} route
   */
  async insertRoute(route) {
    route = { ...route };
    if (route.id === null) delete route.id;
    const db = await this.#open();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(["routes"], "readwrite");
      const store = transaction.objectStore("routes");

      console.log({ route });
      const request = store.add(route);

      request.onsuccess = function () {
        console.log("Route saved with id: " + request.result);
        db.close();
        resolve("Route added with id: " + request.result);
      };

      request.onerror = function () {
        db.close();
        reject("Error adding route: " + request.error);
      };
    });
  }

  /**
   *
   * @returns {Promise<Route[]>}
   */
  async listRoutes() {
    const db = await this.#open();
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(["routes"], "readonly");
      const store = transaction.objectStore("routes");

      const request = store.getAll();

      request.onsuccess = function () {
        resolve(request.result.map((route) => Route.fromPlainObject(route)));
      };

      request.onerror = function () {
        reject("Error listing routes" + request.error);
      };
    });
  }
}

function initializeMap() {
  // Center the map on an initial location (lat, lng)
  map = L.map("map").setView([51.505, -0.09], 13);

  // Add OSM tile layer
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors",
  }).addTo(map);

  // Initialize polyline for tracking the route
  polyline = L.polyline([], { color: "blue" }).addTo(map);
}

async function toggleTracking() {
  const button = document.getElementById("toggleTracking");
  const status = document.getElementById("status");

  if (!isTracking) {
    if ("geolocation" in navigator) {
      button.textContent = "Stop Tracking";
      status.textContent = "Tracking...";
      currentRoute = new Route();

      // Start watching the location
      watchId = navigator.geolocation.watchPosition(
        async (position) => {
          const { latitude, longitude } = position.coords;
          const newLocation = { lat: latitude, lng: longitude };
          locationData.push(newLocation);
          currentRoute.add(latitude, longitude);
          //   updateLocationList();
          updateMap(newLocation);
          updateRouteDescription();
        },
        (error) => {
          console.error("Error getting location", error);
          status.textContent = "Error retrieving location";
        },
        { enableHighAccuracy: true }
      );
      isTracking = true;
    } else {
      alert("Geolocation is not supported by your browser.");
    }
  } else {
    // Stop tracking
    const routeDb = new RouteDatabase();
    await routeDb.insertRoute(currentRoute);
    navigator.geolocation.clearWatch(watchId);
    await updatePreviousRoutesList();
    button.textContent = "Start Tracking";
    status.textContent = "Not tracking";
    isTracking = false;
  }
}

function updateLocationList() {
  const locationList = document.getElementById("locationList");
  locationList.innerHTML = "";

  locationData.forEach((location, index) => {
    const listItem = document.createElement("li");
    listItem.textContent = `Location ${index + 1}: Lat ${location.lat}, Lng ${
      location.lng
    }`;
    locationList.appendChild(listItem);
  });
}

function updateRouteDescription() {
  if (!currentRoute) return;
  const routeDescription = document.getElementById("routeDescription");
  routeDescription.innerHTML = currentRoute.toHtml();
}

function updateMap(location) {
  if (!map) {
    initializeMap();
  }

  // Update marker and center the map on the new location
  if (marker) {
    marker.setLatLng([location.lat, location.lng]);
  } else {
    marker = L.marker([location.lat, location.lng]).addTo(map);
  }

  map.setView([location.lat, location.lng], 13);

  // Add the location to the polyline
  polyline.addLatLng([location.lat, location.lng]);
}

async function updatePreviousRoutesList() {
  const routesStats = document.getElementById("routesStats");
  const previousRoutes = document.getElementById("previousRoutes");
  const routeDb = new RouteDatabase();
  const routes = (await routeDb.listRoutes()).reverse();
  const stats = routes.reduce(
    (prev, current) => {
      prev.avgSpeedCount += 1;
      prev.avgSpeedSum += current.getAvgSpeed();
      prev.totalDuration += current.getDuration();
      prev.totalLength += current.getLength();
      return prev;
    },
    { totalLength: 0, avgSpeedSum: 0, avgSpeedCount: 0, totalDuration: 0 }
  );

  routesStats.innerHTML = `
  <p><strong>Total length: </strong>${humanize(stats.totalLength)}&nbsp;km</p>
  <p><strong>Total duration: </strong>${humanizeSeconds(
    stats.totalDuration
  )}</p>
  <p><strong>Average speed: </strong>${humanize(
    stats.avgSpeedSum / stats.avgSpeedCount
  )}&nbsp;km/h</p>
  `;

  previousRoutes.innerHTML = routes
    .map((route) =>
      route.coordinates.length > 1
        ? `<h3>${route.created.toLocaleString()}</h3><p>${humanize(
            route.getLength()
          )}&nbsp;km in ${humanizeSeconds(route.getDuration())}</p>`
        : ``
    )
    .join("");
}
