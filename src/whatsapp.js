const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode');
const path = require('path');
const fs = require('fs');
const pino = require('pino');
const agent = require('./agent');

let sock = null;
let currentQR = null;
let connected = false;
let reconnectTimer = null;
let isStarting = false;
let qrWasShown = false;

// Fila de mensagens para evitar chamadas paralelas à API
const messageQueue = [];
let processingQueue = false;

async function processQueue() {
  if (processingQueue) return;
  processingQueue = true;
  while (messageQueue.length > 0) {
    const { from, text } = messageQueue.shift();
    try {
      const reply = await agent.reply(from, text);
      if (sock) await sock.sendMessage(from, { text: reply });
      console.log(`📤 Resposta para ${from}: ${reply.substring(0, 80)}...`);
      if (global.io) global.io.emit('message', { from, text: reply, direction: 'outgoing', time: new Date().toISOString() });
    } catch (err) {
      console.error(`Erro ao responder ${from}:`, err.message);
    }
  }
  processingQueue = false;
}

function hasCredentials() {
  const credsPath = path.join(__dirname, '../auth_info/creds.json');
  if (!fs.existsSync(credsPath)) return false;
  try {
    const creds = JSON.parse(fs.readFileSync(credsPath, 'utf-8'));
    return !!creds.me;
  } catch {
    return false;
  }
}

async function start() {
  console.log(`[WA] start() chamado — isStarting=${isStarting} hasCredentials=${hasCredentials()}`);
  if (isStarting) {
    console.log('[WA] já está iniciando, abortando.');
    return;
  }
  isStarting = true;
  clearTimeout(reconnectTimer);

  if (sock) {
    sock.ev.removeAllListeners();
    try { sock.end(undefined); } catch (_) {}
    sock = null;
  }

  let state, saveCreds, version;
  try {
    console.log('[WA] carregando auth_info...');
    ({ state, saveCreds } = await useMultiFileAuthState(
      path.join(__dirname, '../auth_info')
    ));
    console.log('[WA] buscando versão do Baileys...');
    ({ version } = await fetchLatestBaileysVersion());
    console.log('[WA] versão obtida:', version);
  } catch (err) {
    isStarting = false;
    console.error('[WA] ❌ Erro ao inicializar:', err.message, err.stack);
    if (global.io) global.io.emit('qr_expired', { message: 'Erro ao conectar. Clique em Reconectar.' });
    return;
  }

  console.log('[WA] criando socket...');
  sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    browser: ['WhatsApp', 'Chrome', '120.0.0'],
  });

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    console.log(`[WA] connection.update — connection=${connection} qr=${!!qr} lastDisconnect.statusCode=${lastDisconnect?.error?.output?.statusCode}`);

    if (qr) {
      qrWasShown = true;
      currentQR = await qrcode.toDataURL(qr);
      connected = false;
      console.log('[WA] 📱 QR Code gerado, emitindo via socket...');
      if (global.io) global.io.emit('qr', { qr: currentQR });
      else console.warn('[WA] global.io não disponível, QR não emitido via socket!');
    }

    if (connection === 'open') {
      isStarting = false;
      qrWasShown = false;
      connected = true;
      currentQR = null;
      console.log('[WA] ✅ WhatsApp conectado!');
      if (global.io) global.io.emit('status', { connected: true });
    }

    if (connection === 'close') {
      isStarting = false;
      connected = false;
      currentQR = null;

      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;
      console.log(`[WA] conexão fechada — statusCode=${statusCode} loggedOut=${loggedOut} qrWasShown=${qrWasShown}`);

      if (loggedOut) {
        console.log('[WA] 🚪 Sessão encerrada — limpando credenciais.');
        const credsPath = path.join(__dirname, '../auth_info/creds.json');
        try { if (fs.existsSync(credsPath)) fs.unlinkSync(credsPath); } catch (_) {}
        if (global.io) global.io.emit('qr_expired', { message: 'Sessão encerrada. Clique em Reconectar.' });
        return;
      }

      if (qrWasShown) {
        qrWasShown = false;
        console.log('[WA] ⏳ QR expirou sem scan.');
        if (global.io) global.io.emit('qr_expired', { message: 'QR Code expirou. Clique em Reconectar.' });
        return;
      }

      if (hasCredentials()) {
        console.log('[WA] 🔄 Reconectando em 5s...');
        if (global.io) global.io.emit('status', { connected: false });
        reconnectTimer = setTimeout(() => start(), 5000);
      } else {
        console.log('[WA] sem credenciais, aguardando ação do usuário.');
        if (global.io) global.io.emit('qr_expired', { message: 'Desconectado. Clique em Reconectar.' });
      }
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (msg.key.remoteJid.endsWith('@g.us')) continue;

      const from = msg.key.remoteJid;
      const text =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        '';

      if (!text.trim()) continue;

      if (msg.key.fromMe) {
        agent.pauseContact(from);
        console.log(`⏸️  Agente pausado 30min para ${from} (resposta do funcionário)`);
        continue;
      }

      console.log(`📩 Mensagem de ${from}: ${text}`);

      if (global.io) {
        global.io.emit('message', {
          from,
          text,
          direction: 'incoming',
          time: new Date().toISOString(),
        });
      }

      if (agent.isPaused(from)) {
        console.log(`⏸️  Agente pausado para ${from} — mensagem ignorada`);
        continue;
      }

      messageQueue.push({ from, text });
      processQueue();
    }
  });
}

async function disconnect() {
  clearTimeout(reconnectTimer);
  isStarting = false;
  if (sock) {
    try { await sock.logout(); } catch (_) {}
    sock.ev.removeAllListeners();
    sock = null;
  }
  connected = false;
  currentQR = null;
  // Limpar credenciais para que o próximo start() gere um novo QR
  const credsPath = path.join(__dirname, '../auth_info/creds.json');
  try { if (fs.existsSync(credsPath)) fs.unlinkSync(credsPath); } catch (_) {}
}

function getQR() {
  return currentQR;
}

function isConnected() {
  return connected;
}

module.exports = { start, disconnect, getQR, isConnected };