// server.js
// Node >= 18 recommended (ES modules)
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
  remove,
} from "firebase/database";

import winston from "winston";
import DailyRotateFile from "winston-daily-rotate-file";

/* =========================
   Basic configuration
   ========================= */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;

/* =========================
   Logger (winston + daily rotate)
   ========================= */
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: winston.format.combine(
    winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    winston.format.printf(
      (info) => `${info.timestamp} [${info.level.toUpperCase()}] ${info.message}`
    )
  ),
  transports: [
    new winston.transports.Console(),
    new DailyRotateFile({
      dirname: path.join(__dirname, "logs"),
      filename: "app-%DATE%.log",
      datePattern: "YYYY-MM-DD",
      maxSize: "20m",
      maxFiles: "14d",
      zippedArchive: true,
    }),
  ],
});

/* =========================
   Firebase init (keep your config)
   ========================= */
const firebaseConfig = {
  apiKey: "AIzaSyCsZcn4VPhpnlgU0K_NPHPINjq9Qi5iVT8",
  authDomain: "mydatabase-e7c01.firebaseapp.com",
  databaseURL: "https://mydatabase-e7c01-default-rtdb.firebaseio.com",
  projectId: "mydatabase-e7c01",
  storageBucket: "mydatabase-e7c01.firebasestorage.app",
  messagingSenderId: "447471871540",
  appId: "1:447471871540:web:d48721caa65174b1598c61",
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getDatabase(firebaseApp);

/* =========================
   Express + Socket.io
   ========================= */
const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

/* =========================
   In-memory maps & housekeeping
   drivers[driverId] = { socketId, lastSeenMs, online, meta... }
   We'll periodically purge stale entries that haven't re-connected for TTL_MS.
   ========================= */
const drivers = {}; // in-memory mapping driverId -> { socketId, lastSeenMs, online }
const DRIVER_TTL_MS = 1000 * 60 * 60 * 6; // 6 hours stale TTL (adjust as needed)
const CLEANUP_INTERVAL_MS = 1000 * 60 * 5; // cleanup every 5 minutes

function markDriverConnected(driverId, socketId) {
  drivers[driverId] = {
    ...(drivers[driverId] || {}),
    socketId,
    lastSeenMs: Date.now(),
    online: 1,
  };
}

function markDriverDisconnected(driverId) {
  if (!driverId) return;
  if (drivers[driverId]) {
    drivers[driverId].online = 0;
    // keep lastSeenMs as-is — we will purge later if stale
    delete drivers[driverId].socketId;
  }
}

/* cleanup stale drivers that haven't been seen for TTL_MS */
setInterval(() => {
  const now = Date.now();
  for (const id of Object.keys(drivers)) {
    const rec = drivers[id];
    if (!rec || !rec.lastSeenMs) continue;
    if (now - rec.lastSeenMs > DRIVER_TTL_MS) {
      logger.info(`Purging stale driver from memory: ${id}`);
      delete drivers[id];
    }
  }
}, CLEANUP_INTERVAL_MS);

/* =========================
   Utility helpers
   ========================= */
const safeJSON = (x) => {
  try { return JSON.stringify(x); } catch { return String(x); }
};

/* Small throttle map for logging so we don't spam logs for high-frequency events */
const lastLogAt = new Map();
/** logThrottle(key, ms, message) -> logs message only if now - lastLogAt[key] > ms */
function logThrottle(key, ms, message) {
  const now = Date.now();
  const last = lastLogAt.get(key) || 0;
  if (now - last > ms) {
    logger.info(message);
    lastLogAt.set(key, now);
  }
}

/* =========================
   API routes (kept from your original)
   ========================= */

/* Add driver */
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
      Rider1_id: null,
      Booking1_code: null,
      Rider1_created_at: null,
      Rider1_lat: null,
      Rider1_lng: null,
      Rider1_pickup: null,
      Rider1_destination: null,
      Rider2_id: null,
      Booking2_code: null,
      Rider2_created_at: null,
      Rider2_lat: null,
      Rider2_lng: null,
      Rider2_pickup: null,
      Rider2_destination: null,
      Driver_lat: lat || null,
      Driver_lng: lng || null,
    });

    res.json({
      message: "✅ Driver added successfully!",
      driverId: newDriverRef.key,
    });
  } catch (e) {
    logger.error("Error in /insert: " + safeJSON(e));
    res.status(500).json({ message: "Server error", error: e.message });
  }
});

