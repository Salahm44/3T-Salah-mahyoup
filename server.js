const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const path = require('path');

const app = express();

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.static(__dirname));

// ======================================
// إعدادات Firebase
// ======================================

let db;
let firebaseReady = false;

try {
    const serviceAccount = JSON.parse(
        process.env.FIREBASE_SERVICE_ACCOUNT
    );

    if (!admin.apps.length) {
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            databaseURL:
                process.env.FIREBASE_DATABASE_URL ||
                'https://salah-mahyoup-default-rtdb.asia-southeast1.firebasedatabase.app'
        });
    }

    db = admin.database();
    firebaseReady = true;

    console.log('Firebase connected successfully');

} catch (error) {
    console.error('Firebase initialization error:', error.message);
}

// ======================================
// إعدادات Telegram
// ======================================

const BOT_TOKEN = process.env.BOT_TOKEN;
const APP_URL = process.env.APP_URL;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

const TELEGRAM_API = BOT_TOKEN
    ? `https://api.telegram.org/bot${BOT_TOKEN}`
    : null;

async function telegramRequest(method, data) {
    if (!TELEGRAM_API) {
        throw new Error('BOT_TOKEN is missing');
    }

    const response = await fetch(
        `${TELEGRAM_API}/${method}`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        }
    );

    const result = await response.json();

    if (!result.ok) {
        throw new Error(
            result.description || 'Telegram API error'
        );
    }

    return result.result;
}

// ======================================
// التحقق من جاهزية الخدمات
// ======================================

function checkServices(req, res, next) {
    if (!firebaseReady || !db) {
        return res.status(503).json({
            success: false,
            error: 'Firebase is unavailable'
        });
    }

    if (!BOT_TOKEN) {
        return res.status(503).json({
            success: false,
            error: 'Telegram bot is not configured'
        });
    }

    next();
}

// ======================================
// التحقق من هوية مستخدم Firebase
// ======================================

async function authenticate(req, res, next) {
    try {
        const header = req.headers.authorization || '';

        if (!header.startsWith('Bearer ')) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required'
            });
        }

        const token = header.substring(7);

        const decoded = await admin.auth().verifyIdToken(token);

        req.uid = decoded.uid;

        next();

    } catch (error) {
        return res.status(401).json({
            success: false,
            error: 'Invalid authentication token'
        });
    }
}

// ======================================
// البحث عن حساب Firebase بواسطة UID
// ======================================

async function findUserByUid(uid) {
    const snapshot = await db
        .ref('users')
        .orderByChild('uid')
        .equalTo(uid)
        .once('value');

    if (!snapshot.exists()) {
        return null;
    }

    const users = snapshot.val();
    const key = Object.keys(users)[0];

    return {
        key,
        ...users[key]
    };
}

// ======================================
// الصفحة الرئيسية
// ======================================

app.get('/', (req, res) => {
    res.sendFile(
        path.join(__dirname, 'index.html')
    );
});

// ======================================
// حالة الخادم
// ======================================

app.get('/api/status', (req, res) => {
    res.json({
        success: true,
        server: 'online',
        firebase: firebaseReady,
        telegram: !!BOT_TOKEN
    });
});

// ======================================
// تفعيل Telegram وربط الحساب
// ======================================

