// server.js
import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import { initializeApp } from "firebase/app";
import path from "path";
import { fileURLToPath } from "url";
import { getDatabase, ref, set, get, push, update, remove } from "firebase/database";
import winston from "winston";
import DailyRotateFile from "winston-daily-rotate-file";
const app = express();

app.use(cors({
    origin: "*",       // allow all frontend
    methods: "GET,POST,PUT,DELETE",
    allowedHeaders: "Content-Type"
}));

app.use(express.json());


/* =========================
   Basic configuration
   ========================= */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 3000;

/* =========================
   Logger
   ========================= */
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: winston.format.combine(
    winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    winston.format.printf(info => `${info.timestamp} [${info.level.toUpperCase()}] ${info.message}`)
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
   Firebase init
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
   Express setup
   ========================= */
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

/* =========================
   Utility
   ========================= */
const safeJSON = x => { try { return JSON.stringify(x); } catch { return String(x); } };

/* =========================
   Driver APIs
   ========================= */

/* Add driver */
app.post("/insert", async (req, res) => {
  try {
    const { name, gmail, password, mobile, lat, lng } = req.body;
    if (!name || !gmail || !password || !mobile) return res.status(400).send("All fields required");

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
      Rider1_mobile: null,
      Rider2_id: null,
      Booking2_code: null,
      Rider2_created_at: null,
      Rider2_lat: null,
      Rider2_lng: null,
      Rider2_pickup: null,
      Rider2_destination: null,
      Rider2_mobile :null,
      Driver_lat: lat || null,
      Driver_lng: lng || null,
    });

    res.json({ message: "✅ Driver added successfully!", driverId: newDriverRef.key });
  } catch (e) {
    logger.error("Error /insert: " + safeJSON(e));
    res.status(500).json({ message: "Server error", error: e.message });
  }
});

/* Driver login */
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
    logger.error("Error /login: " + safeJSON(e));
    res.status(500).json({ message: "Server error" });
  }
});

/* Update online status */
app.post("/updateOnline", async (req, res) => {
  try {
    const { userId, online } = req.body;
    if (!userId) return res.status(400).json({ success: false, message: "Missing userId" });
    await update(ref(db, `drivers/${userId}`), { online: online ? 1 : 0 });
    res.json({ success: true });
  } catch (e) {
    logger.error("Error /updateOnline: " + safeJSON(e));
    res.status(500).json({ success: false });
  }
});

/* Update driver location */
app.post("/driverLocation", async (req, res) => {
  try {
    const { driverId, lat, lng } = req.body;
    if (!driverId) return res.status(400).json({ message: "driverId required" });
    await update(ref(db, `drivers/${driverId}`), { Driver_lat: lat, Driver_lng: lng });
    res.json({ success: true });
  } catch (e) {
    logger.error("Error /driverLocation: " + safeJSON(e));
    res.status(500).json({ success: false });
  }
});

/* =========================
   Show online drivers (for frontend updateDriverList)
   ========================= */
app.get("/showDrivers", async (req, res) => {
  try {
    const snap = await get(ref(db, "drivers"));
    const allDrivers = snap.val() || {};
    const drivers = [];

    for (const id in allDrivers) {
      const d = allDrivers[id];
      // Only include online drivers
      if (d.online === 1) {
        drivers.push({ id, ...d });
      }
    }

    res.json({ drivers });
  } catch (e) {
    logger.error("Error /showDrivers: " + safeJSON(e));
    res.status(500).json({ message: "Server error" });
  }
});

