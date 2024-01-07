import { MongoClient, ObjectId } from 'mongodb'

export async function readFromDatabase(id) {
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

export async function saveToDatabase(data) {
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