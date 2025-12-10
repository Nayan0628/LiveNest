import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getRecordings, deleteRecording, fetchRecordingUrl, getStreamToken, updateRecording } from "../lib/api";
import { VideoIcon, TrashIcon, ClockIcon, UserIcon, CalendarIcon, PlayIcon, RefreshCwIcon, Download } from "lucide-react";
import toast from "react-hot-toast";
import { StreamVideoClient } from "@stream-io/video-react-sdk";
import useAuthUser from "../hooks/useAuthUser";

const STREAM_API_KEY = import.meta.env.VITE_STREAM_API_KEY;

const RecordingsListPage = () => {
  const queryClient = useQueryClient();
  const { authUser } = useAuthUser();
  
  const { data: tokenData } = useQuery({
    queryKey: ["streamToken"],
    queryFn: getStreamToken,
    enabled: !!authUser,
  });

  const { data: recordings = [], isLoading, refetch } = useQuery({
    queryKey: ["recordings"],
    queryFn: getRecordings,
    refetchInterval: 30000, // Refetch every 30 seconds to check for updated recording URLs
  });

  // Manually refresh recordings
  const handleRefresh = () => {
    refetch();
    toast.success("Recordings refreshed");
  };

  const { mutate: deleteRecordingMutation, isPending: isDeleting } = useMutation({
    mutationFn: deleteRecording,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recordings"] });
      toast.success("Recording deleted successfully");
    },
    onError: () => {
      toast.error("Failed to delete recording");
    },
  });

  // Fallback: Fetch recording URL directly from Stream on frontend
  const fetchRecordingFromStream = async (recording) => {
    if (!tokenData?.token || !authUser || !recording.callId) {
      throw new Error("Missing required data to fetch recording");
    }

    try {
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

      const callInstance = videoClient.call("default", recording.callId);
      const recordingSessions = await callInstance.queryRecordings();
      
      console.log("Stream recordings found:", recordingSessions?.recordings?.length || 0);
      console.log("Looking for recording:", recording.streamRecordingId);
      
      // Try to find the recording by different identifiers
      const streamRecording = recordingSessions?.recordings?.find(
        (r) => {
          const matches = 
            r.id === recording.streamRecordingId || 
            r.session_id === recording.streamRecordingId ||
            r.id === recording.callId ||
            r.session_id === recording.callId;
          if (matches) {
            console.log("Found matching recording:", r);
          }
          return matches;
        }
      );

      // If no exact match, try to get the most recent recording for this call
      const allRecordings = recordingSessions?.recordings || [];
      const callRecordings = allRecordings.filter(r => 
        r.call_id === recording.callId || 
        r.call?.id === recording.callId
      );
      
      const targetRecording = streamRecording || callRecordings[0] || allRecordings[0];

      if (targetRecording) {
        console.log("Target recording status:", targetRecording.status);
        console.log("Target recording URLs:", { 
          hls_url: targetRecording.hls_url, 
          url: targetRecording.url,
          mp4_url: targetRecording.mp4_url 
        });

        // Check if recording has a URL
        const recordingUrl = targetRecording.hls_url || targetRecording.url || targetRecording.mp4_url;
        
        if (recordingUrl) {
          // Update recording in database
          await updateRecording(recording._id, {
            recordingUrl: recordingUrl,
            recordingStatus: targetRecording.status === "finished" || targetRecording.status === "ready" ? "completed" : recording.recordingStatus,
            duration: targetRecording.duration || recording.duration,
          });

          return { recordingUrl, ...recording, recordingUrl };
        } else {
          // Recording exists but URL not ready yet
          const status = targetRecording.status || "processing";
          throw new Error(`Recording is still ${status}. Please wait a few moments and try again.`);
        }
      }
      
      // No recording found in Stream
      throw new Error("Recording not found in Stream. It may still be processing or the recording session may have expired.");
    } catch (error) {
      console.error("Error fetching from Stream:", error);
      // Re-throw with a more user-friendly message if it's our custom error
      if (error.message.includes("Recording") || error.message.includes("processing")) {
        throw error;
      }
      throw new Error(`Unable to fetch recording: ${error.message}`);
    }
  };

  const { mutate: fetchUrlMutation, isPending: isFetching } = useMutation({
    mutationFn: async (recording) => {
      // Try backend first, fallback to frontend Stream query
      try {
        return await fetchRecordingUrl(recording._id);
      } catch (backendError) {
        console.log("Backend fetch failed, trying frontend Stream query...", backendError);
        // Fallback to frontend Stream query
        return await fetchRecordingFromStream(recording);
      }
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["recordings"] });
      if (data.recordingUrl) {
        toast.success("Recording URL fetched successfully!");
      } else {
        toast.error("Recording URL not available yet. Please try again later.");
      }
    },
    onError: (error) => {
      const errorMessage = error.response?.data?.message || error.message || "Failed to fetch recording URL";
      console.error("Error fetching recording URL:", error);
      
      // Show more helpful error messages
      if (errorMessage.includes("processing") || errorMessage.includes("wait")) {
        toast.error(errorMessage, { duration: 5000 });
      } else if (errorMessage.includes("not found")) {
        toast.error("Recording not available yet. It may still be processing. Please try again in a few moments.", { duration: 5000 });
      } else {
        toast.error(errorMessage);
      }
    },
  });

  const formatDuration = (seconds) => {
    if (!seconds) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const formatDate = (dateString) => {
    if (!dateString) return "Unknown";
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const handleDelete = (recordingId) => {
    if (window.confirm("Are you sure you want to delete this recording?")) {
      deleteRecordingMutation(recordingId);
    }
  };


  const getStatusBadge = (status) => {
    const statusConfig = {
      recording: { label: "Recording", className: "badge-error" },
      completed: { label: "Completed", className: "badge-success" },
      failed: { label: "Failed", className: "badge-warning" },
    };

    const config = statusConfig[status] || statusConfig.completed;
    return <span className={`badge ${config.className}`}>{config.label}</span>;
  };

  if (isLoading) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="flex justify-center py-12">
          <span className="loading loading-spinner loading-lg"></span>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="container mx-auto max-w-6xl space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight flex items-center gap-2">
            <VideoIcon className="h-8 w-8 text-primary" />
            My Recordings
          </h1>
          <div className="flex items-center gap-3">
            {recordings.length > 0 && (
              <span className="badge badge-primary badge-lg">{recordings.length} recordings</span>
            )}
            <button
              onClick={handleRefresh}
              className="btn btn-ghost btn-sm"
              disabled={isLoading}
            >
              <RefreshCwIcon className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        {recordings.length === 0 ? (
          <div className="card bg-base-200 p-12 text-center">
            <VideoIcon className="h-16 w-16 mx-auto mb-4 opacity-50" />
            <h3 className="font-semibold text-xl mb-2">No recordings found</h3>
            <p className="text-base-content opacity-70">
              Start recording a video call to see your recordings here.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {recordings.map((recording) => (
              <div
                key={recording._id}
                className="card bg-base-200 shadow-sm hover:shadow-md transition-shadow"
              >
                <div className="card-body p-5 space-y-4">
                  {/* Header with status */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <VideoIcon className="h-5 w-5 text-primary" />
                      <h3 className="font-semibold text-lg">Call Recording</h3>
                    </div>
                    {getStatusBadge(recording.recordingStatus)}
                  </div>

                  {/* Started by */}
                  <div className="flex items-center gap-2 text-sm">
                    <UserIcon className="h-4 w-4 opacity-70" />
                    <span className="opacity-70">Started by:</span>
                    <span className="font-medium">
                      {recording.startedBy?.fullName || "Unknown"}
                    </span>
                  </div>

                  {/* Participants */}
                  {recording.participants && recording.participants.length > 0 && (
                    <div className="text-sm">
                      <span className="opacity-70">Participants: </span>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {recording.participants.map((participant, idx) => (
                          <span key={idx} className="badge badge-sm badge-outline">
                            {participant.fullName}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Duration */}
                  {recording.duration > 0 && (
                    <div className="flex items-center gap-2 text-sm">
                      <ClockIcon className="h-4 w-4 opacity-70" />
                      <span className="opacity-70">Duration:</span>
                      <span className="font-medium">{formatDuration(recording.duration)}</span>
                    </div>
                  )}

                  {/* Date */}
                  <div className="flex items-center gap-2 text-sm">
                    <CalendarIcon className="h-4 w-4 opacity-70" />
                    <span className="opacity-70">Recorded:</span>
                    <span className="font-medium">{formatDate(recording.createdAt)}</span>
                  </div>

                  {/* Video Player - Always show for recordings with URL */}
                  {recording.recordingUrl && recording.recordingUrl.trim() !== "" && (
                    <div className="w-full bg-black rounded-lg overflow-hidden">
                      {recording.recordingUrl.endsWith('.m3u8') || recording.recordingUrl.includes('hls') ? (
                        <video
                          key={recording._id}
                          controls
                          autoPlay
                          className="w-full h-auto"
                          style={{ maxHeight: '400px', minHeight: '200px' }}
                          playsInline
                        >
                          <source src={recording.recordingUrl} type="application/x-mpegURL" />
                          <source src={recording.recordingUrl} type="video/mp4" />
                          Your browser does not support the video tag.
                        </video>
                      ) : (
                        <video
                          key={recording._id}
                          controls
                          autoPlay
                          className="w-full h-auto"
                          style={{ maxHeight: '400px', minHeight: '200px' }}
                          playsInline
                        >
                          <source src={recording.recordingUrl} type="video/mp4" />
                          <source src={recording.recordingUrl} type="video/webm" />
                          Your browser does not support the video tag.
                        </video>
                      )}
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex gap-2 pt-2 border-t border-base-300">
                    {!recording.recordingUrl || recording.recordingUrl.trim() === "" ? (
                      <button
                        className="btn btn-primary btn-sm flex-1"
                        onClick={() => fetchUrlMutation(recording)}
                        disabled={isFetching || !tokenData?.token}
                      >
                        <Download className="h-4 w-4 mr-1" />
                        {isFetching ? "Fetching..." : "Get Recording"}
                      </button>
                    ) : (
                      <a
                        href={recording.recordingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-primary btn-sm flex-1"
                      >
                        <PlayIcon className="h-4 w-4 mr-1" />
                        Open in New Tab
                      </a>
                    )}
                    <button
                      className="btn btn-error btn-sm"
                      onClick={() => handleDelete(recording._id)}
                      disabled={isDeleting}
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default RecordingsListPage;

