import express from "express";
import http from "http";
import {Server} from "socket.io";
import bodyParser from "body-parser";
import cors from "cors";
import { initializeApp } from "firebase/app";
import path from "path";
import { fileURLToPath  } from "url";
import { getDatabase ,ref,set,get,push,update,child,onValue} from "firebase/database";
const app = express();

//fireconfig 
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

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res)=> {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
})

//Express + socket.io setup
const server = http.createServer(app);
const io = new Server (server,{origin: '*'});
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.post('/insert', (req, res) => {
  try {
    const {name, gmail, password, mobile, lat, lng} = req.body;
    if(!name || !gmail || !password || !mobile) {
      return res.status(400).send('All fields are required.');
    }
    const newDriverRef = push(ref(db, 'drivers'));
    set(newDriverRef, {
      name,
      gmail,
      password,
      mobile,
      online:1,

      //Rider1 details
      Rider1_id:null,
      Booking1_code:null,
      Rider1_created_at:null,
      Rider1_lat:null,
      Rider1_lng:null,

      //rider2 details
      Rider2_id:null,
      Booking2_code:null,
      Rider2_created_at:null,
      Rider2_lat:null,
      Rider2_lng:null,

      //Driver location
      Driver_lat:lat ||null,
      Driver_lng:lng|| null
    });
     res.json({
      message: "✅ Driver added successfully!",
      driverId: newDriverRef.key,
    });
  }catch(error){
    console.error("❌ Error adding driver:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

//select all online 1 driver
app.post('/show', (req, res) => {
  const driverRef = ref(db, 'drivers');

  onValue(driverRef, (snapShot) => {
    let onlineDrivers = [];

    snapShot.forEach((child) => {
      const driver = child.val();

      if (driver.online === 1) {
        onlineDrivers.push({
          id: child.key,
          ...driver
        });
      }
    });

    res.json({ count: onlineDrivers.length, drivers: onlineDrivers });

  }, { onlyOnce: true });
});

app.post('/login', async (req, res) => {
  const { gmail, password } = req.body;

  const snap = await get(ref(db, "drivers"));
  const allDrivers = snap.val();

  let user = null;

  // simple loop through firebase object
  for (let id in allDrivers) {
    let d = allDrivers[id];
    if (d.gmail === gmail && d.password === password) {
      user = { id, ...d };
      break;
    }
  }

  if (!user) {
    return res.json({ error: "Invalid email or password" });
  }

  res.json({ message: "Login successful", loggedInUser: user });
});

app.post("/updateOnline", async (req, res) => {
  const { userId, online } = req.body;
  if (!userId)
    return res
      .status(400)
      .json({ success: false, message: "Missing userId" });

  await update(ref(db, `drivers/${userId}`), { online: online ? 1 : 0 });
  res.json({ success: true });
});

let drivers={};
let riders={};
io.on("connection", (socket) => {
  console.log("🟢 Socket connected:", socket.id);

  // Register driver
  socket.on("registerDriver", async ({ driverId }) => {
    if (!driverId) return;
    socket.driverId = driverId;

    // Load from Firebase
    const snap = await get(ref(db, `drivers/${driverId}`));
    if (snap.exists()) {
      const d = snap.val();
      drivers[driverId] = {
        socketId: socket.id,
        online: 1,
        Driver_lat: d.lat,
        Driver_lng: d.lng,
        Rider1_id: d.Rider1_id,
        Rider2_id: d.Rider2_id,
        Booking1_code: d.Booking1_code,
        Booking2_code: d.Booking2_code,
        Rider1_lat: d.Rider1_lat,
        Rider1_lng: d.Rider1_lng,
        Rider2_lat: d.Rider2_lat,
        Rider2_lng: d.Rider2_lng,
      };

      // Send bookings back if any active
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
    }
  });

socket.on("bookDriver", async (data) => {
  if (!data.driverId) {
    return socket.emit("bookingStatus", { status: "error", message: "Driver ID missing" });
  }
  const driverRef = ref(db, `drivers/${data.driverId}`);
  const snap = await get(driverRef);
  const driver = snap.val();
  if (!driver) {
    return socket.emit("bookingStatus", { status: "error", message: "Driver not found" });
  }
  // --------------------------------------------------------
  //  CHECK SLOTS (Maximum 2 riders per driver)
  // --------------------------------------------------------
  let slot = null;
  if (!driver.Rider1_id) {
    slot = "slot1";
  } else if (!driver.Rider2_id) {
    slot = "slot2";
  } else {
    return socket.emit("bookingFailed", "Driver full");
  }
  // --------------------------------------------------------
  //  BUILD UPDATE DATA BASED ON AVAILABLE SLOT
  // --------------------------------------------------------
  let updateData = {};
  if (slot === "slot1") {
    updateData = {
      Rider1_id: data.riderId,
      Booking1_code:Math.floor(100000 + Math.random() * 900000).toString(),
      Rider1_created_at: data.createdAt,
      Rider1_lat: data.lat,
      Rider1_lng: data.lng,
      Rider1_pickup:data.pickup,
      Rider1_destination:data.destination
    };
  }

  if (slot === "slot2") {
    updateData = {
      Rider2_id: data.riderId,
      Booking2_code:Math.floor(100000 + Math.random() * 900000).toString(),
      Rider2_created_at: data.createdAt,
      Rider2_lat: data.lat,
      Rider2_lng: data.lng,
      Rider2_pickup:data.pickup,
      Rider2_destination:data.destination
    };
  }
  // --------------------------------------------------------
  //  SAVE BOOKING IN DATABASE
  // --------------------------------------------------------
  await update(driverRef, updateData);

  // --------------------------------------------------------
  //  SEND STATUS TO RIDER
  // --------------------------------------------------------
  socket.emit("bookingStatus", {
    status: "success",
    slot: slot,
    driverId: data.driverId
  });

  socket.emit("bookingSuccess",{
  driverId: data.driverId,
  bookingData: {
    bookingCode: updateData.Booking1_code || updateData.Booking2_code,
    slot,
    lat: data.lat,
    lng: data.lng,
    createdAt: data.createdAt
  }
});
});

socket.on("driverLocation", async ({ lat, lng, speed, accuracy }) => {
    const id = socket.driverId;
    if (!id) return;
    drivers[id] = { ...drivers[id], lat, lng, speed, accuracy, online: 1 };
    await update(ref(db, `drivers/${id}`), { lat, lng });
  });

  // Rider location update
    socket.on("riderLocation", async (pos) => {
      riders[socket.id] = { ...pos, id: socket.id };
      const driverId = Object.keys(drivers).find(
        (d) =>
          drivers[d] &&
          (drivers[d].rider1_id === socket.id ||
            drivers[d].rider2_id === socket.id)
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
  
      await update(ref(db, `drivers/${driverId}`), {
        [latKey]: pos.lat,
        [lngKey]: pos.lng,
      });
  
      driver[latKey] = pos.lat;
      driver[lngKey] = pos.lng;
  
      if (driver.socketId) {
        io.to(driver.socketId).emit("riderPositionUpdate", {
          riderId: socket.id,
          lat: pos.lat,
          lng: pos.lng,
        });
      }
    });
  // ==============target for delete the rider by bookingCode=====================
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
    
        snapshot.forEach((child) => {
          const driver = child.val();
          const driverRef = ref(db, `drivers/${child.key}`);
    
          // Match booking code with either booking1_code or booking2_code
          if (driver.Booking1_code === bookingCode) {
            update(driverRef, {
              Booking1_code: null,
              Rider1_id: null,
              Rider1_created_at: null,
              Rider1_lat: null,
              Rider1_lng: null,
            });
            cleared = true;
          } else if (driver.Booking2_code === bookingCode) {
            update(driverRef, {
              Booking2_code: null,
              Rider2_id: null,
              Rider2_created_at: null,
              Rider2_lat: null,
              Rider2_lng: null,
            });
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

    // Driver disconnect
      socket.on("disconnect", async () => {
        console.log("🔴 Socket disconnected:", socket.id);
        if (socket.driverId) {
          await update(ref(db, `drivers/${socket.driverId}`), { online: 1 });
          delete drivers[socket.driverId];
        }
      });
});
const PORT = process.env.PORT || 3000;
server.listen(PORT, () =>
  console.log(`🚀 Server running on http://localhost:${PORT}`)
);