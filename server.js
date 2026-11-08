const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');

const app = express();
app.use(cors());
app.use(express.json());

// تهيئة فايربيس باستخدام متغيرات البيئة في Railway (المفتاح السري والرابط)
try {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL || "https://salah-mahyoup-default-rtdb.asia-southeast1.firebasedatabase.app"
  });

  console.log("Firebase Admin Initialized Successfully!");
} catch (error) {
  console.error("Failed to initialize Firebase Admin:", error.message);
}

const db = admin.database();

// مسار تجريبي للتأكد من أن السيرفر يعمل
app.get('/', (req, res) => {
  res.send('Railway Proxy Server for Salah-Mahyoup is running successfully!');
});

// مسار لإرسال وحفظ رسالة جديدة (يتوافق مع قواعد الحماية لديك)
app.post('/api/messages', async (req, res) => {
  try {
    const messageData = req.body;
    
    // التأكد من وجود الوقت الحالي إن لم يُرسل
    if (!messageData.createdAt) {
      messageData.createdAt = Date.now();
    }

    const newMessageRef = db.ref('messages').push();
    await newMessageRef.set(messageData);

    res.status(200).json({ 
      success: true, 
      messageId: newMessageRef.key,
      message: "Message saved successfully" 
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// مسار لجلب الرسائل
app.get('/api/messages', async (req, res) => {
  try {
    const snapshot = await db.ref('messages').once('value');
    res.status(200).json({ 
      success: true, 
      messages: snapshot.val() || {} 
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// تحديد المنفذ (Port) التشغيلي لـ Railway
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
