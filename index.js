const express = require('express');
const cors = require('cors');
const dns = require('dns');
require('dotenv').config();

const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// DNS Fix
dns.setServers(['8.8.8.8', '8.8.4.4']);

// MongoDB URI
const uri = process.env.DBURL;

if (!uri) {
  console.error('DBURL not found in .env file');
  process.exit(1);
}

// MongoDB Client
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// 🛠️ সার্ভারলেস ফ্রেন্ডলি কানেকশন ম্যানেজমেন্ট (Topology Closed সমস্যার সমাধান)
let dbConnection = null;
async function getCollection() {
  if (!dbConnection) {
    await client.connect();
    dbConnection = client.db('icc_clients');
    console.log('MongoDB Connected Successfully ✔️');
  }
  return dbConnection.collection('users');
}

// Insert Client
app.post('/insert-client', async (req, res) => {
  try {
    const myColl = await getCollection();
    const body = req.body;

    const existingClient = await myColl.findOne({
      $or: [
        { mobile: body.mobile },
        { ip: body.ip }
      ]
    });

    if (existingClient) {
      return res.status(400).send({
        success: false,
        message: 'Client already exists'
      });
    }

    body.createdAt = new Date();
    body.status = 'Active';

    // ফ্রন্টএন্ড থেকে sl স্ট্রিং হিসেবে আসলেও ডাটাবেজে নাম্বার হিসেবে সেভ হবে
    if (body.sl) {
      body.sl = parseInt(body.sl, 10) || body.sl;
    }

    const result = await myColl.insertOne(body);

    res.status(201).send({
      success: true,
      result
    });

  } catch (error) {
    res.status(500).send({
      success: false,
      message: error.message
    });
  }
});

// Get All Clients (🛠️ নাম্বার এবং স্ট্রিং সার্চ ফিক্সড)
app.get('/get-client-data', async (req, res) => {
  try {
    const myColl = await getCollection();
    const { search } = req.query;

    let query = {};

    if (search) {
      const searchNumber = parseInt(search, 10);
      
      if (!isNaN(searchNumber)) {
        // যদি ইউজার পিওর নাম্বার লিখে সার্চ করে (যেমন: 224), তবে sl ম্যাচ করবে
        query.$or = [
          { sl: searchNumber },
          { client_name: { $regex: search, $options: 'i' } },
          { mobile: { $regex: search, $options: 'i' } }
        ];
      } else {
        // যদি টেক্সট সার্চ করে, তবে নাম, মোবাইল আর আইপি খুঁজবে
        query.$or = [
          { client_name: { $regex: search, $options: 'i' } },
          { mobile: { $regex: search, $options: 'i' } },
          { ip: { $regex: search, $options: 'i' } },
        ];
      }
    }

    const result = await myColl
      .find(query)
      .sort({ sl: 1 })
      .toArray();

    res.status(200).send(result);

  } catch (error) {
    res.status(500).send({
      success: false,
      message: error.message
    });
  }
});

// Update Status
app.patch('/update-status', async (req, res) => {
  try {
    const myColl = await getCollection();
    const { id, status } = req.body;

    const result = await myColl.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          status,
        },
      }
    );

    res.status(200).send({
      success: true,
      result
    });

  } catch (error) {
    res.status(500).send({
      success: false,
      message: error.message
    });
  }
});

// Delete Client
app.delete('/delete-client/:id', async (req, res) => {
  try {
    const myColl = await getCollection();
    const { id } = req.params;

    const result = await myColl.deleteOne({
      _id: new ObjectId(id),
    });

    res.status(200).send({
      success: true,
      result
    });

  } catch (error) {
    res.status(500).send({
      success: false,
      message: error.message
    });
  }
});

// Root Route
app.get('/', (req, res) => {
  res.send('ICC Client Server Running');
});

// Server Start
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

// Vercel-এর জন্য এক্সপোর্ট
module.exports = app;