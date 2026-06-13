
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

async function run() {
  try {
    await client.connect();

    console.log('MongoDB Connected Successfully');

    const myDB = client.db('icc_clients');
    const myColl = myDB.collection('users');

    // Insert Client
    app.post('/insert-client', async (req, res) => {
      try {
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

    // Get All Clients
    app.get('/get-client-data', async (req, res) => {
      try {
        const { search } = req.query;

        const query = {};

        if (search) {
          query.$or = [
            { client_name: { $regex: search, $options: 'i' } },
            { mobile: { $regex: search, $options: 'i' } },
            { sl: { $regex: search, $options: 'i' } },
          ];
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

    // MongoDB Ping
    await client.db('admin').command({ ping: 1 });
    console.log('MongoDB Ping Successful');

  } catch (error) {
    console.error(error);
  }
}

run();

// Root Route
app.get('/', (req, res) => {
  res.send('ICC Client Server Running');
});

// Server Start
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

