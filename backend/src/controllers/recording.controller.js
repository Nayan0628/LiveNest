import Recording from "../models/Recording.js";
import User from "../models/User.js";

export async function createRecording(req, res) {
  try {
    const { callId, streamRecordingId, participants } = req.body;
    const startedBy = req.user.id;

    const recording = await Recording.create({
      callId,
      streamRecordingId,
      startedBy,
      participants: participants || [],
      recordingStatus: "recording",
    });

    await recording.populate("startedBy", "fullName profilePic");
    await recording.populate("participants", "fullName profilePic");

    res.status(201).json(recording);
  } catch (error) {
    console.error("Error in createRecording controller:", error.message);
    res.status(500).json({ message: "Internal Server Error" });
  }
}

export async function updateRecording(req, res) {
  try {
    const { id } = req.params;
    const { recordingUrl, recordingStatus, duration, endedAt } = req.body;

    const recording = await Recording.findById(id);

    if (!recording) {
      return res.status(404).json({ message: "Recording not found" });
    }

    // Update recording fields
    if (recordingUrl) recording.recordingUrl = recordingUrl;
    if (recordingStatus) recording.recordingStatus = recordingStatus;
    if (duration !== undefined) recording.duration = duration;
    if (endedAt) recording.endedAt = endedAt;

    await recording.save();

    await recording.populate("startedBy", "fullName profilePic");
    await recording.populate("participants", "fullName profilePic");

    res.status(200).json(recording);
  } catch (error) {
    console.error("Error in updateRecording controller:", error.message);
    res.status(500).json({ message: "Internal Server Error" });
  }
}

export async function getRecordings(req, res) {
  try {
    const userId = req.user.id;

    // Get all recordings where user is a participant or started the recording
    const recordings = await Recording.find({
      $or: [
        { startedBy: userId },
        { participants: userId },
      ],
    })
      .populate("startedBy", "fullName profilePic")
      .populate("participants", "fullName profilePic")
      .sort({ createdAt: -1 });

    res.status(200).json(recordings);
  } catch (error) {
    console.error("Error in getRecordings controller:", error.message);
    res.status(500).json({ message: "Internal Server Error" });
  }
}

export async function getRecordingById(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const recording = await Recording.findById(id)
      .populate("startedBy", "fullName profilePic")
      .populate("participants", "fullName profilePic");

    if (!recording) {
      return res.status(404).json({ message: "Recording not found" });
    }

    // Check if user is authorized to view this recording
    const isParticipant =
      recording.startedBy._id.toString() === userId ||
      recording.participants.some((p) => p._id.toString() === userId);

    if (!isParticipant) {
      return res.status(403).json({ message: "Unauthorized to view this recording" });
    }

    res.status(200).json(recording);
  } catch (error) {
    console.error("Error in getRecordingById controller:", error.message);
    res.status(500).json({ message: "Internal Server Error" });
  }
}

export async function deleteRecording(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const recording = await Recording.findById(id);

    if (!recording) {
      return res.status(404).json({ message: "Recording not found" });
    }

    // Only the person who started the recording can delete it
    if (recording.startedBy.toString() !== userId) {
      return res.status(403).json({ message: "Unauthorized to delete this recording" });
    }

    await Recording.findByIdAndDelete(id);

    res.status(200).json({ message: "Recording deleted successfully" });
  } catch (error) {
    console.error("Error in deleteRecording controller:", error.message);
    res.status(500).json({ message: "Internal Server Error" });
  }
}

