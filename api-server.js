import express from "express";
import { MongoClient, ObjectId } from "mongodb";
import OpenAI from "openai";
import dotenv from "dotenv";
import cors from "cors";
import fetch from "node-fetch";
import bodyParser from "body-parser";
import fs, { readFileSync } from "fs";
import https from "https";
import QRCode from "qrcode";

import {
  readFromDatabase,
  saveToDatabase,
  setInitiatorData,
  setTipAmount
} from "./functions/database.js";
import { parseWithGPT, parseWithVeryfi } from "./functions/parse-receipt.js";

dotenv.config();

function generateDataString(parsedReceipt) {
  let dataArray = [];

  parsedReceipt.line_items
    .map((line_item) => {
      dataArray.push(
        `${line_item.quantity}:${line_item.description}:${line_item.total}`
      );
    })
    .filter((x) => x);

  dataArray.push(`_s:${parsedReceipt.subtotal}`);
  dataArray.push(`_i:${parsedReceipt.tax}`);
  dataArray.push(`_a:${parsedReceipt.tip}`);
  dataArray.push(`_o:${parsedReceipt.total}`);

  let dataString = dataArray.join(";");

  dataString = encodeURIComponent(dataString);

  return dataString;
}

let key, cert, ca;

if (
  process.env.SERVER_IP === "localhost" ||
  process.env.SERVER_IP === "leo.local"
) {
  key = fs.readFileSync(process.env.LOCAL_KEY);
  cert = fs.readFileSync(process.env.LOCAL_CERT);
}

const app = express();
const server = https.createServer({ key, cert, ca }, app);

app.use(bodyParser.json({ limit: "10000kb" }));
app.use(cors());

server.listen(process.env.SERVER_NODE_PORT, () => {
  console.log(`Listening on port ${process.env.SERVER_NODE_PORT}`);
});

app.post("/getReceiptData", async (req, res) => {
  const sessionId = req.body.sessionId;
  const data = await readFromDatabase(sessionId).catch(console.dir);

  if (data) {
    res.send({
      merchant: {
        name: data.parsed.vendor.name,
        type: data.parsed.vendor.type,
        address: data.parsed.vendor.address
      },
      items: data.parsed.line_items
        .map((line_item) => {
          if (line_item.total) {
            return {
              id: line_item.id,
              description: line_item.description,
              quantity: line_item.quantity,
              price: line_item.total,
              checkedBy: line_item.checkedBy,
              isPaid: line_item.isPaid,
              paidBy: line_item.paidBy
            };
          }
        })
        .filter((x) => x),
      transaction: {
        items: data.parsed.subtotal,
        tip: data.parsed.tip,
        tax: data.parsed.tax,
        total: data.parsed.total
      },
      initiator: data.initiator,
      isManualTipAmount: data.isManualTipAmount
    });
  } else {
    res.sendStatus(404);
  }
});

app.get("/status", async (req, res) => {
  res.send("Success");
});

app.post("/parseReceiptImage", async (req, res) => {
  let imageData = req.body.image;
  let parsedReceipt;
  const receiptParsingMode = process.env.RECEIPT_PARSING_MODE;

  if (receiptParsingMode === "GPT") {
    parsedReceipt = await parseWithGPT(imageData);
  } else if (receiptParsingMode === "VERYFI") {
    parsedReceipt = await parseWithVeryfi(imageData);
  } else if (receiptParsingMode === "SAMPLE") {
    const sampleData = readFileSync("./samples/pusu.json");
    parsedReceipt = JSON.parse(sampleData);
  }

  if (parsedReceipt) {
    let dataStorageMode = process.env.DATA_STORAGE_MODE;

    if (dataStorageMode === "DATABASE") {
      parsedReceipt.line_items = parsedReceipt.line_items.map((line_item) => ({
        ...line_item,
        checkedBy: []
      }));

      const insertedId = await saveToDatabase({
        parsed: parsedReceipt,
        original: imageData,
        initiator: {
          cashTag: "",
          venmoHandle: "",
          humanName: ""
        },
        isManualTipAmount: false
      }).catch(console.dir);

      res.send({
        sessionId: insertedId
      });
    } else if (dataStorageMode === "URL") {
      const dataString = generateDataString(parsedReceipt);

      const url = `${process.env.LOCAL_VIEWER_URL}/${dataString}`;
      const qr = await QRCode.toDataURL(url);

      res.send({
        url,
        qr
      });
    }
  } else {
    res.sendStatus(404);
  }
});

app.post("/setInitiatorData", async (req, res) => {
  const data = req.body;

  if (data) {
    try {
      await setInitiatorData(req.body);
      res.send(req.body);
    } catch (err) {
      console.log(err.stack);
      res.sendStatus(500);
    }
  } else {
    res.sendStatus(404);
  }
});

app.post("/setTipAmount", async (req, res) => {
  const data = req.body;

  if (data) {
    try {
      await setTipAmount(req.body);
      res.send(req.body);
    } catch (err) {
      console.log(err.stack);
      res.sendStatus(500);
    }
  } else {
    res.sendStatus(404);
  }
});

app.post("/generateQrCode", async (req, res) => {
  const sessionId = req.body.sessionId;
  const data = await readFromDatabase(sessionId).catch(console.dir);

  if (data) {
    const url = `${process.env.DATABASE_VIEWER_ENDPOINT}?sessionId=${sessionId}`;
    const qrCode = await QRCode.toDataURL(url, { width: 800 });

    res.send({
      url,
      qrCode
    });
  } else {
    res.sendStatus(404);
  }
});
