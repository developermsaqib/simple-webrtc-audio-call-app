const socket = io();
let localStream, peer;
let mediaRecorder;
let audioChunks = [];
let iceCandidatesQueue = []; // Queue for ICE candidates
let audioContext;
let fileAudioStream = null;
let isStreamingFile = false;

// Define the configuration for the RTCPeerConnection
const configuration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" }, // STUN server
    // Uncomment and configure a TURN server if needed
    // {
    //   urls: "turn:your.turn.server:3478", // Replace with your TURN server
    //   username: "your_username", // Replace with your TURN server username
    //   credential: "your_password" // Replace with your TURN server password
    // }
  ],
};

socket.on("your-id", (id) => {
  console.log("Your ID:", id); // Debugging: Log the user's ID
  document.getElementById("userId").value = id;
});

navigator.mediaDevices
  .getUserMedia({ audio: true })
  .then((stream) => {
    localStream = stream;
    console.log("Local stream obtained"); // Debugging: Log when local stream is obtained
  })
  .catch((error) => {
    console.error("Error accessing media devices.", error); // Debugging: Log any errors
  });

function callUser() {
  const userToCall = document.getElementById("userId").value;
  peer = new RTCPeerConnection(configuration); // Use the configuration with STUN server
  localStream.getTracks().forEach((track) => peer.addTrack(track, localStream));

  peer.onicecandidate = (e) => {
    if (e.candidate) {
      console.log("ICE candidate generated:", e.candidate); // Debugging: Log ICE candidates
      if (peer.remoteDescription) {
        socket.emit("ice-candidate", {
          to: userToCall,
          candidate: e.candidate,
        });
      } else {
        iceCandidatesQueue.push(e.candidate); // Queue until remote description is set
      }
    }
  };

  peer.ontrack = (e) => {
    const audio = new Audio();
    audio.srcObject = e.streams[0];
    audio.play();

    // Start recording the incoming audio stream
    mediaRecorder = new MediaRecorder(e.streams[0]);
    mediaRecorder.start();

    mediaRecorder.ondataavailable = (event) => {
      audioChunks.push(event.data);
      const audioBlob = new Blob(audioChunks, { type: "audio/wav" });
      socket.emit("audio-data", audioBlob);
      audioChunks = [];
    };
  };

  peer
    .createOffer()
    .then((offer) => {
      console.log("SDP Offer created:", offer); // Debugging: Log the SDP offer
      return peer.setLocalDescription(offer);
    })
    .then(() => {
      console.log("Local description set. Emitting call-user."); // Debugging: Log when local description is set
      socket.emit("call-user", {
        userToCall,
        signalData: peer.localDescription,
      });
    })
    .catch((error) => {
      console.error("Error during call setup:", error); // Debugging: Log any errors during setup
    });
}

socket.on("call-user", (data) => {
  console.log("Call user signal received:", data); // Debugging: Log when a call user signal is received
  peer = new RTCPeerConnection(configuration); // Use the configuration with STUN server
  localStream.getTracks().forEach((track) => peer.addTrack(track, localStream));

  peer.onicecandidate = (e) => {
    if (e.candidate) {
      console.log("ICE candidate generated:", e.candidate); // Debugging: Log ICE candidates
      socket.emit("ice-candidate", { to: data.from, candidate: e.candidate });
    }
  };

  peer.ontrack = (e) => {
    const audio = new Audio();
    audio.srcObject = e.streams[0];
    audio.play();

    // Start recording the incoming audio stream
    mediaRecorder = new MediaRecorder(e.streams[0]);
    mediaRecorder.start();

    mediaRecorder.ondataavailable = (event) => {
      audioChunks.push(event.data);
      // Convert audioChunks to a Blob and send it to the server
      const audioBlob = new Blob(audioChunks, { type: "audio/wav" });
      socket.emit("audio-data", audioBlob); // Send audio data to server
      audioChunks = []; // Clear the chunks after sending
    };
  };

  peer
    .setRemoteDescription(new RTCSessionDescription(data.signal))
    .then(() => {
      console.log("Remote description set. Creating answer."); // Debugging: Log when remote description is set
      return peer.createAnswer();
    })
    .then((answer) => {
      console.log("SDP Answer created:", answer); // Debugging: Log the SDP answer
      return peer.setLocalDescription(answer);
    })
    .then(() => {
      console.log("Local description set. Emitting answer-call."); // Debugging: Log when local description is set
      socket.emit("answer-call", {
        to: data.from,
        signal: peer.localDescription,
      });
    })
    .catch((error) => {
      console.error("Error during call response:", error); // Debugging: Log any errors during response
    });
});

