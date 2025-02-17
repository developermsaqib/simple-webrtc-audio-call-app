const fs = require("fs");
const https = require("https");
const express = require("express");
const { Server } = require("socket.io");
const { Writable } = require("stream");
const cors = require("cors");

const app = express();
const server = https.createServer(
  {
    key: fs.readFileSync("key.pem"),
    cert: fs.readFileSync("cert.pem"),
  },
  app
);
const io = new Server(server);

app.use(express.static("public"));
app.use(cors());

const audioStream = new Writable({
  write(chunk, encoding, callback) {
    fs.appendFile("recording.wav", chunk, callback);
  },
});

io.on("connection", (socket) => {
  console.log(`User connected: ${socket.id}`);
  socket.emit("your-id", socket.id);
  socket.on("call-user", ({ userToCall, signalData }) =>
    socket
      .to(userToCall)
      .emit("call-user", { signal: signalData, from: socket.id })
  );
  socket.on("answer-call", ({ to, signal }) =>
    socket.to(to).emit("call-accepted", signal)
  );
  socket.on("ice-candidate", (data) =>
    socket.to(data.to).emit("ice-candidate", data.candidate)
  );
  socket.on("start-recording", () => {
    audioStream.write(Buffer.from([])); // Clear previous data if any
    socket.on("audio-data", (data) => {
      const buffer = Buffer.from(new Uint8Array(data)); // Convert to Buffer
      audioStream.write(buffer); // Write the incoming audio data to the file
    });
  });
  socket.on("stop-recording", () => {
    audioStream.end();
  });
  socket.on("error", (error) => {
    console.error("Socket error:", error);
  });
});

server.listen(3000, () =>
  console.log("Server running on https://localhost:3000")
);
