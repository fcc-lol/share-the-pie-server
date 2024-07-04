import { MongoClient, ObjectId } from "mongodb";

export async function readFromDatabase(id) {
  const client = new MongoClient(
    `mongodb://${encodeURIComponent(
      process.env.MONGODB_USERNAME
    )}:${encodeURIComponent(process.env.MONGODB_PASSWORD)}@${
      process.env.MONGODB_SERVER
    }`
  );

  try {
    const database = client.db(process.env.MONGODB_DATABASE);
    const collection = database.collection(process.env.MONGODB_COLLECTION);
    const result = await collection.findOne({ _id: new ObjectId(id) });

    return result;
  } finally {
    await client.close();
  }
}

export async function saveToDatabase(data) {
  const client = new MongoClient(
    `mongodb://${encodeURIComponent(
      process.env.MONGODB_USERNAME
    )}:${encodeURIComponent(process.env.MONGODB_PASSWORD)}@${
      process.env.MONGODB_SERVER
    }`
  );

  try {
    const database = client.db(process.env.MONGODB_DATABASE);
    const collection = database.collection(process.env.MONGODB_COLLECTION);
    const result = await collection.insertOne(data);

    return result.insertedId;
  } finally {
    await client.close();
  }
}

export async function setItemStatusesByItemId(sessionId, itemIds, status) {
  const client = new MongoClient(
    `mongodb://${encodeURIComponent(
      process.env.MONGODB_USERNAME
    )}:${encodeURIComponent(process.env.MONGODB_PASSWORD)}@${
      process.env.MONGODB_SERVER
    }`
  );

  let itemsFilter = [];

  if (typeof itemIds === "object") {
    for (const itemId of itemIds) {
      itemsFilter.push({ "match.id": itemId });
    }
  } else {
    itemsFilter.push({ "match.id": itemIds });
  }

  try {
    const database = client.db(process.env.MONGODB_DATABASE);
    const collection = database.collection(process.env.MONGODB_COLLECTION);

    let setStatus = {};

    const sessionData = await collection.findOne({
      _id: new ObjectId(sessionId),
    });

    const lineItems =
      sessionData && sessionData.parsed && sessionData.parsed.line_items
        ? sessionData.parsed.line_items.find((item) => item.id === itemIds)
        : null;

    for (const key in status) {
      if (key === "checkedBy") {
        setStatus[[`parsed.line_items.$[match].checkedBy`]] = [status[key]];
      } else if (key === "unCheckedBy") {
        setStatus[[`parsed.line_items.$[match].checkedBy`]] =
          lineItems && lineItems.checkedBy
            ? lineItems.checkedBy.filter((item) => item !== status[key])
            : null;
      } else {
        setStatus[[`parsed.line_items.$[match].${key}`]] = status[key];
      }
    }

    const result = await collection.updateOne(
      { _id: new ObjectId(sessionId) },
      { $set: setStatus },
      { arrayFilters: [{ $or: itemsFilter }] }
    );

    return result;
  } catch (err) {
    console.log(err.stack);
  } finally {
    await client.close();
  }
}

export async function setItemStatusesBySocketId(
  sessionId,
  socketIds,
  status,
  itemId
) {
  const client = new MongoClient(
    `mongodb://${encodeURIComponent(
      process.env.MONGODB_USERNAME
    )}:${encodeURIComponent(process.env.MONGODB_PASSWORD)}@${
      process.env.MONGODB_SERVER
    }`
  );

  let socketIdsFilter = [];

  if (typeof socketIds === "object") {
    for (const socketId of socketIds) {
      socketIdsFilter.push({ "match.checkedBy": { $in: [socketId] } });
    }
  } else {
    socketIdsFilter.push({ "match.checkedBy": { $in: [socketIds] } });
  }

  try {
    const database = client.db(process.env.MONGODB_DATABASE);
    const collection = database.collection(process.env.MONGODB_COLLECTION);

    let filter = { _id: new ObjectId(sessionId) };
    let arrayFilters = [];
    let setStatus = {};

    const sessionData = await collection.findOne({
      _id: new ObjectId(sessionId),
    });

    for (const key in status) {
      if (key === "checkedBy") {
        console.log("I'm already checked");

        const lineItems =
          sessionData && sessionData.parsed && sessionData.parsed.line_items
            ? sessionData.parsed.line_items.find((item) => item.id === itemId)
            : null;
        filter["parsed.line_items.id"] = itemId;

        if (lineItems && lineItems.checkedBy) {
          if (lineItems.checkedBy.includes(status[key])) {
            console.log("I'm removing myself from the checked array");
            setStatus[[`parsed.line_items.$.checkedBy`]] =
              lineItems && lineItems.checkedBy
                ? lineItems.checkedBy.filter((item) => item !== status[key])
                : null;
          } else {
            console.log("I'm adding myself to the checked array");
            let newArray = [...lineItems.checkedBy, status[key]];
            setStatus[[`parsed.line_items.$.checkedBy`]] = newArray;
          }
        }
      } else if (key === "unCheckedBy") {
        filter["parsed.line_items.id"] = {
          $elemMatch: {
            checkedBy: socketIds,
          },
        };

        const lineItems =
          sessionData && sessionData.parsed && sessionData.parsed.line_items
            ? sessionData.parsed.line_items
            : null;

        console.log("I'm leaving the room");
        arrayFilters = [{ $or: socketIdsFilter }];
        console.log(status[key]);
        console.log(lineItems);
        setStatus[[`parsed.line_items.$[match].checkedBy`]] =
          lineItems && lineItems.checkedBy
            ? lineItems.checkedBy.filter((item) => item !== status[key])
            : null;
      } else {
        arrayFilters = [{ $or: socketIdsFilter }];
        setStatus[[`parsed.line_items.$[match].${key}`]] = status[key];
      }
    }

    const result = await collection.updateOne(
      filter,
      { $set: setStatus },
      arrayFilters
    );

    return result;
  } catch (err) {
    console.log(err.stack);
  } finally {
    await client.close();
  }
}

export async function setInitiatorData(data) {
  const sessionId = data.sessionId;
  const client = new MongoClient(
    `mongodb://${encodeURIComponent(
      process.env.MONGODB_USERNAME
    )}:${encodeURIComponent(process.env.MONGODB_PASSWORD)}@${
      process.env.MONGODB_SERVER
    }`
  );

  try {
    const database = client.db(process.env.MONGODB_DATABASE);
    const collection = database.collection(process.env.MONGODB_COLLECTION);
    const result = await collection.updateOne(
      { _id: new ObjectId(sessionId) },
      {
        $set: {
          "initiator.cashTag": data.cashTag,
          "initiator.venmoHandle": data.venmoHandle,
          "initiator.humanName": data.humanName,
        },
      }
    );
  } catch (err) {
    console.log(err.stack);
  } finally {
    await client.close();
  }
}

export async function setTipAmount(data) {
  const sessionId = data.sessionId;
  const client = new MongoClient(
    `mongodb://${encodeURIComponent(
      process.env.MONGODB_USERNAME
    )}:${encodeURIComponent(process.env.MONGODB_PASSWORD)}@${
      process.env.MONGODB_SERVER
    }`
  );

  try {
    const database = client.db(process.env.MONGODB_DATABASE);
    const collection = database.collection(process.env.MONGODB_COLLECTION);
    const result = await collection.updateOne(
      { _id: new ObjectId(sessionId) },
      {
        $set: {
          "parsed.tip": data.tip,
          isManualTipAmount: true,
        },
      }
    );
  } catch (err) {
    console.log(err.stack);
  } finally {
    await client.close();
  }
}
