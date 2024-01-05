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

dotenv.config()

const key = fs.readFileSync(process.env.LOCAL_KEY)
const cert = fs.readFileSync(process.env.LOCAL_CERT)

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

async function parseWithGPT(image) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

  try {
    const completion = await openai.chat.completions.create({
      messages: [
        {
          role: "system",
          content: "You are a helpful assistant designed to output JSON.",
        },
        { role: "user", content: {
          "type": "image_url", 
          "image_url": 
            {
              "url": image
            }
          }
        },
        { role: "user", content:
          `{
              "transaction": {
                "datetime": "DATE_TIME",
                "merchant": "MERCHANT_NAME",
              },
              "items": [
                {
                  "name": "ITEM_NAME",
                  "price": 0.00
                },
                {
                  "name": "ITEM_NAME",
                  "price": 0.00
                },
                {
                  "name": "ITEM_NAME",
                  "price": 0.00
                }
              ],
              "total": {
                "subtotal": 0.00,
                "tax": 0.00,
                "tip": 0.00,
                "total": 0.00
              }
            }` },
        { role: "user", content: "when did this transaction occur? what was the merchant's name? create a list of the items, excluding items that have zero price or no price or blank price, and show the grand total amount and tax and tip that is shown on this receipt, where the subtotal, tax, and tip needs to add up to the grand total" }
      ],
      model: "gpt-3.5-turbo-1106",
      response_format: { type: "json_object" }
    })

    return completion.choices[0].message.content
  } catch (error) {
    console.error('Error:', error)
  }
}

async function parseWithVeryfi(image) {
  try {
    const response = await fetch('https://api.veryfi.com/api/v8/partner/documents', {
      'method': 'POST',
      'headers': {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'CLIENT-ID': process.env.VERYFI_CLIENT_ID,
        'AUTHORIZATION': `apikey ${process.env.VERYFI_API_KEY}`
      },
      body: JSON.stringify({
        "file_data": image
      })
    })

    if (!response.ok) {
      throw new Error(`Error: ${response.status}`)
    }

    return await response.json()
  } catch (error) {
    console.error('Error:', error)
  }
}

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

const app = express()
const server = https.createServer({key: key, cert: cert }, app)
const port = process.env.SERVER_NODE_PORT

app.use(bodyParser.json({ limit: '10000kb' }))
app.use(cors())

app.get('/view/:id', async (req, res) => {
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

// app.post('/parse', async (req, res) => {
app.get('/parse', async (req, res) => {
  let parsedReceipt
  const receiptParsingMode = process.env.RECEIPT_PARSING_MODE
  
  if (receiptParsingMode === 'GPT') {
    parsedReceipt = await parseWithGPT(req.body.data)
  } else if (receiptParsingMode === 'VERYFI') {
    parsedReceipt = await parseWithVeryfi(req.body.data)
  } else if (receiptParsingMode === 'SAMPLE') {
    const sampleData = readFileSync('./samples/pusu.json')
    parsedReceipt = JSON.parse(sampleData)
  }

  if (parsedReceipt) {
    let dataStorageMode = process.env.DATA_STORAGE_MODE

    if (dataStorageMode === 'DATABASE') {
      const insertedId = await saveToDatabase(parsedReceipt).catch(console.dir)

      const url = `${process.env.DATABASE_VIEWER_ENDPOINT}/${insertedId.toString()}`
      const qr = await QRCode.toDataURL(url)

      res.send({
        url,
        qr
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

server.listen(port, () => {
  console.log(`Listening on port ${port}`)
})