/* Show online drivers */
app.post("/show", async (req, res) => {
  try {
    const snap = await get(ref(db, "drivers"));
    let onlineDrivers = [];
    snap.forEach((child) => {
      const d = child.val();
      if (d && d.online === 1) onlineDrivers.push({ id: child.key, ...d });
    });
    res.json({ count: onlineDrivers.length, drivers: onlineDrivers });
  } catch (e) {
    logger.error("Error in /show: " + safeJSON(e));
    res.status(500).json({ message: "Server error" });
  }
});

/* Login */
app.post("/login", async (req, res) => {
  try {
    const { gmail, password } = req.body;
    const snap = await get(ref(db, "drivers"));
    const all = snap.val() || {};
    let user = null;
    for (const id in all) {
      const d = all[id];
      if (d && d.gmail === gmail && d.password === password) {
        user = { id, ...d };
        break;
      }
    }
    if (!user) return res.json({ error: "Invalid email or password" });
    res.json({ message: "Login successful", loggedInUser: user });
  } catch (e) {
    logger.error("Error in /login: " + safeJSON(e));
    res.status(500).json({ message: "Server error" });
  }
});

/* Update online flag */
app.post("/updateOnline", async (req, res) => {
  try {
    const { userId, online } = req.body;
    if (!userId) return res.status(400).json({ success: false, message: "Missing userId" });
    await update(ref(db, `drivers/${userId}`), { online: online ? 1 : 0 });
    res.json({ success: true });
  } catch (e) {
    logger.error("Error in /updateOnline: " + safeJSON(e));
    res.status(500).json({ success: false });
  }
});

/* Clear booking by bookingCode */
app.post("/target", async (req, res) => {
  try {
    const { bookingCode } = req.body;
    if (!bookingCode) return res.status(400).json({ message: "Booking code is required!" });

    const snapshot = await get(ref(db, "drivers"));
    if (!snapshot.exists()) return res.status(404).json({ message: "No drivers found!" });

    let cleared = false;
    snapshot.forEach((child) => {
      const dbDriver = child.val();
      const driverKey = child.key;
      const driverRef = ref(db, `drivers/${driverKey}`);

      if (dbDriver.Booking1_code === bookingCode) {
        update(driverRef, {
          Booking1_code: null,
          Rider1_id: null,
          Rider1_created_at: null,
          Rider1_lat: null,
          Rider1_lng: null,
          Rider1_destination: null,
          Rider1_pickup: null,
        });
        if (drivers[driverKey]?.socketId) io.to(driverKey).emit("bookingCleared", { bookingCode });
        cleared = true;
      } else if (dbDriver.Booking2_code === bookingCode) {
        update(driverRef, {
          Booking2_code: null,
          Rider2_id: null,
          Rider2_created_at: null,
          Rider2_lat: null,
          Rider2_lng: null,
          Rider2_destination: null,
          Rider2_pickup: null,
        });
        if (drivers[driverKey]?.socketId) io.to(driverKey).emit("bookingCleared", { bookingCode });
        cleared = true;
      }
    });

    if (cleared) res.json({ message: "Booking cleared successfully!" });
    else res.status(404).json({ message: "No matching booking code found!" });
  } catch (e) {
    logger.error("Error in /target: " + safeJSON(e));
    res.status(500).json({ message: "Server error clearing booking!" });
  }
});

/* Test emit endpoint (helpful during debugging) */
app.post("/testEmit", (req, res) => {
  const { driverId, riderId, lat, lng } = req.body;
  if (!driverId || !riderId) return res.status(400).json({ message: "driverId & riderId required" });

  if (drivers[driverId]?.socketId) {
    io.to(driverId).emit("riderPositionUpdate", { riderId, lat: Number(lat) || 0, lng: Number(lng) || 0 });
    logger.info(`Test emit -> driver room ${driverId} : rider ${riderId}`);
    return res.json({ message: "Emitted to driver room", driverId });
  } else {
    logger.warn(`TestEmit: driver ${driverId} not connected in-memory`);
    return res.status(404).json({ message: "Driver not connected in-memory", driverId });
  }
});

/* View in-memory connected drivers (debug) */
app.get("/debug/drivers", (req, res) => {
  res.json({ connectedDrivers: drivers });
});

/* =========================
   Socket.IO handlers
   ========================= */
