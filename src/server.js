require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const { createServer } = require('http');
const { Server } = require('socket.io');

const whatsapp = require('./whatsapp');
const agent = require('./agent');

const app = express();
const httpServer = createServer(app);

let io;
try {
  io = new Server(httpServer, { cors: { origin: '*' } });
} catch {
  io = { emit: () => {} };
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

global.io = io;

const JWT_SECRET = process.env.JWT_SECRET || 'agente-ia-secret-local';


// ── AUTH MIDDLEWARE ───────────────────────────────────────────

function requireAuth(req, res, next) {
  const header = req.headers['authorization'];
  const token = header && header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Não autenticado' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido ou expirado' });
  }
}

// ── LOGIN ─────────────────────────────────────────────────────

app.post('/api/login', (req, res) => {
  const { username } = req.body;
  const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token });
});

// Redirecionar raiz para login se não autenticado (tratado no front)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ── ROTAS DA API (protegidas) ─────────────────────────────────

app.get('/api/status', requireAuth, (req, res) => {
  res.json({
    connected: whatsapp.isConnected(),
    businessName: process.env.BUSINESS_NAME || 'Meu Negócio',
    messagesHandled: agent.getStats().total,
  });
});

app.get('/api/qr', requireAuth, (req, res) => {
  const qr = whatsapp.getQR();
  if (qr) {
    res.json({ qr });
  } else if (whatsapp.isConnected()) {
    res.json({ connected: true });
  } else {
    res.json({ waiting: true });
  }
});

const knowledgePath = path.join(__dirname, '../conhecimento.md');

app.get('/api/knowledge', requireAuth, (req, res) => {
  const content = fs.readFileSync(knowledgePath, 'utf-8');
  res.json({ content });
});

app.post('/api/knowledge', requireAuth, (req, res) => {
  const { content } = req.body;
  if (content === undefined) return res.status(400).json({ error: 'Conteúdo vazio' });
  fs.writeFileSync(knowledgePath, content, 'utf-8');
  res.json({ success: true });
});

let lastEmittedContent = null;
fs.watch(knowledgePath, () => {
  try {
    const content = fs.readFileSync(knowledgePath, 'utf-8');
    if (content !== lastEmittedContent) {
      lastEmittedContent = content;
      if (global.io) global.io.emit('knowledge', { content });
    }
  } catch (_) {}
});

app.get('/api/messages', requireAuth, (req, res) => {
  res.json(agent.getHistory());
});

app.get('/api/stats', requireAuth, (req, res) => {
  res.json(agent.getStats());
});

app.get('/api/paused', requireAuth, (_req, res) => {
  res.json(agent.getPausedContacts());
});

app.post('/api/pause/:contactId', requireAuth, (req, res) => {
  const jid = req.params.contactId + '@s.whatsapp.net';
  const minutes = Number(req.body.minutes) || 30;
  agent.pauseContact(jid, minutes);
  res.json({ success: true });
});

app.post('/api/resume/:contactId', requireAuth, (req, res) => {
  const jid = req.params.contactId + '@s.whatsapp.net';
  agent.resumeContact(jid);
  res.json({ success: true });
});

app.post('/api/disconnect', requireAuth, async (req, res) => {
  await whatsapp.disconnect();
  res.json({ success: true });
});

app.post('/api/connect', requireAuth, async (req, res) => {
  whatsapp.start();
  res.json({ success: true, message: 'Iniciando conexão...' });
});

// ── INICIAR SERVIDOR ──────────────────────────────────────────

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`\n🚀 Servidor rodando em http://localhost:${PORT}`);
  console.log(`📱 Acesse o dashboard para conectar seu WhatsApp\n`);
  
});

whatsapp.start();
