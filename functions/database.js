import { MongoClient, ObjectId } from "mongodb";

// A single shared, pooled client for the whole process. The driver manages an
// internal connection pool, so we connect once lazily and reuse it for every
// operation instead of opening/closing a connection per call.
let clientPromise = null;

function getClient() {
  if (!clientPromise) {
    const uri = `mongodb://${encodeURIComponent(
      process.env.MONGODB_USERNAME
    )}:${encodeURIComponent(process.env.MONGODB_PASSWORD)}@${
      process.env.MONGODB_SERVER
    }`;
    clientPromise = new MongoClient(uri).connect();
  }
  return clientPromise;
}

async function getCollection() {
  const client = await getClient();
  return client
    .db(process.env.MONGODB_DATABASE)
    .collection(process.env.MONGODB_COLLECTION);
}

function extractCheckedBy(doc, itemId) {
  if (!doc || !doc.parsed || !doc.parsed.line_items) return [];
  const item = doc.parsed.line_items.find((li) => li.id === itemId);
  return item && Array.isArray(item.checkedBy) ? item.checkedBy : [];
}

export async function readFromDatabase(id) {
  const collection = await getCollection();
  return collection.findOne({ _id: new ObjectId(id) });
}

export async function saveToDatabase(data) {
  const collection = await getCollection();
  const result = await collection.insertOne(data);
  return result.insertedId;
}

// Atomically add a single socketId to an item's checkedBy and return the
// authoritative resulting array. Concurrent calls from different devices are
// safe: $addToSet never clobbers another writer and de-dupes automatically.
export async function addItemCheckedBy(sessionId, itemId, socketId) {
  const collection = await getCollection();
  const doc = await collection.findOneAndUpdate(
    { _id: new ObjectId(sessionId) },
    { $addToSet: { "parsed.line_items.$[match].checkedBy": socketId } },
    { arrayFilters: [{ "match.id": itemId }], returnDocument: "after" }
  );
  return extractCheckedBy(doc, itemId);
}

// Atomically remove a single socketId from an item's checkedBy and return the
// authoritative resulting array.
export async function removeItemCheckedBy(sessionId, itemId, socketId) {
  const collection = await getCollection();
  const doc = await collection.findOneAndUpdate(
    { _id: new ObjectId(sessionId) },
    { $pull: { "parsed.line_items.$[match].checkedBy": socketId } },
    { arrayFilters: [{ "match.id": itemId }], returnDocument: "after" }
  );
  return extractCheckedBy(doc, itemId);
}

// Atomically add a socketId to many items at once (used to restore a returning
// member's selections). Returns one { itemId, checkedBy } per requested item.
export async function addItemsCheckedBy(sessionId, itemIds, socketId) {
  if (!itemIds || itemIds.length === 0) return [];
  const collection = await getCollection();
  const doc = await collection.findOneAndUpdate(
    { _id: new ObjectId(sessionId) },
    { $addToSet: { "parsed.line_items.$[match].checkedBy": socketId } },
    {
      arrayFilters: [{ "match.id": { $in: itemIds } }],
      returnDocument: "after",
    }
  );
  return itemIds.map((itemId) => ({
    itemId,
    checkedBy: extractCheckedBy(doc, itemId),
  }));
}

export async function clearItemsCheckedBySocketId(sessionId, socketId) {
  const collection = await getCollection();
  return collection.updateOne(
    { _id: new ObjectId(sessionId) },
    { $pull: { "parsed.line_items.$[match].checkedBy": socketId } },
    { arrayFilters: [{ "match.checkedBy": { $in: [socketId] } }] }
  );
}

export async function cleanUpAllCheckedBy(sessionId, sessionMembersData) {
  const receiptData = await readFromDatabase(sessionId);

  if (receiptData && receiptData.parsed && receiptData.parsed.line_items) {
    const staleSocketIds = new Set();
    receiptData.parsed.line_items.forEach((item) => {
      (item.checkedBy || []).forEach((socketId) => {
        if (!sessionMembersData.some((member) => member.id === socketId)) {
          staleSocketIds.add(socketId);
        }
      });
    });

    await Promise.all(
      [...staleSocketIds].map((socketId) =>
        clearItemsCheckedBySocketId(sessionId, socketId)
      )
    );
  }
}

export async function setInitiatorData(data) {
  const collection = await getCollection();
  return collection.updateOne(
    { _id: new ObjectId(data.sessionId) },
    {
      $set: {
        "initiator.cashTag": data.cashTag,
        "initiator.venmoHandle": data.venmoHandle,
        "initiator.humanName": data.humanName,
      },
    }
  );
}

export async function setTipAmount(data) {
  const collection = await getCollection();
  return collection.updateOne(
    { _id: new ObjectId(data.sessionId) },
    {
      $set: {
        "parsed.tip": data.tip,
        isManualTipAmount: true,
      },
    }
  );
}

export async function setTotalsLocked(sessionId, locked) {
  const collection = await getCollection();
  return collection.updateOne(
    { _id: new ObjectId(sessionId) },
    { $set: { isLocked: locked } }
  );
}

// --- Session state persistence -------------------------------------------
// Mirrors the volatile in-RAM creator/member maps onto the receipt doc so a
// server restart doesn't orphan a session. Members are keyed by socket.id
// (URL-safe, so valid as a Mongo field name) under `session.members`.

export async function setSessionCreator(sessionId, socketId) {
  const collection = await getCollection();
  return collection.updateOne(
    { _id: new ObjectId(sessionId) },
    { $set: { "session.creatorSocketId": socketId } }
  );
}

export async function addSessionMember(sessionId, socketId, joinedFrom) {
  const collection = await getCollection();
  return collection.updateOne(
    { _id: new ObjectId(sessionId) },
    { $set: { [`session.members.${socketId}`]: { joinedFrom } } }
  );
}

export async function removeSessionMember(sessionId, socketId) {
  const collection = await getCollection();
  return collection.updateOne(
    { _id: new ObjectId(sessionId) },
    { $unset: { [`session.members.${socketId}`]: "" } }
  );
}

export async function getSessionState(sessionId) {
  const collection = await getCollection();
  const doc = await collection.findOne(
    { _id: new ObjectId(sessionId) },
    { projection: { session: 1 } }
  );
  return doc && doc.session ? doc.session : null;
}
