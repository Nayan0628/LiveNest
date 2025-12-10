import express from "express";
import { protectRoute } from "../middleware/auth.middleware.js";
import {
  createRecording,
  updateRecording,
  getRecordings,
  getRecordingById,
  deleteRecording,
  fetchRecordingUrl,
  handleRecordingWebhook,
} from "../controllers/recording.controller.js";

const router = express.Router();

// Webhook endpoint (no auth required) - must be before other routes
router.post("/webhook", handleRecordingWebhook);

// CRUD routes
router.post("/", protectRoute, createRecording);
router.get("/", protectRoute, getRecordings);

// More specific routes must come before generic :id routes
// Using a different pattern to avoid route matching issues
router.post("/fetch-url/:id", protectRoute, fetchRecordingUrl);

// Generic :id routes come after specific routes
router.get("/:id", protectRoute, getRecordingById);
router.put("/:id", protectRoute, updateRecording);
router.delete("/:id", protectRoute, deleteRecording);

export default router;

