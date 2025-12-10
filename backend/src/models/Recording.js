import mongoose from "mongoose";

const recordingSchema = new mongoose.Schema(
  {
    callId: {
      type: String,
      required: true,
    },
    streamRecordingId: {
      type: String,
      required: true,
      unique: true,
    },
    recordingUrl: {
      type: String,
      default: "",
    },
    recordingStatus: {
      type: String,
      enum: ["recording", "completed", "failed"],
      default: "recording",
    },
    startedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    participants: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    duration: {
      type: Number, // in seconds
      default: 0,
    },
    startedAt: {
      type: Date,
      default: Date.now,
    },
    endedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

const Recording = mongoose.model("Recording", recordingSchema);

export default Recording;

