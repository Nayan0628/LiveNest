import express from "express";
import "dotenv/config";
import cookieParser from "cookie-parser";
import cors from "cors";
import path from "path";

import authRoutes from "./routes/auth.route.js";
import userRoutes from "./routes/user.route.js";
import chatRoutes from "./routes/chat.route.js";
import recordingRoutes from "./routes/recording.route.js";

import { connectDB } from "./lib/db.js";

const app = express();

// Use Render / environment port when available, otherwise fallback to 5001 for local dev
const PORT = process.env.PORT || 5001;

const __dirname = path.resolve();

// FRONTEND_URL: set this in Render (e.g. https://your-frontend.onrender.com) when using two-service setup.
// Default to localhost Vite dev server in development.
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

// CORS: allow credentials and accept requests only from your frontend origin.
// In production this will use FRONTEND_URL; in development it uses the local Vite URL.
app.use(
  cors({
    origin: process.env.NODE_ENV === "production" ? FRONTEND_URL : "http://localhost:5173",
    credentials: true, // allow frontend to send cookies
  })
);

// Parse JSON and cookies
app.use(express.json());
app.use(cookieParser());

// Mount API routes
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/recordings", recordingRoutes);

// Serve frontend in production (single-service approach)
if (process.env.NODE_ENV === "production") {
  app.use(express.static(path.join(__dirname, "../frontend/dist")));

  app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "../frontend", "dist", "index.html"));
  });
}

// Connect to DB first, then start the server
connectDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Failed to connect to database, server not started.", err);
    process.exit(1);
  });
