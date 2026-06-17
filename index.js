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

// পেমেন্ট চেক করার API
app.get('/check-payment/:id', async (req, res) => {
  try {
    const db = dbConnection || (await client.connect(), client.db('icc_clients'));
    const paymentsColl = db.collection('payments');
    const { id } = req.params;

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    const paid = await paymentsColl.findOne({
      clientId: new ObjectId(id),
      paidDate: { $gte: startOfMonth, $lte: endOfMonth }
    });

    res.send({ isPaid: !!paid }); // থাকলে true, না থাকলে false পাঠাবে
  } catch (error) {
    res.status(500).send({ message: error.message });
  }
});


// 📑 Get Payments History with Advanced Date Filtering
app.get('/get-payments-data', async (req, res) => {
  try {
    const db = dbConnection || (await client.connect(), client.db('icc_clients'));
    const paymentsColl = db.collection('payments');

    // ফ্রন্টএন্ড থেকে startDate এবং endDate পাঠানো হবে (Format: YYYY-MM-DD)
    const { startDate, endDate, search } = req.query;

    let query = {};

    // ১. ডেট ফিল্টারিং লজিক
    if (startDate && endDate) {
      query.paidDate = {
        $gte: new Date(`${startDate}T00:00:00.000Z`),
        $lte: new Date(`${endDate}T23:59:59.999Z`)
      };
    }

    // ২. নাম, মোবাইল বা আইপি দিয়ে সার্চ করার লজিক (যদি থাকে)
    if (search) {
      query.$or = [
        { client_name: { $regex: search, $options: 'i' } },
        { mobile: { $regex: search, $options: 'i' } },
        { ip: { $regex: search, $options: 'i' } }
      ];
    }

    const result = await paymentsColl
      .find(query)
      .sort({ paidDate: -1 }) // লেটেস্ট পেমেন্ট আগে দেখাবে
      .toArray();

    res.status(200).send({
      success: true,
      totalPayments: result.length,
      data: result
    });

  } catch (error) {
    res.status(500).send({
      success: false,
      message: error.message
    });
  }
});


/// 💳 Payments Collection API (একই মাসে ডাবল পেমেন্ট আটকানোর লজিকসহ)
app.post('/payments', async (req, res) => {
  try {
    const db = dbConnection || (await client.connect(), client.db('icc_clients'));
    const paymentsColl = db.collection('payments'); // পেমেন্টের জন্য আলাদা কালেকশন

    // কোয়েরি প্যারামিটার থেকে paidId (Client ID) নেওয়া হচ্ছে
    const { paidId } = req.query; 
    const { amount } = req.body; // ফ্রন্টএন্ড থেকে পাঠানো অ্যামাউন্ট বা বডি ডাটা

    if (!paidId) {
      return res.status(400).send({ success: false, message: 'Client ID (paidId) is required' });
    }

    // ১. চলতি মাসের (Current Month) শুরু এবং শেষের সময় বের করা
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1); // মাসের ১ তারিখ 00:00:00
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59); // মাসের শেষ তারিখ 23:59:59

    // ২. চেক করা হচ্ছে এই ক্লায়েন্ট এই মাসে অলরেডি পেমেন্ট করেছে কিনা
    const alreadyPaidThisMonth = await paymentsColl.findOne({
      clientId: new ObjectId(paidId),
      paidDate: {
        $gte: startOfMonth,
        $lte: endOfMonth
      }
    });

    if (alreadyPaidThisMonth) {
      return res.status(400).send({
        success: false,
        message: 'This client has already paid for the current month!'
      });
    }

    // ৩. ক্লায়েন্টের বাকি তথ্য (যেমন নাম) 'users' কালেকশন থেকে নিয়ে আসা
    const usersColl = db.collection('users');
    const clientData = await usersColl.findOne({ _id: new ObjectId(paidId) });

    if (!clientData) {
      return res.status(404).send({ success: false, message: 'Client not found' });
    }

    // ৪. পেমেন্টের জন্য নতুন অবজেক্ট তৈরি (receiptNo যুক্ত করা হয়েছে)
const paymentInfo = {
  clientId: clientData._id,
  client_name: clientData.client_name,
  mobile: clientData.mobile || 'N/A',
  ip: clientData.ip || 'N/A',
  amount: parseInt(amount, 10) || clientData.amount || 0,
  receiptNo: req.body.receiptNo, // ফ্রন্টএন্ড থেকে পাঠানো রসিদ নম্বরটি সেভ হবে
  paidDate: new Date(),
  status: 'Paid'
};

    // ৫. ডাটাবেজে পেমেন্ট সেভ করা
    const result = await paymentsColl.insertOne(paymentInfo);

    res.status(201).send({
      success: true,
      message: 'Payment completed successfully ✔️',
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