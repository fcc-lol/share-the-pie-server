import express from 'express'
import { MongoClient, ObjectId } from 'mongodb'
import OpenAI from 'openai'
import dotenv from 'dotenv'
import cors from 'cors'
import fetch from 'node-fetch'
import bodyParser from 'body-parser'
import fs, { readFileSync } from 'fs'
import https from 'https'
import QRCode from 'qrcode'

import { readFromDatabase, saveToDatabase } from './functions/database.js'
import { parseWithGPT, parseWithVeryfi } from './functions/parse-receipt.js'

dotenv.config()

function generateDataString(parsedReceipt) {
  let dataArray = []

  parsedReceipt.line_items.map((line_item) => {
    dataArray.push(`${line_item.quantity}:${line_item.description}:${line_item.total}`)
  }).filter(x => x)

  dataArray.push(`_s:${parsedReceipt.subtotal}`)
  dataArray.push(`_i:${parsedReceipt.tax}`)
  dataArray.push(`_a:${parsedReceipt.tip}`)
  dataArray.push(`_o:${parsedReceipt.total}`)

  let dataString = dataArray.join(';')

  dataString = encodeURIComponent(dataString)

  return dataString
}

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

app.use(bodyParser.json({ limit: '10000kb' }))
app.use(cors())

server.listen(process.env.SERVER_NODE_PORT, () => {
  console.log(`Listening on port ${process.env.SERVER_NODE_PORT}`)
})

app.get('/getReceiptData/:id', async (req, res) => {
  const data = await readFromDatabase(req.params.id).catch(console.dir)

  if (data) {
    res.send({
      merchant: {
        name: data.vendor.name,
        type: data.vendor.type,
        address: data.vendor.address
      },
      items: data.line_items.map((line_item) => {
        if (line_item.total) {
          return {
            id: line_item.id,
            description: line_item.description,
            quanity: line_item.quanity,
            price: line_item.total
          }
        }
      }).filter(x => x),
      transaction: {
        items: data.subtotal,
        tip: data.tip,
        tax: data.tax,
        total: data.total,
      }
    })
  } else {
    res.sendStatus(404)
  }
})

app.get('/status', async (req, res) => {
  res.send('Success')
})

app.post('/parseReceiptImage', async (req, res) => {
// app.get('/parse', async (req, res) => {
  let imageData = req.body.image
  let parsedReceipt
  const receiptParsingMode = process.env.RECEIPT_PARSING_MODE
  
  if (receiptParsingMode === 'GPT') {
    parsedReceipt = await parseWithGPT(imageData)
  } else if (receiptParsingMode === 'VERYFI') {
    parsedReceipt = await parseWithVeryfi(imageData)
  } else if (receiptParsingMode === 'SAMPLE') {
    const sampleData = readFileSync('./samples/pusu.json')
    parsedReceipt = JSON.parse(sampleData)
  }

  if (parsedReceipt) {
    let dataStorageMode = process.env.DATA_STORAGE_MODE

    if (dataStorageMode === 'DATABASE') {
      parsedReceipt.line_items = parsedReceipt.line_items.map(line_item => ({
        ...line_item,
        status: {
          isChecked: false,
          checkedBy: null,
          isPaid: false,
          paidBy: null
        }
      }))

      const insertedId = await saveToDatabase({
        parsed: parsedReceipt,
        original: imageData
      }).catch(console.dir)

      res.send({
        sessionId: insertedId
      })
    } else if (dataStorageMode === 'URL') {
      const dataString = generateDataString(parsedReceipt)

      const url = `${process.env.LOCAL_VIEWER_URL}/${dataString}`
      const qr = await QRCode.toDataURL(url)

      res.send({
        url,
        qr
      })
    }
  } else {
    res.sendStatus(404)
  }
})