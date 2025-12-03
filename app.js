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
} from "firebase/database";

const app = express();

// Firebase config (kept as you provided)
const firebaseConfig = {
  apiKey: "AIzaSyCsZcn4VPhpnlgU0K_NPHPINjq9Qi5iVT8",
  authDomain: "mydatabase-e7c01.firebaseapp.com",
  databaseURL: "https://mydatabase-e7c01-default-rtdb.firebaseio.com",
  projectId: "mydatabase-e7c01",
  storageBucket: "mydatabase-e7c01.firebasestorage.app",
  messagingSenderId: "447471871540",
  appId: "1:447471871540:web:d48721caa65174b1598c61",
};

const firebaseapp = initializeApp(firebaseConfig);
const db = getDatabase(firebaseapp);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(path.join(__dirname, "public")));
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

/* ---------------- API: insert driver ---------------- */
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
      Rider1_pickup: null,
      Rider1_destination: null,

      // Rider2 details
      Rider2_id: null,
      Booking2_code: null,
      Rider2_created_at: null,
      Rider2_lat: null,
      Rider2_lng: null,
      Rider2_pickup: null,
      Rider2_destination: null,

      // Driver location (consistent keys)
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

/* ---------------- API: show online drivers (single response) ---------------- */
app.post("/show", async (req, res) => {
  try {
    const snap = await get(ref(db, "drivers"));
    const onlineDrivers = [];

    if (snap.exists()) {
      snap.forEach((child) => {
        const d = child.val();
        if (d && d.online === 1) {
          onlineDrivers.push({ id: child.key, ...d });
        }
      });
    }

    res.json({ count: onlineDrivers.length, drivers: onlineDrivers });
  } catch (err) {
    console.error("❌ /show error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/* ---------------- API: login ---------------- */
app.post("/login", async (req, res) => {
  try {
    const { gmail, password } = req.body;
    const snap = await get(ref(db, "drivers"));
    const allDrivers = snap.val() || {};

    let user = null;
    for (let id in allDrivers) {
      const d = allDrivers[id];
      if (d.gmail === gmail && d.password === password) {
        user = { id, ...d };
        break;
      }
    }

    if (!user) return res.json({ error: "Invalid email or password" });

    res.json({ message: "Login successful", loggedInUser: user });
  } catch (err) {
    console.error("❌ /login error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/* ---------------- API: updateOnline ---------------- */
app.post("/updateOnline", async (req, res) => {
  try {
    const { userId, online } = req.body;
    if (!userId)
      return res.status(400).json({ success: false, message: "Missing userId" });

    await update(ref(db, `drivers/${userId}`), { online: online ? 1 : 0 });
    res.json({ success: true });
  } catch (err) {
    console.error("❌ /updateOnline:", err);
    res.status(500).json({ success: false });
  }
});

/* ---------------- API: target (clear booking by bookingCode) ---------------- */
app.post("/target", async (req, res) => {
  try {
    const { bookingCode } = req.body;
    if (!bookingCode)
      return res.status(400).json({ message: "Booking code is required!" });

    const driversRef = ref(db, "drivers");
    const snapshot = await get(driversRef);
    if (!snapshot.exists())
      return res.status(404).json({ message: "No drivers found!" });

    let cleared = false;
    const updates = {};

    snapshot.forEach((child) => {
      const d = child.val();
      const key = child.key;

      if (d.Booking1_code === bookingCode) {
        updates[`drivers/${key}/Booking1_code`] = null;
        updates[`drivers/${key}/Rider1_id`] = null;
        updates[`drivers/${key}/Rider1_created_at`] = null;
        updates[`drivers/${key}/Rider1_lat`] = null;
        updates[`drivers/${key}/Rider1_lng`] = null;
        updates[`drivers/${key}/Rider1_pickup`] = null;
        updates[`drivers/${key}/Rider1_destination`] = null;
        cleared = true;
      }

      if (d.Booking2_code === bookingCode) {
        updates[`drivers/${key}/Booking2_code`] = null;
        updates[`drivers/${key}/Rider2_id`] = null;
        updates[`drivers/${key}/Rider2_created_at`] = null;
        updates[`drivers/${key}/Rider2_lat`] = null;
        updates[`drivers/${key}/Rider2_lng`] = null;
        updates[`drivers/${key}/Rider2_pickup`] = null;
        updates[`drivers/${key}/Rider2_destination`] = null;
        cleared = true;
      }
    });

    // apply updates (batch)
    if (cleared) {
      // Firebase realtime DB doesn't have a single multi-path 'update' here like admin SDK,
      // but update(ref(db), updates) works with absolute paths in client SDK as well.
      await update(ref(db), updates);
      return res.json({ message: "Booking cleared successfully!" });
    }

    res.status(404).json({ message: "No matching booking code found!" });
  } catch (err) {
    console.error("❌ Error clearing booking:", err);
    res.status(500).json({ message: "Server error clearing booking!" });
  }
});

/* ---------------- SOCKETS ---------------- */
let drivers = {}; // key: driverId -> { socketId, Driver_lat, Driver_lng, Rider1_id, Rider2_id, ... }
let riders = {};  // key: riderSocketId -> { lat, lng, ... }

io.on("connection", (socket) => {
  console.log("🟢 Socket connected:", socket.id);

  // Register driver (driverId is DB key)
  socket.on("registerDriver", async ({ driverId }) => {
    if (!driverId) return;
    socket.driverId = driverId;

    const snap = await get(ref(db, `drivers/${driverId}`));
    if (!snap.exists()) return;

    const d = snap.val();

    drivers[driverId] = {
      socketId: socket.id,
      online: 1,
      Driver_lat: d.Driver_lat ?? null,
      Driver_lng: d.Driver_lng ?? null,
      Rider1_id: d.Rider1_id ?? null,
      Rider2_id: d.Rider2_id ?? null,
      Booking1_code: d.Booking1_code ?? null,
      Booking2_code: d.Booking2_code ?? null,
      Rider1_lat: d.Rider1_lat ?? null,
      Rider1_lng: d.Rider1_lng ?? null,
      Rider2_lat: d.Rider2_lat ?? null,
      Rider2_lng: d.Rider2_lng ?? null,
    };

    // Send bookings back if any active (this helps restore frontend state)
    if (d.Rider1_id) {
      socket.emit("bookingConfirmed", {
        RiderId: d.Rider1_id,
        lat: d.Rider1_lat,
        lng: d.Rider1_lng,
        bookingCode: d.Booking1_code,
        slot: "slot1",
      });
    }
    if (d.Rider2_id) {
      socket.emit("bookingConfirmed", {
        RiderId: d.Rider2_id,
        lat: d.Rider2_lat,
        lng: d.Rider2_lng,
        bookingCode: d.Booking2_code,
        slot: "slot2",
      });
    }
  });

  // Book driver (rider should send its socket id as riderId so driver can match)
  socket.on("bookDriver", async (data) => {
    try {
      if (!data.driverId) {
        return socket.emit("bookingStatus", { status: "error", message: "Driver ID missing" });
      }

      const driverRef = ref(db, `drivers/${data.driverId}`);
      const snap = await get(driverRef);
      const driver = snap.exists() ? snap.val() : null;

      if (!driver) {
        return socket.emit("bookingStatus", { status: "error", message: "Driver not found" });
      }

      // CHECK SLOTS (Maximum 2)
      let slot = null;
      if (!driver.Rider1_id) slot = "slot1";
      else if (!driver.Rider2_id) slot = "slot2";
      else return socket.emit("bookingFailed", "Driver full");

      // Build update object
      const bookingCode = Math.floor(100000 + Math.random() * 900000).toString();
      const updateData = {};
      if (slot === "slot1") {
        updateData.Rider1_id = data.riderId; // IMPORTANT: this should be rider socket id
        updateData.Booking1_code = bookingCode;
        updateData.Rider1_created_at = data.createdAt || Date.now();
        updateData.Rider1_lat = data.lat || null;
        updateData.Rider1_lng = data.lng || null;
        updateData.Rider1_pickup = data.pickup || null;
        updateData.Rider1_destination = data.destination || null;
      } else {
        updateData.Rider2_id = data.riderId;
        updateData.Booking2_code = bookingCode;
        updateData.Rider2_created_at = data.createdAt || Date.now();
        updateData.Rider2_lat = data.lat || null;
        updateData.Rider2_lng = data.lng || null;
        updateData.Rider2_pickup = data.pickup || null;
        updateData.Rider2_destination = data.destination || null;
      }

      await update(driverRef, updateData);

      // Notify the caller (rider or driver client) about success
      socket.emit("bookingStatus", { status: "success", slot, driverId: data.driverId });
      socket.emit("bookingSuccess", {
        driverId: data.driverId,
        bookingData: {
          bookingCode,
          slot,
          lat: data.lat,
          lng: data.lng,
          createdAt: updateData.Rider1_created_at || updateData.Rider2_created_at,
        },
      });

      // If driver is connected on sockets map, notify driver about booking (so driver UI can attach rider socket id)
      const drv = drivers[data.driverId];
      if (drv && drv.socketId) {
        io.to(drv.socketId).emit("bookingConfirmed", {
          RiderId: data.riderId, // rider socket id
          lat: data.lat,
          lng: data.lng,
          bookingCode,
          slot,
        });
      }
    } catch (err) {
      console.error("❌ bookDriver error:", err);
      socket.emit("bookingStatus", { status: "error", message: "Server error" });
    }
  });

  // Driver location updates from driver client
  socket.on("driverLocation", async ({ lat, lng, speed, accuracy }) => {
    const id = socket.driverId;
    if (!id) return;

    // keep in-memory consistent fields
    drivers[id] = { ...(drivers[id] || {}), Driver_lat: lat, Driver_lng: lng, speed, accuracy, online: 1 };

    // persist consistent keys to DB
    try {
      await update(ref(db, `drivers/${id}`), { Driver_lat: lat, Driver_lng: lng });
    } catch (err) {
      console.error("❌ driverLocation update error:", err);
    }
  });

  // Rider location update (rider socket sends its own location)
  socket.on("riderLocation", async (pos) => {
    // store rider's current pos
    riders[socket.id] = { ...pos, id: socket.id };

    // find the driver who has this rider assigned (Rider1_id or Rider2_id equal to rider socket id)
    const driverId = Object.keys(drivers).find(
      (d) =>
        drivers[d] &&
        (drivers[d].Rider1_id === socket.id || drivers[d].Rider2_id === socket.id)
    );

    if (!driverId) return;

    const driver = drivers[driverId];
    let latKey = "", lngKey = "", slot = "";

    if (driver.Rider1_id === socket.id) {
      latKey = "Rider1_lat";
      lngKey = "Rider1_lng";
      slot = "slot1";
    } else {
      latKey = "Rider2_lat";
      lngKey = "Rider2_lng";
      slot = "slot2";
    }

    try {
      // update DB
      await update(ref(db, `drivers/${driverId}`), {
        [latKey]: pos.lat,
        [lngKey]: pos.lng,
      });

      // update in-memory driver object
      drivers[driverId][latKey] = pos.lat;
      drivers[driverId][lngKey] = pos.lng;

      // notify the driver socket so their frontend can update markers
      if (driver.socketId) {
        io.to(driver.socketId).emit("riderPositionUpdate", {
          riderId: socket.id, // rider socket id — frontend must store this in slots
          lat: pos.lat,
          lng: pos.lng,
          slot,
        });
      }
    } catch (err) {
      console.error("❌ riderLocation error:", err);
    }
  });

  // Handle driver disconnect
  socket.on("disconnect", async () => {
    console.log("🔴 Socket disconnected:", socket.id);
    if (socket.driverId) {
      try {
        await update(ref(db, `drivers/${socket.driverId}`), { online: 1 });
      } catch (err) {
        console.error("❌ disconnect update error:", err);
      }
      delete drivers[socket.driverId];
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