socket.on("call-accepted", (signal) => {
  console.log("Call accepted signal received:", signal); // Debugging: Log when call accepted signal is received
  peer
    .setRemoteDescription(new RTCSessionDescription(signal))
    .then(() => {
      console.log("Remote description set after call accepted."); // Debugging: Log when remote description is set
    })
    .catch((error) => {
      console.error(
        "Error setting remote description after call accepted:",
        error
      ); // Debugging: Log any errors
    });
});

socket.on("ice-candidate", (data) => {
  console.log("ICE candidate received:", data); // Debugging: Log received ICE candidates
  peer
    .addIceCandidate(new RTCIceCandidate(data))
    .then(() => {
      console.log("ICE candidate added successfully."); // Debugging: Log successful addition of ICE candidate
    })
    .catch((error) => {
      console.error("Error adding ICE candidate:", error); // Debugging: Log any errors
    });
});

// Call this function to start recording
function startRecording() {
  socket.emit("start-recording");
}

// Call this function to stop recording
function stopRecording() {
  mediaRecorder.stop();
  mediaRecorder.onstop = () => {
    const audioBlob = new Blob(audioChunks, { type: "audio/wav" });
    socket.emit("audio-data", audioBlob); // Send audio data to server
    audioChunks = []; // Clear the chunks after sending
  };
}

// Add buttons to start and stop recording
document.getElementById("startRecording").onclick = startRecording;
document.getElementById("stopRecording").onclick = stopRecording;

// Add this function to stream audio file
async function streamAudioFile(event) {
  if (!peer) {
    alert("Please establish a call first!");
    return;
  }

  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }

  const file = event.target.files[0];
  if (!file) return;

  try {
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    // Create audio source for the file
    const fileSource = audioContext.createBufferSource();
    fileSource.buffer = audioBuffer;

    // Create a gain node for the file audio (to control volume if needed)
    const fileGain = audioContext.createGain();
    fileGain.gain.value = 1.0; // Adjust this value to change file audio volume

    // Create audio source for the microphone
    const micStream = audioContext.createMediaStreamSource(localStream);
    const micGain = audioContext.createGain();
    micGain.gain.value = 1.0; // Adjust this value to change microphone volume

    // Create a merger node to combine both audio sources
    const merger = audioContext.createChannelMerger(2);

    // Connect the audio graph
    fileSource.connect(fileGain);
    fileGain.connect(merger, 0, 0);
    micStream.connect(micGain);
    micGain.connect(merger, 0, 1);

    // Create a media stream destination
    const streamDestination = audioContext.createMediaStreamDestination();
    merger.connect(streamDestination);

    // Replace the audio track in the peer connection
    const senders = peer.getSenders();
    const audioSender = senders.find((sender) => sender.track.kind === "audio");
    if (audioSender) {
      await audioSender.replaceTrack(
        streamDestination.stream.getAudioTracks()[0]
      );
    }

    // Start playing the file audio
    fileSource.start();
    isStreamingFile = true;

    // When file playback ends
    fileSource.onended = async () => {
      isStreamingFile = false;
      // Restore original microphone track
      if (audioSender) {
        await audioSender.replaceTrack(localStream.getAudioTracks()[0]);
      }
      // Clean up audio nodes
      fileSource.disconnect();
      fileGain.disconnect();
      micStream.disconnect();
      micGain.disconnect();
      merger.disconnect();
      streamDestination.disconnect();
    };
  } catch (error) {
    console.error("Error streaming audio file:", error);
    alert("Error streaming audio file. Please try again.");
  }
}

// Add this event listener at the bottom of the file
document
  .getElementById("audioFileInput")
  .addEventListener("change", streamAudioFile);