app.get('/driver/:id', async (req, res) => {
  try {
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: 'Driver ID required' });

    const driverRef = ref(db, `drivers/${id}`);
    const snapshot = await get(driverRef);
    if (!snapshot.exists()) {
      return res.status(404).json({ error: 'Driver not found' });
    }

    res.json({ id, ...snapshot.val() });
  } catch (err) {
    logger.error("Error /driver/:id: " + err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

/* =========================
   Rider APIs
   ========================= */

/* Book driver */
app.post("/bookDriver", async (req, res) => {
  try {
    const { driverId, riderId, lat, lng, pickup, destination, mobile } = req.body;
    if (!driverId || !riderId || !mobile) return res.status(400).json({ message: "driverId & riderId required" });

    const driverSnap = await get(ref(db, `drivers/${driverId}`));
    const driver = driverSnap.val();
    if (!driver) return res.status(404).json({ message: "Driver not found" });

    let slot;
    if (!driver.Rider1_id) slot = "Rider1";
    else if (!driver.Rider2_id) slot = "Rider2";
    else return res.status(400).json({ message: "Driver full" });

    const bookingCode = Math.floor(100000 + Math.random() * 900000).toString();
    await update(ref(db, `drivers/${driverId}`), {
      [`${slot}_id`]: riderId,
      [`Booking${slot.slice(-1)}_code`]: bookingCode,
      [`${slot}_lat`]: lat || null,
      [`${slot}_lng`]: lng || null,
      [`${slot}_pickup`]: pickup || null,
      [`${slot}_destination`]: destination || null,
      [`${slot}_created_at`]: Date.now(),
      [`${slot}_mobile`]: mobile || null,
    });

    res.json({ success: true, driverId, slot, bookingCode });
  } catch (e) {
    logger.error("Error /bookDriver: " + safeJSON(e));
    res.status(500).json({ message: e.message });
  }
});

/* Update rider live location */
app.post("/riderLocation", async (req, res) => {
  try {
    const { riderId, lat, lng } = req.body;
    if (!riderId) return res.status(400).json({ message: "riderId required" });

    const snap = await get(ref(db, "drivers"));
    const driversData = snap.val();
    if (!driversData) return res.status(404).json({ message: "No drivers found" });

    for (const driverId in driversData) {
      const driver = driversData[driverId];
      if (!driver) continue;
      if (driver.Rider1_id === riderId) {
        await update(ref(db, `drivers/${driverId}`), { Rider1_lat: lat, Rider1_lng: lng });
        return res.json({ success: true, driverId });
      }
      if (driver.Rider2_id === riderId) {
        await update(ref(db, `drivers/${driverId}`), { Rider2_lat: lat, Rider2_lng: lng });
        return res.json({ success: true, driverId });
      }
    }

    res.status(404).json({ message: "Rider not assigned to any driver" });
  } catch (e) {
    logger.error("Error /riderLocation: " + safeJSON(e));
    res.status(500).json({ message: e.message });
  }
});

/* Clear booking by bookingCode */
app.post("/target", async (req, res) => {
  try {
    const { bookingCode } = req.body;
    if (!bookingCode) return res.status(400).json({ message: "Booking code required" });

    const snapshot = await get(ref(db, "drivers"));
    if (!snapshot.exists()) return res.status(404).json({ message: "No drivers found" });

    let cleared = false;
    snapshot.forEach(child => {
      const dbDriver = child.val();
      const driverKey = child.key;

      if (dbDriver.Booking1_code === bookingCode) {
        update(ref(db, `drivers/${driverKey}`), {
          Booking1_code: null,
          Rider1_id: null,
          Rider1_created_at: null,
          Rider1_lat: null,
          Rider1_lng: null,
          Rider1_destination: null,
          Rider1_mobile: null,
          Rider1_pickup: null,
        });
        cleared = true;
      } else if (dbDriver.Booking2_code === bookingCode) {
        update(ref(db, `drivers/${driverKey}`), {
          Booking2_code: null,
          Rider2_id: null,
          Rider2_created_at: null,
          Rider2_lat: null,
          Rider2_lng: null,
          Rider2_destination: null,
          Rider2_mobile: null,
          Rider2_pickup: null,
        });
        cleared = true;
      }
    });

    if (cleared) res.json({ message: "Booking cleared successfully!" });
    else res.status(404).json({ message: "No matching booking code found" });
  } catch (e) {
    logger.error("Error /target: " + safeJSON(e));
    res.status(500).json({ message: e.message });
  }
});

/* =========================
   Start server
   ========================= */
app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});