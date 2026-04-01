require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { createServer } = require('http');
const { Server } = require('socket.io') ;

// Importar módulos internos
const whatsapp = require('./whatsapp');
const agent = require('./agent');

const app = express();
const httpServer = createServer(app);

// Socket.IO para atualizações em tempo real no dashboard
let io;
try {
  const { Server } = require('socket.io');
  io = new Server(httpServer, { cors: { origin: '*' } });
} catch {
  io = { emit: () => {} };
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Exportar io para outros módulos
global.io = io;

// ── ROTAS DA API ──────────────────────────────────────────────

// Status geral
app.get('/api/status', (req, res) => {
  res.json({
    connected: whatsapp.isConnected(),
    businessName: process.env.BUSINESS_NAME || 'Meu Negócio',
    messagesHandled: agent.getStats().total,
  });
});

// QR Code para conectar WhatsApp
app.get('/api/qr', (req, res) => {
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

// Ler base de conhecimento
app.get('/api/knowledge', (req, res) => {
  const content = fs.readFileSync(knowledgePath, 'utf-8');
  res.json({ content });
});

// Atualizar base de conhecimento
app.post('/api/knowledge', (req, res) => {
  const { content } = req.body;
  if (content === undefined) return res.status(400).json({ error: 'Conteúdo vazio' });
  fs.writeFileSync(knowledgePath, content, 'utf-8');
  res.json({ success: true });
});

// Observar o arquivo e emitir via socket quando alterado externamente
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

// Histórico de mensagens
app.get('/api/messages', (req, res) => {
  res.json(agent.getHistory());
});

// Estatísticas
app.get('/api/stats', (req, res) => {
  res.json(agent.getStats());
});

// Listar contatos pausados
app.get('/api/paused', (_req, res) => {
  res.json(agent.getPausedContacts());
});

// Pausar agente para um contato manualmente
app.post('/api/pause/:contactId', (req, res) => {
  const jid = req.params.contactId + '@s.whatsapp.net';
  const minutes = Number(req.body.minutes) || 30;
  agent.pauseContact(jid, minutes);
  res.json({ success: true });
});

// Retomar agente para um contato
app.post('/api/resume/:contactId', (req, res) => {
  const jid = req.params.contactId + '@s.whatsapp.net';
  agent.resumeContact(jid);
  res.json({ success: true });
});

// Desconectar WhatsApp
app.post('/api/disconnect', async (req, res) => {
  await whatsapp.disconnect();
  res.json({ success: true });
});

// Iniciar conexão WhatsApp
app.post('/api/connect', async (req, res) => {
  whatsapp.start();
  res.json({ success: true, message: 'Iniciando conexão...' });
});

// ── INICIAR SERVIDOR ──────────────────────────────────────────

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`\n🚀 Servidor rodando em http://localhost:${PORT}`);
  console.log(`📱 Acesse o dashboard para conectar seu WhatsApp\n`);
});

// Iniciar WhatsApp automaticamente
whatsapp.start();
