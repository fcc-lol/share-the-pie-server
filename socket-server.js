import express from "express";
import { Server } from "socket.io";
import cors from "cors";
import dotenv from "dotenv";
import QRCode from "qrcode";
import fs, { readFileSync } from "fs";
import https from "https";
import { getSessionMembersData } from "./functions/session.js";
import {
  setItemStatusesByItemId,
  clearItemsCheckedBySocketId,
} from "./functions/database.js";

dotenv.config();

let key, cert, ca;

if (
  process.env.SERVER_IP === "localhost" ||
  process.env.SERVER_IP === "leo.local"
) {
  key = fs.readFileSync(process.env.LOCAL_KEY);
  cert = fs.readFileSync(process.env.LOCAL_CERT);
} else {
  key = fs.readFileSync(
    `/etc/letsencrypt/live/${process.env.DOMAIN_NAME}/privkey.pem`,
    "utf8"
  );
  cert = fs.readFileSync(
    `/etc/letsencrypt/live/${process.env.DOMAIN_NAME}/cert.pem`,
    "utf8"
  );
  ca = fs.readFileSync(
    `/etc/letsencrypt/live/${process.env.DOMAIN_NAME}/chain.pem`,
    "utf8"
  );
}

const app = express();
const server = https.createServer({ key, cert, ca }, app);

const io = new Server(server, {
  maxHttpBufferSize: 1e8,
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
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

    io.to(sessionId).emit("sessionMembersChanged", {
      sessionMembers: sessionMembersData,
    });
  });

  socket.on("disconnecting", (reason) => {
    if ([...socket.rooms] && [...socket.rooms][1]) {
      const sessionId = [...socket.rooms][1].toString();
      const sessionMembersData = getSessionMembersData(
        socket,
        sessionId,
        sessionCreators,
        joinedFromList,
        { removeDisconnectingSocket: true }
      );

      clearItemsCheckedBySocketId(sessionId, socket.id);

      io.to(sessionId).emit("sessionMembersChanged", {
        sessionMembers: sessionMembersData,
        memberLeft: socket.id,
      });
    }
  });

  socket.on("setItemChecked", (data) => {
    const { sessionId, itemId, socketIds } = data;

    io.to(sessionId).emit("itemsStatusChanged", {
      itemId,
      checkedBy: socketIds,
    });

    setItemStatusesByItemId(sessionId, itemId, {
      checkedBy: socketIds,
    });
  });

  socket.on("setItemUnchecked", (data) => {
    const { sessionId, itemId } = data;

    io.to(sessionId).emit("itemsStatusChanged", {
      itemId,
      checkedBy: [],
    });

    setItemStatusesByItemId(sessionId, itemId, {
      checkedBy: [],
    });
  });

  socket.on("setMemberToBeSessionCreator", async (data) => {
    const { sessionId, itemIds } = data;

    await setItemStatuses(sessionId, itemIds, {
      isPaid: true,
      paidBy: socket.id,
    });

    io.to(sessionId).emit("itemsStatusChanged");
  });

  socket.on("tipAmountChanged", (data) => {
    const { sessionId, tip } = data;

    io.to(sessionId).emit("tipAmountChanged", { sessionId, tip });
  });
});

server.listen(process.env.SERVER_SOCKET_PORT, () => {
  console.log(`Listening on ${process.env.SERVER_SOCKET_PORT}`);
});
