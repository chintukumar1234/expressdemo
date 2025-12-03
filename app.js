import express from "express";
import http from "http";
import { Server } from "socket.io";
import bodyParser from "body-parser";
import cors from "cors";
import { initializeApp } from "firebase/app";
import path from "path";
import { fileURLToPath } from "url";
import {
  getDatabase,
  ref,
  set,
  get,
  push,
  update,
  onValue,
} from "firebase/database";

// ========== Firebase Config ==========
const firebaseConfig = {
  apiKey: "AIzaSyCsZcn4VPhpnlgU0K_NPHPINjq9Qi5iVT8",
  authDomain: "mydatabase-e7c01.firebaseapp.com",
  databaseURL:
    "https://mydatabase-e7c01-default-rtdb.firebaseio.com",
  projectId: "mydatabase-e7c01",
  storageBucket: "mydatabase-e7c01.firebasestorage.app",
  messagingSenderId: "447471871540",
  appId: "1:447471871540:web:d48721caa65174b1598c61",
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getDatabase(firebaseApp);

// ========== Express Setup ==========
const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ========== HTTP + Socket.IO ==========
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

// ========== API Routes ==========

// Add driver
app.post("/insert", async (req, res) => {
  try {
    const { name, gmail, password, mobile, lat, lng } = req.body;
    if (!name || !gmail || !password || !mobile) {
      return res.status(400).send("All fields are required.");
    }

    const newDriverRef = push(ref(db, "drivers"));
    await set(newDriverRef, {
      name,
      gmail,
      password,
      mobile,
      online: 1,

      // Rider1 details
      Rider1_id: null,
      Booking1_code: null,
      Rider1_created_at: null,
      Rider1_lat: null,
      Rider1_lng: null,

      // Rider2 details
      Rider2_id: null,
      Booking2_code: null,
      Rider2_created_at: null,
      Rider2_lat: null,
      Rider2_lng: null,

      // Driver location
      Driver_lat: lat || null,
      Driver_lng: lng || null,
    });

    res.json({
      message: "✅ Driver added successfully!",
      driverId: newDriverRef.key,
    });
  } catch (error) {
    console.error("❌ Error adding driver:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Show online drivers
app.post("/show", async (req, res) => {
  try {
    const snap = await get(ref(db, "drivers"));
    let onlineDrivers = [];

    snap.forEach((child) => {
      const driver = child.val();
      if (driver.online === 1) {
        onlineDrivers.push({ id: child.key, ...driver });
      }
    });

    res.json({ count: onlineDrivers.length, drivers: onlineDrivers });
  } catch (err) {
    console.error("❌ Error fetching drivers:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// Login
app.post("/login", async (req, res) => {
  try {
    const { gmail, password } = req.body;
    const snap = await get(ref(db, "drivers"));
    const allDrivers = snap.val() || {};

    let user = null;
    for (let id in allDrivers) {
      let d = allDrivers[id];
      if (d.gmail === gmail && d.password === password) {
        user = { id, ...d };
        break;
      }
    }

    if (!user) return res.json({ error: "Invalid email or password" });

    res.json({ message: "Login successful", loggedInUser: user });
  } catch (err) {
    console.error("❌ Login error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// Update driver online status
app.post("/updateOnline", async (req, res) => {
  try {
    const { userId, online } = req.body;
    if (!userId)
      return res
        .status(400)
        .json({ success: false, message: "Missing userId" });

    await update(ref(db, `drivers/${userId}`), { online: online ? 1 : 0 });
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Update online error:", err);
    res.status(500).json({ success: false });
  }
});

// Delete rider by bookingCode
app.post("/target", async (req, res) => {
  try {
    const { bookingCode } = req.body;
    if (!bookingCode)
      return res.status(400).json({ message: "Booking code is required!" });

    const snapshot = await get(ref(db, "drivers"));
    if (!snapshot.exists())
      return res.status(404).json({ message: "No drivers found!" });

    let cleared = false;

    snapshot.forEach((child) => {
      const driver = child.val();
      const driverRef = ref(db, `drivers/${child.key}`);

      if (driver.Booking1_code === bookingCode) {
        update(driverRef, {
          Booking1_code: null,
          Rider1_id: null,
          Rider1_created_at: null,
          Rider1_lat: null,
          Rider1_lng: null,
          Rider1_destination:null,
          Rider1_pickup:null
        });
        if (driver.socketId)
          io.to(driver.socketId).emit("bookingCleared", { bookingCode });
        cleared = true;
      } else if (driver.Booking2_code === bookingCode) {
        update(driverRef, {
          Booking2_code: null,
          Rider2_id: null,
          Rider2_created_at: null,
          Rider2_lat: null,
          Rider2_lng: null,
          Rider1_destination:null,
          Rider2_pickup:null
        });
        if (driver.socketId)
          io.to(driver.socketId).emit("bookingCleared", { bookingCode });
        cleared = true;
      }
    });

    if (cleared) {
      res.json({ message: "Booking cleared successfully!" });
    } else {
      res.status(404).json({ message: "No matching booking code found!" });
    }
  } catch (err) {
    console.error("❌ Error clearing booking:", err);
    res.status(500).json({ message: "Server error clearing booking!" });
  }
});

// ========== Socket.IO ==========
let drivers = {};
let riders = {};

io.on("connection", (socket) => {
  console.log("🟢 Socket connected:", socket.id);

  // Register driver
  socket.on("registerDriver", async ({ driverId }) => {
    if (!driverId) return;
    socket.driverId = driverId;

    const snap = await get(ref(db, `drivers/${driverId}`));
    if (!snap.exists()) return;

    const d = snap.val();
    drivers[driverId] = {
      socketId: socket.id,
      online: 1,
      Driver_lat: d.Driver_lat,
      Driver_lng: d.Driver_lng,
      Rider1_id: d.Rider1_id,
      Rider2_id: d.Rider2_id,
      Booking1_code: d.Booking1_code,
      Booking2_code: d.Booking2_code,
      Rider1_lat: d.Rider1_lat,
      Rider1_lng: d.Rider1_lng,
      Rider2_lat: d.Rider2_lat,
      Rider2_lng: d.Rider2_lng,
    };

    // Send active bookings to driver
    if (d.Rider1_id)
      socket.emit("bookingConfirmed", {
        RiderId: d.Rider1_id,
        lat: d.Rider1_lat,
        lng: d.Rider1_lng,
        bookingCode: d.Booking1_code,
      });
    if (d.Rider2_id)
      socket.emit("bookingConfirmed", {
        RiderId: d.Rider2_id,
        lat: d.Rider2_lat,
        lng: d.Rider2_lng,
        bookingCode: d.Booking2_code,
      });
  });

 socket.on("driverLocation", async ({ lat, lng, speed, accuracy }) => {
  if (!socket.driverId) return; // driver not registered yet
  if (!drivers[socket.driverId]) {
    console.warn("Driver not found in memory:", socket.driverId);
    return;
  }

  if (typeof lat !== "number" || typeof lng !== "number") return;

  drivers[socket.driverId].Driver_lat = lat;
  drivers[socket.driverId].Driver_lng = lng;

  await update(ref(db, `drivers/${socket.driverId}`), {
    Driver_lat: lat,
    Driver_lng: lng,
  });
});

  // Rider location update
  socket.on("riderLocation", async (pos) => {
    if (typeof pos.lat !== "number" || typeof pos.lng !== "number") return;

    riders[socket.id] = { ...pos, id: socket.id };

    const driverId = Object.keys(drivers).find(
      (d) =>
        drivers[d] &&
        (drivers[d].Rider1_id === socket.id ||
          drivers[d].Rider2_id === socket.id)
    );
    if (!driverId) return;

    const driver = drivers[driverId];
    let latKey = "",
      lngKey = "";

    if (driver.Rider1_id === socket.id) {
      latKey = "Rider1_lat";
      lngKey = "Rider1_lng";
    } else {
      latKey = "Rider2_lat";
      lngKey = "Rider2_lng";
    }

    driver[latKey] = pos.lat;
    driver[lngKey] = pos.lng;

    await update(ref(db, `drivers/${driverId}`), {
      [latKey]: pos.lat,
      [lngKey]: pos.lng,
    });

    if (driver.socketId) {
      io.to(driver.socketId).emit("riderPositionUpdate", {
        riderId: socket.id,
        lat: pos.lat,
        lng: pos.lng,
      });
    }
  });

  // Book driver
  socket.on("bookDriver", async (data) => {
    if (!data.driverId || !data.riderId) {
      return socket.emit("bookingStatus", {
        status: "error",
        message: "Driver or Rider ID missing",
      });
    }

    const driverRef = ref(db, `drivers/${data.driverId}`);
    const snap = await get(driverRef);
    const driver = snap.val();
    if (!driver)
      return socket.emit("bookingStatus", { status: "error", message: "Driver not found" });

    let slot = null;
    if (!driver.Rider1_id) slot = "slot1";
    else if (!driver.Rider2_id) slot = "slot2";
    else return socket.emit("bookingFailed", "Driver full");

    const bookingCode = Math.floor(100000 + Math.random() * 900000).toString();
    let updateData = {};
    if (slot === "slot1") {
      updateData = {
        Rider1_id: data.riderId,
        Booking1_code: bookingCode,
        Rider1_created_at: data.createdAt,
        Rider1_lat: data.lat,
        Rider1_lng: data.lng,
        Rider1_pickup: data.pickup,
        Rider1_destination: data.destination,
      };
    } else if (slot === "slot2") {
      updateData = {
        Rider2_id: data.riderId,
        Booking2_code: bookingCode,
        Rider2_created_at: data.createdAt,
        Rider2_lat: data.lat,
        Rider2_lng: data.lng,
        Rider2_pickup: data.pickup,
        Rider2_destination: data.destination,
      };
    }

    await update(driverRef, updateData);

    socket.emit("bookingStatus", { status: "success", slot, driverId: data.driverId });
    socket.emit("bookingSuccess", {
      driverId: data.driverId,
      bookingData: {
        bookingCode,
        slot,
        lat: data.lat,
        lng: data.lng,
        createdAt: data.createdAt,
      },
    });
  });

  // Disconnect
  socket.on("disconnect", async () => {
    console.log("🔴 Socket disconnected:", socket.id);
    if (socket.driverId) {
      await update(ref(db, `drivers/${socket.driverId}`), { online: 1 });
      delete drivers[socket.driverId];
    }
  });
});

// ========== Start Server ==========
const PORT = process.env.PORT || 3000;
server.listen(PORT, () =>
  console.log(`🚀 Server running on http://localhost:${PORT}`)
);
