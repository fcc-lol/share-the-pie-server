import express from 'express'
import { MongoClient, ObjectId } from 'mongodb'
import dotenv from 'dotenv'

dotenv.config()

const app = express()
const port = 3000

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

app.get('/record/:id', async (req, res) => {
  const data = await run(req.params.id).catch(console.dir)

  if (data) {
    res.send(data.receipt.parsed.items)
  } else {
    res.sendStatus(404)
  }
})

app.listen(port, () => {
  console.log(`Listening on port ${port}`)
})