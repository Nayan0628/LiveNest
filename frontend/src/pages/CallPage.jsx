import { useEffect, useState, useCallback } from "react";
import { useNavigate, useParams } from "react-router";
import useAuthUser from "../hooks/useAuthUser";
import { useQuery } from "@tanstack/react-query";
import { getStreamToken, createRecording, updateRecording } from "../lib/api";

import {
  StreamVideo,
  StreamVideoClient,
  StreamCall,
  CallControls,
  SpeakerLayout,
  StreamTheme,
  CallingState,
  useCallStateHooks,
  useCall,
} from "@stream-io/video-react-sdk";

import "@stream-io/video-react-sdk/dist/css/styles.css";
import toast from "react-hot-toast";
import PageLoader from "../components/PageLoader";
import { Circle, Square } from "lucide-react";

const STREAM_API_KEY = import.meta.env.VITE_STREAM_API_KEY;

const CallPage = () => {
  const { id: callId } = useParams();
  const [client, setClient] = useState(null);
  const [call, setCall] = useState(null);
  const [isConnecting, setIsConnecting] = useState(true);

  const { authUser, isLoading } = useAuthUser();

  const { data: tokenData } = useQuery({
    queryKey: ["streamToken"],
    queryFn: getStreamToken,
    enabled: !!authUser,
  });

  useEffect(() => {
    const initCall = async () => {
      if (!tokenData.token || !authUser || !callId) return;

      try {
        console.log("Initializing Stream video client...");

        const user = {
          id: authUser._id,
          name: authUser.fullName,
          image: authUser.profilePic,
        };

        const videoClient = new StreamVideoClient({
          apiKey: STREAM_API_KEY,
          user,
          token: tokenData.token,
        });

        const callInstance = videoClient.call("default", callId);

        await callInstance.join({ create: true });

        console.log("Joined call successfully");

        setClient(videoClient);
        setCall(callInstance);
      } catch (error) {
        console.error("Error joining call:", error);
        toast.error("Could not join the call. Please try again.");
      } finally {
        setIsConnecting(false);
      }
    };

    initCall();
  }, [tokenData, authUser, callId]);

  if (isLoading || isConnecting) return <PageLoader />;

  return (
    <div className="h-screen flex flex-col items-center justify-center">
      <div className="relative">
        {client && call ? (
          <StreamVideo client={client}>
            <StreamCall call={call}>
              <CallContent />
            </StreamCall>
          </StreamVideo>
        ) : (
          <div className="flex items-center justify-center h-full">
            <p>Could not initialize call. Please refresh or try again later.</p>
          </div>
        )}
      </div>
    </div>
  );
};

const CallContent = () => {
  const { useCallCallingState } = useCallStateHooks();
  const callingState = useCallCallingState();
  const call = useCall();
  const navigate = useNavigate();
  const { authUser } = useAuthUser();
  const [isRecording, setIsRecording] = useState(false);
  const [recordingId, setRecordingId] = useState(null);
  const [recordingStartTime, setRecordingStartTime] = useState(null);

  useEffect(() => {
    if (callingState === CallingState.LEFT) {
      navigate("/");
    }
  }, [callingState, navigate]);

  const handleStartRecording = useCallback(async () => {
    if (!call || !authUser) return;

    try {
      // Start recording using Stream SDK
      await call.startRecording();

      // Wait a bit for the recording to initialize
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Get the recording session ID
      let recordingSessions;
      try {
        recordingSessions = await call.queryRecordings();
      } catch (err) {
        console.error("Error querying recordings:", err);
        // If queryRecordings fails, create recording with call ID
        const participants = Object.values(call.state.participants || {}).map(
          (p) => p.userId
        );

        const response = await createRecording({
          callId: call.id,
          streamRecordingId: `recording-${call.id}-${Date.now()}`,
          participants: participants,
        });

        setRecordingId(response._id);
        setIsRecording(true);
        setRecordingStartTime(Date.now());
        toast.success("Recording started");
        return;
      }

      const currentRecording = recordingSessions?.recordings?.[0];

      // Get participants from call
      const participants = Object.values(call.state.participants || {}).map(
        (p) => p.userId
      );

      // Create recording record in database
      const response = await createRecording({
        callId: call.id,
        streamRecordingId: currentRecording?.id || `recording-${call.id}-${Date.now()}`,
        participants: participants,
      });

      setRecordingId(response._id);
      setIsRecording(true);
      setRecordingStartTime(Date.now());
      toast.success("Recording started");
    } catch (error) {
      console.error("Error starting recording:", error);
      toast.error("Failed to start recording. Please check your Stream settings.");
    }
  }, [call, authUser]);

  const handleStopRecording = useCallback(async () => {
    if (!call || !recordingId) return;

    try {
      // Stop recording using Stream SDK
      await call.stopRecording();

      // Calculate duration
      const duration = recordingStartTime
        ? Math.floor((Date.now() - recordingStartTime) / 1000)
        : 0;

      // Try to get recording URL from Stream
      let recordingUrl = "";
      try {
        // Wait a bit for Stream to process
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const recordingSessions = await call.queryRecordings();
        const completedRecording = recordingSessions?.recordings?.find(
          (r) => r.status === "finished" || r.status === "ready"
        );
        if (completedRecording) {
          recordingUrl = completedRecording.url || completedRecording.hls_url || "";
        }
      } catch (err) {
        console.log("Could not fetch recording URL immediately:", err);
        // URL will be updated via webhook or polling
      }

      // Update recording record in database
      await updateRecording(recordingId, {
        recordingStatus: recordingUrl ? "completed" : "recording", // Keep as recording if URL not available yet
        duration: duration,
        endedAt: new Date().toISOString(),
        recordingUrl: recordingUrl,
      });

      setIsRecording(false);
      setRecordingId(null);
      setRecordingStartTime(null);
      toast.success("Recording stopped. Processing...");
    } catch (error) {
      console.error("Error stopping recording:", error);
      toast.error("Failed to stop recording");
    }
  }, [call, recordingId, recordingStartTime]);

  // Check if recording is active when component mounts
  useEffect(() => {
    const checkRecordingStatus = async () => {
      if (!call) return;

      try {
        const recordingSessions = await call.queryRecordings();
        const activeRecording = recordingSessions?.recordings?.find(
          (r) => r.status === "recording" || r.status === "in_progress"
        );

        if (activeRecording) {
          setIsRecording(true);
        }
      } catch (error) {
        // Silently fail - recording might not be enabled
        console.log("Recording status check:", error.message);
      }
    };

    if (call) {
      checkRecordingStatus();
    }
  }, [call]);

  return (
    <StreamTheme>
      <div className="relative">
        <SpeakerLayout />
        <div className="absolute bottom-20 left-1/2 transform -translate-x-1/2 z-50">
          {!isRecording ? (
            <button
              onClick={handleStartRecording}
              className="btn btn-error btn-lg text-white flex items-center gap-2"
            >
              <Circle className="size-5" fill="currentColor" />
              Start Recording
            </button>
          ) : (
            <button
              onClick={handleStopRecording}
              className="btn btn-error btn-lg text-white flex items-center gap-2 animate-pulse"
            >
              <Square className="size-5" fill="currentColor" />
              Stop Recording
            </button>
          )}
        </div>
        <CallControls />
      </div>
    </StreamTheme>
  );
};

export default CallPage;
