import express from 'express'
import { MongoClient, ObjectId } from 'mongodb'
import { createServer } from 'http'
import { Server } from 'socket.io'
import cors from 'cors'
import dotenv from 'dotenv'
import QRCode from 'qrcode'
import fs, { readFileSync } from 'fs'

dotenv.config()

const app = express();
const server = createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 1e8,
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

async function readFromDatabase(id) {
  const client = new MongoClient(`mongodb://${encodeURIComponent(process.env.MONGODB_USERNAME)}:${encodeURIComponent(process.env.MONGODB_PASSWORD)}@${process.env.MONGODB_SERVER}`)

  try {
    const database = client.db(process.env.MONGODB_DATABASE)
    const collection = database.collection(process.env.MONGODB_COLLECTION)
    const result = await collection.findOne({ _id: new ObjectId(id) })

    return result
  } finally {
    await client.close()
  }
}

async function saveToDatabase(data) {
  const client = new MongoClient(`mongodb://${encodeURIComponent(process.env.MONGODB_USERNAME)}:${encodeURIComponent(process.env.MONGODB_PASSWORD)}@${process.env.MONGODB_SERVER}`)

  try {
    const database = client.db(process.env.MONGODB_DATABASE)
    const collection = database.collection(process.env.MONGODB_COLLECTION)
    const result = await collection.insertOne(data)

    return result.insertedId
  } finally {
    await client.close()
  }
}

app.use(cors())

app.get('/', (req, res) => {
  res.send('ok')
})

const sessionCreators = {}

io.on('connection', (socket) => {
  // socket.emit('hello', 'world')

  // let insertedId = await saveToDatabase({
  //   'random': 'data'
  // }).catch(console.dir)

  // let sessionId = insertedId.toString()

  socket.on('startSession', async (data) => {
    const sessionId = data.sessionId

    const qrCode = 'QR_CODE_GOES_HERE'

    socket.join(sessionId)
    io.to(sessionId).emit('sessionStarted', { qrCode, sessionId })

    sessionCreators[sessionId] = socket.id
  })

  socket.on('raiseHand', async (data) => {
    console.log(data)
  })

  socket.on('newConnection', async (data) => {
    const sessionId = data.sessionId

    console.log(`Joining room ${sessionId}`)
    socket.join(sessionId)

    let sessionMemberIdsSet = socket.adapter.rooms.get(sessionId)
    let sessionMemberIdsArray = [...sessionMemberIdsSet]

    let sessionMembersData = sessionMemberIdsArray.map((sessionMemberId) => {
      return {
        id: sessionMemberId,
        hasPaid: false,
        isSessionCreator: sessionCreators[sessionId] === sessionMemberId
      }
    })

    io.to(sessionId).emit('sessionMembersChanged', { sessionMembers: sessionMembersData })
  })

  socket.on('disconnecting', (reason) => {
    if ([...socket.rooms] && [...socket.rooms][1]) {
      const sessionId = [...socket.rooms][1].toString()

      let sessionMemberIdsSet = socket.adapter.rooms.get(sessionId)
      sessionMemberIdsSet.delete(socket.id)
      let sessionMemberIdsArray = [...sessionMemberIdsSet]

      let sessionMembersData = sessionMemberIdsArray.map((sessionMemberId) => {
        return {
          id: sessionMemberId,
          hasPaid: false,
          isSessionCreator: sessionCreators[sessionId] === sessionMemberId
        }
      })

      io.to(sessionId).emit('sessionMembersChanged', { sessionMembers: sessionMembersData })
    }
  })

  // socket.on('receiptCaptured', async (data) => {
  //   let input = JSON.parse(data)
  //   let parsedReceipt
  //   const receiptParsingMode = process.env.RECEIPT_PARSING_MODE

  //   if (receiptParsingMode === 'GPT') {
  //     parsedReceipt = await parseWithGPT(input)
  //   } else if (receiptParsingMode === 'VERYFI') {
  //     parsedReceipt = await parseWithVeryfi(input)
  //   } else if (receiptParsingMode === 'SAMPLE') {
  //     const sampleData = readFileSync('./samples/pusu.json')
  //     parsedReceipt = JSON.parse(sampleData)
  //   }

  //   const insertedId = await saveToDatabase(parsedReceipt).catch(console.dir)

  //   const url = `${process.env.DATABASE_VIEWER_ENDPOINT}/${insertedId.toString()}`
  //   const qr = await QRCode.toDataURL(url)

  //   socket.emit('receiptParsed', {
  //     url,
  //     qr
  //   })
  // })
})

server.listen(3000, () => {
  console.log('listening on *:3000')
})