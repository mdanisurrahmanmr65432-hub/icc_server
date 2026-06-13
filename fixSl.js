const { MongoClient } = require("mongodb");
require("dotenv").config();
const dns = require('dns');

// DNS Fix
dns.setServers(['8.8.8.8', '8.8.4.4']);

const uri = "mongodb+srv://icc_clients_db:ACr1MMNkPwtatOHd@cluster0.f8tqfks.mongodb.net/?appName=Cluster0";

if (!uri) {
  console.error("DBURL not found in .env file");
  process.exit(1);
}

async function fixSL() {
  const client = new MongoClient(uri);

  try {
    await client.connect();
    console.log("MongoDB Connected ✔️");

    const db = client.db("icc_clients");
    const collection = db.collection("users");

    const result = await collection.updateMany(
      { ip: { $exists: true, $type: "string" } }, // শুধু স্ট্রিং আইপি আছে এমন ডকুমেন্ট ফিল্টার করবে
      [
        {
          $set: {
            sl: {
              $convert: {
                input: {
                  $first: {
                    $split: ["$ip", "-"]
                  }
                },
                to: "int",
                onError: "$sl",  // 👈 যদি কনভার্ট করতে ভুল হয় (যেমন 'K' পায়), তবে আগের 'sl' এর মান যা ছিল তাই থাকবে, ক্র্যাশ করবে না।
                onNull: 0        // 👈 যদি কোনো কারণে মান null হয়, তবে 0 বসবে।
              }
            }
          }
        }
      ]
    );

    console.log("Update Completed ✔️");
    console.log("Matched:", result.matchedCount);
    console.log("Modified:", result.modifiedCount);

  } catch (error) {
    console.error("Error:", error.message);
  } finally {
    await client.close();
    console.log("MongoDB Connection Closed ✔️");
  }
}

fixSL();