import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import cors from 'cors'
import dotenv from 'dotenv'
import QRCode from 'qrcode'
import fs, { readFileSync } from 'fs'
import { getSessionMembersData } from './functions/session.js'
import { readFromDatabase, saveToDatabase, setItemStatuses } from './functions/database.js'

dotenv.config()

const app = express()
const server = createServer(app)
const io = new Server(server, {
  maxHttpBufferSize: 1e8,
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
})

app.use(cors())

const sessionCreators = {}

io.on('connection', (socket) => {
  socket.on('startSession', async (data) => {
    const sessionId = data.sessionId
    const url = `${process.env.DATABASE_VIEWER_ENDPOINT}/${sessionId}`
    const qrCode = await QRCode.toDataURL(url, { width: 800 })

    socket.join(sessionId)
    io.to(sessionId).emit('sessionStarted', { sessionId, qrCode })

    sessionCreators[sessionId] = socket.id
  })

  socket.on('newConnection', async (data) => {
    const sessionId = data.sessionId

    console.log(`Joining room ${sessionId}`)
    socket.join(sessionId)

    const sessionMembersData = getSessionMembersData(socket, sessionId, sessionCreators)

    io.to(sessionId).emit('sessionMembersChanged', { sessionMembers: sessionMembersData })
  })

  socket.on('disconnecting', (reason) => {
    if ([...socket.rooms] && [...socket.rooms][1]) {
      const sessionId = [...socket.rooms][1].toString()
      const sessionMembersData = getSessionMembersData(socket, sessionId, sessionCreators, { removeDisconnectingSocket: true })

      io.to(sessionId).emit('sessionMembersChanged', { sessionMembers: sessionMembersData })
    }
  })

  socket.on('setItemChecked', async (data) => {
    const { sessionId, itemId } = data

    const result = await setItemStatuses(sessionId, itemId, { isChecked: true, checkedBy: socket.id })

    io.to(sessionId).emit('itemsStatusChanged')
  })

  socket.on('setItemUnchecked', async (data) => {
    const { sessionId, itemId } = data

    const result = await setItemStatuses(sessionId, itemId, { isChecked: false, checkedBy: null })

    io.to(sessionId).emit('itemsStatusChanged')
  })

  socket.on('setItemsPaid', async (data) => {
    const { sessionId, itemIds } = data

    const result = await setItemStatuses(sessionId, itemIds, { isPaid: true, paidBy: socket.id })

    io.to(sessionId).emit('itemsStatusChanged')
  })
})

server.listen(process.env.SERVER_SOCKET_PORT, () => {
  console.log(`Listening on ${process.env.SERVER_SOCKET_PORT}`)
})