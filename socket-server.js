import express from "express";
import { Server } from "socket.io";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";
import https from "https";
import http from "http";
import { getSessionMembersData } from "./functions/session.js";
import {
  addItemCheckedBy,
  addItemsCheckedBy,
  removeItemCheckedBy,
  clearItemsCheckedBySocketId,
  cleanUpAllCheckedBy,
  setSessionCreator,
  addSessionMember,
  removeSessionMember,
  getSessionState
} from "./functions/database.js";

dotenv.config();

const app = express();

// Determine if we're running locally
const isLocal =
  process.env.SERVER_IP === "localhost" ||
  process.env.SERVER_IP === "leo.local";

let server;

if (isLocal) {
  // Use HTTPS for local development
  const key = fs.readFileSync(process.env.LOCAL_KEY);
  const cert = fs.readFileSync(process.env.LOCAL_CERT);
  server = https.createServer({ key, cert }, app);
} else {
  // Use HTTP for production
  server = http.createServer(app);
}

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

// In-RAM caches, mirrored to the receipt doc so they survive a restart. After
// a restart these start empty and are lazily rehydrated from the DB the first
// time a session is touched; reconnecting clients re-announce themselves (see
// the client's reconnect handlers), refreshing the maps with their new ids.
const sessionCreators = {};
const joinedFromList = {};

async function ensureSessionLoaded(sessionId) {
  if (sessionCreators[sessionId] !== undefined) return;

  const state = await getSessionState(sessionId);
  if (!state) return;

  if (state.creatorSocketId) {
    sessionCreators[sessionId] = state.creatorSocketId;
  }
  if (state.members) {
    for (const [socketId, info] of Object.entries(state.members)) {
      joinedFromList[socketId] = info.joinedFrom;
    }
  }
}

io.on("connection", (socket) => {
  socket.on("startSession", async (data) => {
    const { sessionId } = data;

    socket.join(sessionId);
    io.to(sessionId).emit("sessionStarted", { sessionId });

    sessionCreators[sessionId] = socket.id;
    await setSessionCreator(sessionId, socket.id).catch((err) =>
      console.log(err.stack)
    );
  });

  socket.on("newConnection", async (data) => {
    const { sessionId, joinedFrom } = data;

    console.log(`Joining room ${sessionId} from ${joinedFrom}`);
    socket.join(sessionId);

    await ensureSessionLoaded(sessionId);

    joinedFromList[socket.id] = joinedFrom;
    await addSessionMember(sessionId, socket.id, joinedFrom).catch((err) =>
      console.log(err.stack)
    );

    const sessionMembersData = getSessionMembersData(
      socket,
      sessionId,
      sessionCreators,
      joinedFromList
    );

    await cleanUpAllCheckedBy(sessionId, sessionMembersData);

    io.to(sessionId).emit("sessionMembersChanged", {
      sessionMembers: sessionMembersData
    });
  });

  socket.on("disconnecting", async (reason) => {
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

      await clearItemsCheckedBySocketId(sessionId, socket.id);

      delete joinedFromList[socket.id];
      await removeSessionMember(sessionId, socket.id).catch((err) =>
        console.log(err.stack)
      );

      await cleanUpAllCheckedBy(sessionId, sessionMembersData);

      io.to(sessionId).emit("sessionMembersChanged", {
        sessionId,
        sessionMembers: sessionMembersData,
        memberLeft: socket.id
      });
    }
  });

  // Write first, then broadcast the authoritative array the DB returns. The
  // member's identity is this connection's socket.id — never trust a client
  // supplied array, which is what allowed concurrent clicks to clobber.
  socket.on("setItemChecked", async (data) => {
    const { sessionId, itemId } = data;

    try {
      const checkedBy = await addItemCheckedBy(sessionId, itemId, socket.id);
      io.to(sessionId).emit("itemsStatusChanged", { itemId, checkedBy });
    } catch (err) {
      console.log(err.stack);
      socket.emit("itemActionFailed", { itemId, action: "check" });
    }
  });

  socket.on("setItemsChecked", async (data) => {
    const { sessionId, itemIds } = data;

    try {
      const results = await addItemsCheckedBy(sessionId, itemIds, socket.id);
      results.forEach(({ itemId, checkedBy }) => {
        io.to(sessionId).emit("itemsStatusChanged", { itemId, checkedBy });
      });
    } catch (err) {
      console.log(err.stack);
      socket.emit("itemActionFailed", { itemIds, action: "check" });
    }
  });

  socket.on("setItemUnchecked", async (data) => {
    const { sessionId, itemId } = data;

    try {
      const checkedBy = await removeItemCheckedBy(sessionId, itemId, socket.id);
      io.to(sessionId).emit("itemsStatusChanged", { itemId, checkedBy });
    } catch (err) {
      console.log(err.stack);
      socket.emit("itemActionFailed", { itemId, action: "uncheck" });
    }
  });

  socket.on("tipAmountChanged", (data) => {
    const { sessionId, tip } = data;

    io.to(sessionId).emit("tipAmountChanged", { sessionId, tip });
  });
});

server.listen(process.env.SERVER_SOCKET_PORT, () => {
  console.log(`Listening on ${process.env.SERVER_SOCKET_PORT}`);
});
