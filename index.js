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

    // ১. ব্যাকএন্ডে ডাটা টাইপ নিশ্চিত করা (ডাটাবেজ সেফটি)
    if (body.sl) {
      body.sl = parseInt(body.sl, 10);
    }
    if (body.amount) {
      body.amount = parseFloat(body.amount) || 0; // বিল অ্যামাউন্ট অবশ্যই নাম্বারে কনভার্ট হবে
    }

    // ২. ডুপ্লিকেট ক্লায়েন্ট চেক (মোবাইল অথবা আইপি)
    const existingClient = await myColl.findOne({
      $or: [
        { mobile: body.mobile },
        { ip: body.ip }
      ]
    });

    if (existingClient) {
      // ডুপ্লিকেট পাওয়া গেলে সরাসরি ৪০০ রেসপন্স পাঠিয়ে রিটার্ন
      return res.status(400).json({
        success: false,
        message: 'Client with this IP or Mobile already exists!'
      });
    }

    // ৩. ডিফল্ট প্রপার্টিজ সেট করা
    body.createdAt = new Date();
    body.status = 'Active';

    // ৪. ডাটাবেজে ইনসার্ট
    const result = await myColl.insertOne(body);

    // ৫. সাকসেস রেসপন্স
    return res.status(201).json({
      success: true,
      result
    });

  } catch (error) {
    console.error("Backend Error:", error); // ডিবাগিং এর জন্য কনসোলে এরর প্রিন্ট
    return res.status(500).json({
      success: false,
      message: error.message || 'Internal Server Error'
    });
  }
});

// 🔄 Get All Clients with Dynamic Promise Data (🛠️ Lookup/Join ফিক্সড)
app.get('/get-client-data', async (req, res) => {
  try {
    const db = dbConnection || (await client.connect(), client.db('icc_clients'));
    const myColl = db.collection('users');
    const { search } = req.query;

    let matchQuery = {};

    if (search) {
      const searchNumber = parseInt(search, 10);
      
      if (!isNaN(searchNumber)) {
        // যদি ইউজার পিওর নাম্বার লিখে সার্চ করে (যেমন: 224), তবে sl ম্যাচ করবে
        matchQuery.$or = [
          { sl: searchNumber },
          { client_name: { $regex: search, $options: 'i' } },
          { mobile: { $regex: search, $options: 'i' } }
        ];
      } else {
        // যদি টেক্সট সার্চ করে, তবে নাম, মোবাইল আর আইপি খুঁজবে
        matchQuery.$or = [
          { client_name: { $regex: search, $options: 'i' } },
          { mobile: { $regex: search, $options: 'i' } },
          { ip: { $regex: search, $options: 'i' } },
        ];
      }
    }

    // 📅 চলতি মাসের বছর ও মাস বের করা (প্রমিজ ম্যাচ করার জন্য)
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;

    // Aggregation Pipeline ব্যবহার করে ডাটাবেজ লেভেলেই Join করা হচ্ছে ফ্রন্টএন্ড গ্রিন বাটনের জন্য
    const result = await myColl.aggregate([
      { $match: matchQuery },
      {
        $lookup: {
          from: 'promises', 
          let: { clientIdStr: { $toString: "$_id" } }, 
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$clientId", "$$clientIdStr"] },
                    { $eq: ["$promise_year", currentYear] },
                    { $eq: ["$promise_month", currentMonth] }
                  ]
                }
              }
            }
          ],
          as: 'current_promise'
        }
      },
      {
        $addFields: {
          // যদি প্রমিজ থাকে তবে প্রথম অবজেক্টটি সেট করবে, না থাকলে null
          promiseInfo: { $ifNull: [{ $arrayElemAt: ["$current_promise", 0] }, null] }
        }
      },
      { $project: { current_promise: 0 } }, 
      { $sort: { sl: 1 } }
    ]).toArray();

    res.status(200).send(result);

  } catch (error) {
    console.error("Fetch Clients Error:", error);
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

// ১. 🤝 পেমেন্ট প্রমিজ সেভ এবং আপডেট করার রাউট (IP ফিল্ডসহ আপগ্রেডেড)
app.patch('/update-promise-date', async (req, res) => {
  try {
    const db = dbConnection || (await client.connect(), client.db('icc_clients'));
    const promiseCollection = db.collection('promises'); 
    const clientCollection = db.collection('users');    

    // ⚡ বডি থেকে ip নেওয়া হচ্ছে
    const { id, client_name, ip, promise_date, promise_note, address } = req.body;

    // ভ্যালিডেশন চেক
    if (!id || !promise_date) {
      return res.status(400).send({ message: "Client ID and Promise Date are required" });
    }

    // 📅 প্রমিজ ডেট থেকে বছর এবং মাস আলাদা করা
    const dateObj = new Date(promise_date);
    const year = dateObj.getFullYear();
    const month = dateObj.getMonth() + 1;

    const query = {
      clientId: id,
      promise_year: year,
      promise_month: month
    };

    // 📝 ডাটা অবজেক্টে ip যুক্ত করা হলো
    const updateDoc = {
      $set: {
        clientId: id,
        client_name: client_name || '',
        ip: ip || 'N/A', // ⚡ promises কালেকশনে আইপি সেভ হবে
        address: address || '', 
        promise_date: promise_date,
        promise_note: promise_note || '',
        promise_year: year,
        promise_month: month,
        updatedAt: new Date()
      }
    };

    const options = { upsert: true };
    const result = await promiseCollection.updateOne(query, updateDoc, options);

    // 🔄 মূল clientCollection-এও লেটেস্ট প্রমিজ ডাটার সাথে আইপি আপডেট (ঐচ্ছিক, আইপি সাধারণত ফিক্সড থাকে)
    await clientCollection.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          latest_promise_date: promise_date,
          latest_promise_note: promise_note || ''
        }
      }
    );

    res.send({ 
      success: true, 
      message: "Promise recorded perfectly with IP tracking!", 
      result 
    });

  } catch (error) {
    console.error("Promise Patch/Add Error:", error);
    res.status(500).send({ message: error.message || "Internal Server Error" });
  }
});