// Fetch recording URL from Stream API
export async function fetchRecordingUrl(req, res) {
  try {
    console.log("=== fetchRecordingUrl called ===");
    console.log("Request params:", req.params);
    console.log("Request body:", req.body);
    console.log("Request method:", req.method);
    console.log("Request path:", req.path);
    console.log("Request url:", req.url);
    
    const { id } = req.params;
    console.log("Recording ID from params:", id);
    
    if (!id) {
      return res.status(400).json({ message: "Recording ID is required" });
    }
    
    const recording = await Recording.findById(id);

    if (!recording) {
      return res.status(404).json({ message: "Recording not found" });
    }

    // Check if user is authorized
    const userId = req.user.id;
    const isParticipant =
      recording.startedBy.toString() === userId ||
      recording.participants.some((p) => p.toString() === userId);

    if (!isParticipant) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    // Try to fetch recording from Stream API
    // Note: This requires Stream Video API - you may need to install @stream-io/video-server-sdk
    // For now, we'll use a REST API call to Stream
    try {
      const apiKey = process.env.STEAM_API_KEY;
      const apiSecret = process.env.STEAM_API_SECRET;
      
      if (!apiKey || !apiSecret) {
        return res.status(500).json({ message: "Stream API credentials not configured" });
      }

      // Use Stream REST API to get recording
      // Format: GET https://video.stream-io-api.com/v1/calls/{type}/{id}/recordings
      // Stream Video API uses API key and secret for authentication
      const authString = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');
      const streamResponse = await fetch(
        `https://video.stream-io-api.com/v1/calls/default/${recording.callId}/recordings`,
        {
          method: "GET",
          headers: {
            Authorization: `Basic ${authString}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (streamResponse.ok) {
        const data = await streamResponse.json();
        const recordings = data.recordings || [];
        
        // Find the matching recording
        const streamRecording = recordings.find(
          (r) => r.id === recording.streamRecordingId || r.session_id === recording.streamRecordingId
        );

        if (streamRecording) {
          // Update recording with URL
          recording.recordingUrl = streamRecording.hls_url || streamRecording.url || "";
          recording.recordingStatus = streamRecording.status === "finished" ? "completed" : recording.recordingStatus;
          if (streamRecording.duration) {
            recording.duration = streamRecording.duration;
          }
          if (streamRecording.end_time) {
            recording.endedAt = new Date(streamRecording.end_time);
          }

          await recording.save();
          await recording.populate("startedBy", "fullName profilePic");
          await recording.populate("participants", "fullName profilePic");

          return res.status(200).json(recording);
        } else {
          return res.status(404).json({ message: "Recording not found in Stream" });
        }
      } else {
        let errorData;
        try {
          errorData = await streamResponse.json();
        } catch (e) {
          errorData = { detail: streamResponse.statusText };
        }
        console.error("Stream API error:", streamResponse.status, errorData);
        return res.status(streamResponse.status).json({ 
          message: errorData.detail || errorData.message || "Failed to fetch recording from Stream",
          status: streamResponse.status
        });
      }
    } catch (error) {
      console.error("Error fetching from Stream API:", error.message);
      return res.status(500).json({ 
        message: "Failed to fetch recording URL from Stream",
        error: error.message 
      });
    }
  } catch (error) {
    console.error("Error in fetchRecordingUrl controller:", error.message);
    res.status(500).json({ message: "Internal Server Error" });
  }
}

// Webhook handler for Stream recording events
export async function handleRecordingWebhook(req, res) {
  try {
    const { type, call, recording } = req.body;

    // Handle different recording event types
    if (type === "recording.ready" || type === "recording.finished") {
      // Find recording by streamRecordingId
      const dbRecording = await Recording.findOne({
        streamRecordingId: recording?.id || call?.id,
      });

      if (dbRecording) {
        // Update recording with URL and status
        dbRecording.recordingUrl = recording?.url || recording?.hls_url || "";
        dbRecording.recordingStatus = "completed";
        if (recording?.duration) {
          dbRecording.duration = recording.duration;
        }
        if (recording?.end_time) {
          dbRecording.endedAt = new Date(recording.end_time);
        }

        await dbRecording.save();
        console.log(`Recording ${dbRecording._id} updated with URL`);
      }
    } else if (type === "recording.failed") {
      const dbRecording = await Recording.findOne({
        streamRecordingId: recording?.id || call?.id,
      });

      if (dbRecording) {
        dbRecording.recordingStatus = "failed";
        await dbRecording.save();
        console.log(`Recording ${dbRecording._id} marked as failed`);
      }
    }

    res.status(200).json({ message: "Webhook processed" });
  } catch (error) {
    console.error("Error in handleRecordingWebhook:", error.message);
    res.status(500).json({ message: "Internal Server Error" });
  }
}

