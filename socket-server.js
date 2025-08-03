import express from "express";
import { Server } from "socket.io";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";
import https from "https";
import { getSessionMembersData } from "./functions/session.js";
import {
  setItemStatusesByItemId,
  clearItemsCheckedBySocketId,
  cleanUpAllCheckedBy
} from "./functions/database.js";

dotenv.config();

let key, cert, ca;

if (
  process.env.SERVER_IP === "localhost" ||
  process.env.SERVER_IP === "leo.local"
) {
  key = fs.readFileSync(process.env.LOCAL_KEY);
  cert = fs.readFileSync(process.env.LOCAL_CERT);
}

const app = express();
const server = https.createServer({ key, cert, ca }, app);

const io = new Server(server, {
  maxHttpBufferSize: 1e8,
  cleanupEmptyChildNamespaces: true,
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000
  },
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());

const sessionCreators = {};
const joinedFromList = {};

io.on("connection", (socket) => {
  socket.on("startSession", async (data) => {
    const { sessionId } = data;

    socket.join(sessionId);
    io.to(sessionId).emit("sessionStarted", { sessionId });

    sessionCreators[sessionId] = socket.id;
  });

  socket.on("newConnection", async (data) => {
    const { sessionId, joinedFrom } = data;

    console.log(`Joining room ${sessionId} from ${joinedFrom}`);
    socket.join(sessionId);

    joinedFromList[socket.id] = joinedFrom;

    const sessionMembersData = getSessionMembersData(
      socket,
      sessionId,
      sessionCreators,
      joinedFromList
    );

    cleanUpAllCheckedBy(sessionId, sessionMembersData);

    io.to(sessionId).emit("sessionMembersChanged", {
      sessionMembers: sessionMembersData
    });
  });

  socket.on("disconnecting", (reason) => {
    if ([...socket.rooms] && [...socket.rooms][1]) {
      console.log("disconnecting");
      const sessionId = [...socket.rooms][1].toString();
      const sessionMembersData = getSessionMembersData(
        socket,
        sessionId,
        sessionCreators,
        joinedFromList,
        { removeDisconnectingSocket: true }
      );

      clearItemsCheckedBySocketId(sessionId, socket.id);

      cleanUpAllCheckedBy(sessionId, sessionMembersData);

      io.to(sessionId).emit("sessionMembersChanged", {
        sessionId,
        sessionMembers: sessionMembersData,
        memberLeft: socket.id
      });
    }
  });

  socket.on("setItemChecked", (data) => {
    const { sessionId, itemId, socketIds } = data;

    io.to(sessionId).emit("itemsStatusChanged", {
      itemId,
      checkedBy: socketIds
    });

    setItemStatusesByItemId(sessionId, itemId, {
      checkedBy: socketIds
    });
  });

  socket.on("setItemUnchecked", (data) => {
    const { sessionId, itemId, socketIds, mySocketId } = data;

    io.to(sessionId).emit("itemsStatusChanged", {
      itemId,
      checkedBy: socketIds.filter((socketId) => socketId !== mySocketId)
    });

    setItemStatusesByItemId(sessionId, itemId, {
      checkedBy: socketIds.filter((socketId) => socketId !== mySocketId)
    });
  });

  socket.on("tipAmountChanged", (data) => {
    const { sessionId, tip } = data;

    io.to(sessionId).emit("tipAmountChanged", { sessionId, tip });
  });
});

server.listen(process.env.SERVER_SOCKET_PORT, () => {
  console.log(`Listening on ${process.env.SERVER_SOCKET_PORT}`);
});
