import express from 'express'
import { MongoClient, ObjectId } from 'mongodb'
import OpenAI from 'openai'
import dotenv from 'dotenv'
import cors from 'cors'

dotenv.config()

const app = express()
const port = 4000

const username = encodeURIComponent(process.env.MONGODB_USERNAME)
const password = encodeURIComponent(process.env.MONGODB_PASSWORD)

const uri = `mongodb://${username}:${password}@${process.env.MONGODB_SERVER}`

async function run(id) {
  const client = new MongoClient(uri)

  try {
    const database = client.db('share-the-pie')
    const collection = database.collection('receipts')

    const result = await collection.findOne({ _id: new ObjectId(id) })

    return result
  } finally {
    await client.close()
  }
}

async function parseWithGPT(imageData) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
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
            "url": imageData
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
}

app.use(cors())

app.get('/view/:id', async (req, res) => {
  const data = await run(req.params.id).catch(console.dir)

  if (data) {
    res.send(data.receipt.parsed)
  } else {
    res.sendStatus(404)
  }
})

app.get('/parse', async (req, res) => {
  const data = await parseWithGPT()

  if (data) {
    res.send(data)
  } else {
    res.sendStatus(404)
  }
})

app.listen(port, () => {
  console.log(`Listening on port ${port}`)
})