// 📑 প্রমিজ পেজে ফিল্টারিং এবং প্যাগিনেশনসহ (Per Page: 30) GET রাউট (🛠️ কালেকশন রেফারেন্স ফিক্সড)
app.get('/get-promises-data', async (req, res) => {
  try {
    const db = dbConnection || (await client.connect(), client.db('icc_clients'));
    const promiseCollection = db.collection('promises'); // 👈 এই লাইনটি মিসিং ছিল, ফিক্স করা হয়েছে।

    const { date, address, page = 1 } = req.query;
    const limit = 30; // 👈 রিকোয়ারমেন্ট অনুযায়ী প্রতি পেজে ৩০টি ডাটা
    const skip = (parseInt(page) - 1) * limit;

    // 🔍 ডাইনামিক কুয়েরি অবজেক্ট তৈরি
    let query = {};

    // ১. নির্দিষ্ট ডেট ফিল্টার (যদি ফ্রন্টএন্ড থেকে পাঠানো হয়)
    if (date) {
      query.promise_date = date; // Format: YYYY-MM-DD
    }

    // ২. অ্যাড্রেস/লোকেশন সার্চ ফিল্টার (Case-Insensitive)
    if (address) {
      query.address = { $regex: address, $options: 'i' };
    }

    // 🗂️ মোট কতগুলো ম্যাচিং ডাটা আছে তা কাউন্ট করা (প্যাগিনেশনের জন্য জরুরি)
    const totalPromises = await promiseCollection.countDocuments(query);

    // 🔄 ডাটা ফেচ করা (Pagination + Sorting)
    const promisesData = await promiseCollection
      .find(query)
      .sort({ promise_date: 1 }) // সামনের ডেটগুলো আগে দেখাবে
      .skip(skip)
      .limit(limit)
      .toArray();

    // 📤 ফ্রন্টএন্ডে টোটাল কাউন্ট ও ডাটা একসাথে পাঠানো
    res.send({
      totalPromises,
      totalPages: Math.ceil(totalPromises / limit) || 1,
      currentPage: parseInt(page),
      data: promisesData
    });

  } catch (error) {
    console.error("Fetch Promises Error:", error);
    res.status(500).send({ message: "Internal Server Error" });
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

    // ২. নাম, মোবাইল বা আইপি দিয়ে সার্চ করার লজিক (যদি থাকে)
    if (search) {
      query.$or = [
        { client_name: { $regex: search, $options: 'i' } },
        { mobile: { $regex: search, $options: 'i' } },
        { ip: { $regex: search, $options: 'i' } }
      ];
    }

    const result = await paymentsColl
      .find(query)
      .sort({ paidDate: 1 }) // লেটেস্ট পেমেন্ট আগে দেখাবে
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

    // কোয়েরি প্যারামিটার থেকে paidId (Client ID) নেওয়া হচ্ছে
    const { paidId } = req.query; 
    const { amount } = req.body; // ফ্রন্টএন্ড থেকে পাঠানো অ্যামাউন্ট বা বডি ডাটা

    if (!paidId) {
      return res.status(400).send({ success: false, message: 'Client ID (paidId) is required' });
    }

    // ১. চলতি মাসের (Current Month) শুরু এবং শেষের সময় বের করা
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1); // মাসের ১ তারিখ 00:00:00
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59); // মাসের শেষ তারিখ 23:59:59

    // ২. চেক করা হচ্ছে এই ক্লায়েন্ট এই মাসে অলরেডি পেমেন্ট করেছে কিনা
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

    // ৩. ক্লায়েন্টের বাকি তথ্য (যেমন নাম) 'users' কালেকশন থেকে নিয়ে আসা
    const usersColl = db.collection('users');
    const clientData = await usersColl.findOne({ _id: new ObjectId(paidId) });

    if (!clientData) {
      return res.status(404).send({ success: false, message: 'Client not found' });
    }

    // ৪. পেমেন্টের জন্য নতুন অবজেক্ট তৈরি (receiptNo যুক্ত করা হয়েছে)
    const paymentInfo = {
      clientId: clientData._id,
      client_name: clientData.client_name,
      mobile: clientData.mobile || 'N/A',
      sl: clientData.sl || 'N/A',
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


// 📝 ক্লায়েন্টের সমস্ত তথ্য এডিট/আপডেট করার রাউট
app.patch('/update-client', async (req, res) => {
  try {
    const myColl = await getCollection();
    const { id, client_name, mobile, ip, zone, speed, amount, address, status } = req.body;

    if (!id) {
      return res.status(400).send({ success: false, message: 'Client ID is required' });
    }

    // ডাটাবেজে সেভ করার আগে টাইপ ফিক্সিং এবং অবজেক্ট তৈরি
    const updateData = {
      client_name,
      mobile,
      ip,
      zone: zone || '',
      speed: speed || '',
      amount: parseInt(amount, 10) || 0, // স্ট্রিং থেকে নাম্বারে কনভার্ট
      address: address || '',
      status: status || '', 
      updatedAt: new Date()
    };

    const result = await myColl.updateOne(
      { _id: new ObjectId(id) },
      { $set: updateData }
    );

    if (result.matchedCount === 0) {
      return res.status(404).send({ success: false, message: 'Client not found' });
    }

    res.status(200).send({
      success: true,
      message: 'Client updated successfully ✔️',
      result
    });

  } catch (error) {
    console.error("Update Client Error:", error);
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