io.on("connection", (socket) => {
  logger.info(`Socket connected: ${socket.id}`);

  /* registerDriver - called by driver frontend after login */
  socket.on("registerDriver", async ({ driverId }) => {
    try {
      if (!driverId) {
        logger.warn(`registerDriver call missing driverId from socket ${socket.id}`);
        return;
      }

      // store driverId on socket for later reference
      socket.driverId = driverId;

      // join a room with the driverId so we can emit using io.to(driverId)
      socket.join(driverId);

      // record in-memory mapping
      markDriverConnected(driverId, socket.id);

      // update DB online flag (best-effort)
      try { await update(ref(db, `drivers/${driverId}`), { online: 1 }); } catch (e) { logger.warn("Could not update DB online flag: " + safeJSON(e)); }

      logger.info(`Driver registered: ${driverId} (socket ${socket.id})`);

      // emit any active bookings to driver (pull from DB)
      try {
        const snap = await get(ref(db, `drivers/${driverId}`));
        if (snap.exists()) {
          const d = snap.val();
          if (d.Rider1_id) socket.emit("bookingConfirmed", { riderId: d.Rider1_id, lat: d.Rider1_lat, lng: d.Rider1_lng, bookingCode: d.Booking1_code });
          if (d.Rider2_id) socket.emit("bookingConfirmed", { riderId: d.Rider2_id, lat: d.Rider2_lat, lng: d.Rider2_lng, bookingCode: d.Booking2_code });
        }
      } catch (e) {
        logger.warn("Failed to send bookingConfirmed after register: " + safeJSON(e));
      }
    } catch (e) {
      logger.error("Error in registerDriver: " + safeJSON(e));
    }
  });

  /* driverLocation - driver sends its own live location */
  socket.on("driverLocation", async ({ lat, lng, speed, accuracy }) => {
    if (!socket.driverId) return;
    try {
      // keep mapping / lastSeen
      markDriverConnected(socket.driverId, socket.id);

      // update DB (best-effort)
      await update(ref(db, `drivers/${socket.driverId}`), { Driver_lat: lat, Driver_lng: lng });
    } catch (e) {
      logger.warn("driverLocation error: " + safeJSON(e));
    }
  });

  /* riderLiveLocation - rider frontend sends live location to backend
     backend finds which driver has this rider and forwards update
  */
  socket.on("riderLiveLocation", async (payload) => {
    try {
      if (!payload || typeof payload.riderId !== "string") {
        logThrottle("riderLiveLocation.invalid", 5000, "Invalid riderLiveLocation payload");
        return;
      }

      const { riderId, lat, lng } = payload;

      // throttle logging for this rider to at most once every 5s
      logThrottle(`rider.${riderId}`, 5000, `riderLiveLocation -> ${riderId} ${lat},${lng}`);

      // read DB mapping to find driver owning this rider (DB is authoritative)
      const snap = await get(ref(db, "drivers"));
      const dbDrivers = snap.val();
      if (!dbDrivers) {
        logger.warn("No DB drivers found while processing riderLiveLocation");
        return;
      }

      for (const driverId of Object.keys(dbDrivers)) {
        const d = dbDrivers[driverId];
        if (!d) continue;

        // check slot1
        if (d.Rider1_id === riderId) {
          // update DB
          try { await update(ref(db, `drivers/${driverId}`), { Rider1_lat: lat, Rider1_lng: lng }); } catch (e) {}
          // forward to driver room if connected
          if (drivers[driverId]?.socketId) {
            io.to(driverId).emit("riderPositionUpdate", { riderId, lat, lng });
            logThrottle(`emit.${driverId}`, 2000, `Forwarded riderPositionUpdate -> ${driverId} (rider ${riderId})`);
          } else {
            logger.warn(`driver(${driverId}) not connected in-memory; cannot emit for rider ${riderId}`);
            // optional: you could still write to DB and let driver pick up via onValue
          }
          return;
        }

        // check slot2
        if (d.Rider2_id === riderId) {
          try { await update(ref(db, `drivers/${driverId}`), { Rider2_lat: lat, Rider2_lng: lng }); } catch (e) {}
          if (drivers[driverId]?.socketId) {
            io.to(driverId).emit("riderPositionUpdate", { riderId, lat, lng });
            logThrottle(`emit.${driverId}`, 2000, `Forwarded riderPositionUpdate -> ${driverId} (rider ${riderId})`);
          } else {
            logger.warn(`driver(${driverId}) not connected in-memory; cannot emit for rider ${riderId}`);
          }
          return;
        }
      }

      // not found
      logger.warn(`No driver mapping found for rider: ${riderId}`);
    } catch (e) {
      logger.error("Error processing riderLiveLocation: " + safeJSON(e));
    }
  });

  /* bookDriver - rider requests to book a driver */
  socket.on("bookDriver", async (data) => {
    try {
      if (!data || !data.driverId || !data.riderId) {
        return socket.emit("bookingStatus", { status: "error", message: "Driver or Rider ID missing" });
      }
      const driverRef = ref(db, `drivers/${data.driverId}`);
      const snap = await get(driverRef);
      const driver = snap.val();
      if (!driver) return socket.emit("bookingStatus", { status: "error", message: "Driver not found" });

      let slot = null;
      if (!driver.Rider1_id) slot = "slot1";
      else if (!driver.Rider2_id) slot = "slot2";
      else return socket.emit("bookingFailed", "Driver full");

      const bookingCode = Math.floor(100000 + Math.random() * 900000).toString();
      const now = data.createdAt || Date.now();

      const updateData = slot === "slot1"
        ? { Rider1_id: data.riderId, Booking1_code: bookingCode, Rider1_created_at: now, Rider1_lat: data.lat || null, Rider1_lng: data.lng || null, Rider1_pickup: data.pickup || null, Rider1_destination: data.destination || null }
        : { Rider2_id: data.riderId, Booking2_code: bookingCode, Rider2_created_at: now, Rider2_lat: data.lat || null, Rider2_lng: data.lng || null, Rider2_pickup: data.pickup || null, Rider2_destination: data.destination || null };

      await update(driverRef, updateData);

      socket.emit("bookingStatus", { status: "success", slot, driverId: data.driverId });
      socket.emit("bookingSuccess", { driverId: data.driverId, bookingData: { bookingCode, slot, lat: data.lat, lng: data.lng, createdAt: now } });

      // notify driver if connected
      if (drivers[data.driverId]?.socketId) {
        io.to(data.driverId).emit("bookingConfirmed", { riderId: data.riderId, lat: data.lat, lng: data.lng, bookingCode });
        logger.info(`Notified driver ${data.driverId} of new booking for rider ${data.riderId}`);
      }
    } catch (e) {
      logger.error("Error in bookDriver: " + safeJSON(e));
      socket.emit("bookingStatus", { status: "error", message: "Server error" });
    }
  });

  /* Clean disconnect */
  socket.on("disconnect", async (reason) => {
    logger.info(`Socket disconnected: ${socket.id} reason: ${reason}`);
    if (!socket.driverId) return;
    const did = socket.driverId;

    // If you specifically WANT to keep online=1 on disconnect (per earlier conversation),
    // change the update here. By default we'll set online = 0 to reflect disconnect.
    // To keep online=1, change the value below to 1.
    const KEEP_ONLINE_ON_DISCONNECT = false;

    try {
      await update(ref(db, `drivers/${did}`), { online: KEEP_ONLINE_ON_DISCONNECT ? 1 : 0 });
    } catch (e) {
      logger.warn("Failed to update DB online flag on disconnect: " + safeJSON(e));
    }

    // remove in-memory mapping
    delete drivers[did];
    logger.info(`Removed driver from memory: ${did}`);
  });

  /* safety: catch uncaught errors in socket handlers */
  socket.on("error", (err) => {
    logger.error("Socket error: " + safeJSON(err));
  });
});

/* =========================
   Global error & shutdown handlers
   ========================= */
process.on("uncaughtException", (err) => {
  logger.error("UNCAUGHT EXCEPTION: " + safeJSON(err));
  // optionally exit or attempt graceful shutdown
});

process.on("unhandledRejection", (reason) => {
  logger.error("UNHANDLED REJECTION: " + safeJSON(reason));
});

/* optional periodic memory & connection summary (helpful for debugging) */
setInterval(() => {
  const mem = process.memoryUsage();
  logger.info(`Memory usage: rss=${Math.round(mem.rss/1024/1024)}MB heapUsed=${Math.round(mem.heapUsed/1024/1024)}MB drivers=${Object.keys(drivers).length}`);
}, 1000 * 60); // once per minute

/* =========================
   Start server
   ========================= */
server.listen(PORT, "0.0.0.0", () => {
  logger.info(`Server running on port ${PORT}`);
});
