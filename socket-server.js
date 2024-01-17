import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import cors from 'cors'
import dotenv from 'dotenv'
import QRCode from 'qrcode'
import fs, { readFileSync } from 'fs'
import https from 'https'
import { getSessionMembersData } from './functions/session.js'
import { readFromDatabase, saveToDatabase, setItemStatuses } from './functions/database.js'

dotenv.config()

let key, cert, ca

if (process.env.SERVER_IP === 'localhost') {  
    key = fs.readFileSync(process.env.LOCAL_KEY)
    cert = fs.readFileSync(process.env.LOCAL_CERT)
} else {
    key = fs.readFileSync(`/etc/letsencrypt/live/${process.env.DOMAIN_NAME}/privkey.pem`, 'utf8')
    cert = fs.readFileSync(`/etc/letsencrypt/live/${process.env.DOMAIN_NAME}/cert.pem`, 'utf8')
    ca = fs.readFileSync(`/etc/letsencrypt/live/${process.env.DOMAIN_NAME}/chain.pem`, 'utf8')
}

const app = express()
const server = https.createServer({ key, cert, ca }, app)

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

    socket.join(sessionId)
    io.to(sessionId).emit('sessionStarted', { sessionId })

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

  socket.on('setItemChecked', (data) => {
    const { sessionId, itemId } = data

    io.to(sessionId).emit('itemsStatusChanged', { itemId, isChecked: true, checkedBy: socket.id })

    setItemStatuses(sessionId, itemId, { isChecked: true, checkedBy: socket.id })
  })

  socket.on('setItemUnchecked', (data) => {
    const { sessionId, itemId } = data

    io.to(sessionId).emit('itemsStatusChanged', { itemId, isChecked: false, checkedBy: null })

    setItemStatuses(sessionId, itemId, { isChecked: false, checkedBy: null })
  })

  socket.on('setMyCheckedItemsUnchecked', (data) => {
    const { sessionId, myCheckedItems } = data

    myCheckedItems.map((item) => {
      const itemId = item.id
      io.to(sessionId).emit('itemsStatusChanged', { itemId, isChecked: false, checkedBy: null })

      setItemStatuses(sessionId, itemId, { isChecked: false, checkedBy: null })
    })
  })

  // socket.on('setItemsPaid', async (data) => {
  //   const { sessionId, itemIds } = data

  //   const result = await setItemStatuses(sessionId, itemIds, { isPaid: true, paidBy: socket.id })

  //   io.to(sessionId).emit('itemsStatusChanged')
  // })
})

server.listen(process.env.SERVER_SOCKET_PORT, () => {
  console.log(`Listening on ${process.env.SERVER_SOCKET_PORT}`)
})