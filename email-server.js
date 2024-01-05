import { SMTPServer } from 'smtp-server'
import { simpleParser } from 'mailparser'
import { MongoClient } from 'mongodb'
import OpenAI from 'openai'
import dotenv from 'dotenv'

dotenv.config()

async function saveToDatabase(record) {
  const username = encodeURIComponent(process.env.MONGODB_USERNAME)
  const password = encodeURIComponent(process.env.MONGODB_PASSWORD)

  const client = new MongoClient(`mongodb://${username}:${password}@localhost/?authMechanism=DEFAULT`)

  try {
    const database = client.db('share-the-pie')
    const collection = database.collection('receipts')
    
    const result = await collection.insertOne(record)

    console.log(`Record saved with id ${result.insertedId}`)
  } finally {
    await client.close()
  }
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

async function parseWithGPT(emailData) {
  const completion = await openai.chat.completions.create({
    messages: [
      {
        role: "system",
        content: "You are a helpful assistant designed to output JSON.",
      },
      { role: "user", content: emailData },
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

const server = new SMTPServer({
  onData(stream, session, callback) {
    simpleParser(stream, {}, async (err, emailData) => {
      if (err) { console.log('error: ' , err) }

      let textFromGPT = await parseWithGPT(emailData.html)
      let jsonFromGPT = JSON.parse(textFromGPT)

      let record = {
        receipt: {
          original: emailData,
          parsed: jsonFromGPT
        },
        groupId: emailData.to.text.replace(`@${process.env.DOMAIN_NAME}`, '')
      }

      await saveToDatabase(record).catch(console.dir)

      stream.on('end', callback)
    })

  },
  disabledCommands: ['AUTH']
})

server.listen(process.env.SERVER_SMTP_PORT, process.env.SERVER_IP, () => {
  console.log(`Server started on ${process.env.SERVER_IP} at port ${process.env.SERVER_SMTP_PORT}\n\nListening for emails sent to *@${process.env.DOMAIN_NAME}`);
})