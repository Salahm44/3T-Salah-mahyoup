const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' })); // السماح برفع الصور والبيانات الكبيرة دون فقدانها

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

// 1. مسار لإرسال وحفظ رسالة جديدة (تخزين دائم في Firebase)
app.post('/api/messages', async (req, res) => {
  try {
    const messageData = req.body;
    
    if (!messageData.createdAt) {
      messageData.createdAt = Date.now();
    }
    
    // التأكد من حالتها الافتراضية
    if (!messageData.status) {
      messageData.status = 'sent';
    }

    const newMessageRef = db.ref('messages').push();
    await newMessageRef.set(messageData);

    res.status(200).json({ 
      success: true, 
      messageId: newMessageRef.key,
      message: "Message saved permanently in Firebase successfully" 
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 2. مسار لجلب الرسائل من قاعدة البيانات مباشرة
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

// 3. مسار تغيير حالة الرسالة إلى مقروء (PUT / PATCH)
app.put('/api/messages/:id/read', async (req, res) => {
  try {
    const messageId = req.params.id;
    await db.ref(`messages/${messageId}`).update({ status: 'read' });
    res.status(200).json({ success: true, message: "Message marked as read permanently" });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.patch('/api/messages/:id/read', async (req, res) => {
  try {
    const messageId = req.params.id;
    await db.ref(`messages/${messageId}`).update({ status: 'read' });
    res.status(200).json({ success: true, message: "Message marked as read permanently" });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 4. مسار حذف رسالة محددة بناءً على طلب المستخدم
app.delete('/api/messages/:id', async (req, res) => {
  try {
    const messageId = req.params.id;
    await db.ref(`messages/${messageId}`).remove();
    res.status(200).json({ success: true, message: "Message deleted successfully" });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// تحديد المنفذ (Port) التشغيلي لـ Railway
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