app.post(
    '/api/telegram/link',
    checkServices,
    authenticate,
    async (req, res) => {
        try {
            const user = await findUserByUid(req.uid);

            if (!user) {
                return res.status(404).json({
                    success: false,
                    error: 'User not found'
                });
            }

            const customId = user.customId;

            if (!customId) {
                return res.status(400).json({
                    success: false,
                    error: 'Account ID is missing'
                });
            }

            const activationCode =
                `activate_${customId}`;

            const link =
                `https://t.me/${process.env.BOT_USERNAME}?start=${activationCode}`;

            res.json({
                success: true,
                activationLink: link
            });

        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }
);

// ======================================
// استقبال تحديثات Telegram
// ======================================

app.post(
    `/api/telegram/webhook/${WEBHOOK_SECRET || 'disabled'}`,
    async (req, res) => {

        res.sendStatus(200);

        try {
            if (!firebaseReady || !BOT_TOKEN) return;

            const update = req.body;

            if (!update.message) return;

            const message = update.message;

            const telegramChatId = String(
                message.chat.id
            );

            const telegramUserId = String(
                message.from.id
            );

            const text = message.text || '';

            // تفعيل الحساب
            if (text.startsWith('/start activate_')) {

                const customId = text
                    .replace('/start activate_', '')
                    .trim();

                const snapshot = await db
                    .ref('users')
                    .orderByChild('customId')
                    .equalTo(customId)
                    .once('value');

                if (!snapshot.exists()) {
                    await telegramRequest('sendMessage', {
                        chat_id: telegramChatId,
                        text: 'لم يتم العثور على الحساب.'
                    });

                    return;
                }

                const users = snapshot.val();
                const userKey = Object.keys(users)[0];

                await db.ref(`users/${userKey}`).update({
                    telegramChatId,
                    telegramUserId,
                    telegramLinkedAt: Date.now()
                });

                await telegramRequest('sendMessage', {
                    chat_id: telegramChatId,
                    text: 'تم ربط حسابك بالتطبيق بنجاح.'
                });

                return;
            }

            // لا نعالج رسائل غير مرتبطة بحساب مفعل
            const snapshot = await db
                .ref('users')
                .orderByChild('telegramChatId')
                .equalTo(telegramChatId)
                .once('value');

            if (!snapshot.exists()) return;

            console.log(
                'Telegram message received for linked account'
            );

        } catch (error) {
            console.error(
                'Telegram webhook error:',
                error.message
            );
        }
    }
);

// ======================================
// إرسال رسالة من التطبيق
// ======================================

app.post(
    '/api/messages',
    checkServices,
    authenticate,
    async (req, res) => {

        try {
            const sender = await findUserByUid(req.uid);

            if (!sender) {
                return res.status(404).json({
                    success: false,
                    error: 'Sender account not found'
                });
            }

            const {
                recipientId,
                text,
                media,
                mediaType,
                replyTo
            } = req.body;

            if (!recipientId) {
                return res.status(400).json({
                    success: false,
                    error: 'Recipient is required'
                });
            }

            if (!text && !media) {
                return res.status(400).json({
                    success: false,
                    error: 'Empty message'
                });
            }

            const recipient = await findUserByUid(
                recipientId
            );

            if (!recipient || recipient.banned) {
                return res.status(404).json({
                    success: false,
                    error: 'Recipient not found'
                });
            }

            if (!recipient.telegramChatId) {
                return res.status(400).json({
                    success: false,
                    error: 'Recipient Telegram is not activated'
                });
            }

            const messageData = {
                senderId: sender.uid,
                recipientId: recipient.uid,
                text: text || '',
                media: media || null,
                mediaType: mediaType || null,
                replyTo: replyTo || null,
                senderDisplay: sender.name || '',
                status: 'sent',
                createdAt: Date.now()
            };

            // حفظ الرسالة في Firebase
            const messageRef = db.ref('messages').push();

            await messageRef.set(messageData);

            // إرسال الرسالة عبر Telegram
            let telegramResult;

            if (media) {
                throw new Error(
                    'Media relay requires a separate Telegram upload handler'
                );
            }

            telegramResult = await telegramRequest(
                'sendMessage',
                {
                    chat_id: recipient.telegramChatId,
                    text: text || 'رسالة جديدة من التطبيق'
                }
            );

            res.json({
                success: true,
                messageId: messageRef.key,
                telegramMessageId: telegramResult.message_id
            });

        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }
);

// ======================================
// جلب رسائل المستخدم فقط
// ======================================

app.get(
    '/api/messages',
    checkServices,
    authenticate,
    async (req, res) => {

        try {
            const snapshot = await db
                .ref('messages')
                .once('value');

            const allMessages = snapshot.val() || {};

            const messages = {};

            for (const [id, message] of Object.entries(allMessages)) {

                if (
                    message.senderId === req.uid ||
                    message.recipientId === req.uid
                ) {
                    messages[id] = message;
                }
            }

            res.json({
                success: true,
                messages
            });

        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }
);

// ======================================
// تحديث حالة الرسالة
// ======================================

app.put(
    '/api/messages/:id/read',
    authenticate,
    async (req, res) => {

        try {
            const ref = db.ref(
                `messages/${req.params.id}`
            );

            const snapshot = await ref.once('value');

            if (!snapshot.exists()) {
                return res.status(404).json({
                    success: false
                });
            }

            const message = snapshot.val();

            if (message.recipientId !== req.uid) {
                return res.status(403).json({
                    success: false,
                    error: 'Access denied'
                });
            }

            await ref.update({
                status: 'read'
            });

            res.json({
                success: true
            });

        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }
);

// ======================================
// حذف رسالة
// ======================================

app.delete(
    '/api/messages/:id',
    authenticate,
    async (req, res) => {

        try {
            const ref = db.ref(
                `messages/${req.params.id}`
            );

            const snapshot = await ref.once('value');

            if (!snapshot.exists()) {
                return res.status(404).json({
                    success: false
                });
            }

            const message = snapshot.val();

            if (
                message.senderId !== req.uid &&
                message.recipientId !== req.uid
            ) {
                return res.status(403).json({
                    success: false,
                    error: 'Access denied'
                });
            }

            await ref.remove();

            res.json({
                success: true
            });

        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }
);

// ======================================
// إعداد Webhook تلقائياً
// ======================================

async function setupTelegramWebhook() {

    if (!BOT_TOKEN || !APP_URL || !WEBHOOK_SECRET) {
        console.log(
            'Telegram webhook configuration is incomplete'
        );
        return;
    }

    try {
        const webhookUrl =
            `${APP_URL}/api/telegram/webhook/${WEBHOOK_SECRET}`;

        await telegramRequest('setWebhook', {
            url: webhookUrl
        });

        console.log('Telegram webhook configured');

    } catch (error) {
        console.error(
            'Webhook setup error:',
            error.message
        );
    }
}

// ======================================
// تشغيل الخادم
// ======================================

const PORT = process.env.PORT || 8080;

app.listen(PORT, '0.0.0.0', () => {

    console.log(
        `SMS Internet Pro running on port ${PORT}`
    );

    setupTelegramWebhook();
});
