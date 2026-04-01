const fs = require('fs');
const path = require('path');
const Groq = require('groq-sdk');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Histórico de conversas por contato (em memória)
const conversations = new Map();
// Contatos pausados: contactId → timestamp de retomada
const pausedUntil = new Map();
// Histórico para o dashboard
const messageHistory = [];
// Estatísticas
const stats = { total: 0, today: 0, lastDate: null };

const PAUSE_MINUTES = 30;

function pauseContact(contactId, minutes = PAUSE_MINUTES) {
  const until = Date.now() + minutes * 60 * 1000;
  pausedUntil.set(contactId, until);
  if (global.io) global.io.emit('pause', { contactId: contactId.replace('@s.whatsapp.net', ''), until });
}

function resumeContact(contactId) {
  pausedUntil.delete(contactId);
  if (global.io) global.io.emit('resume', { contactId: contactId.replace('@s.whatsapp.net', '') });
}

function isPaused(contactId) {
  const until = pausedUntil.get(contactId);
  if (!until) return false;
  if (Date.now() >= until) {
    pausedUntil.delete(contactId);
    return false;
  }
  return true;
}

function getPausedContacts() {
  const result = [];
  for (const [id, until] of pausedUntil) {
    if (Date.now() < until) {
      result.push({ contactId: id.replace('@s.whatsapp.net', ''), until });
    } else {
      pausedUntil.delete(id);
    }
  }
  return result;
}

// Carregar base de conhecimento
function loadKnowledge() {
  const filePath = path.join(__dirname, '../conhecimento.md');
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return 'Base de conhecimento não encontrada.';
  }
}

// Gerar resposta
async function reply(contactId, userMessage) {
  const knowledge = loadKnowledge();
  const businessName = process.env.BUSINESS_NAME || 'Meu Negócio';

  // Histórico de contexto do contato (últimas 10 mensagens)
  if (!conversations.has(contactId)) {
    conversations.set(contactId, []);
  }
  const history = conversations.get(contactId);

  // Adicionar mensagem do usuário ao histórico
  history.push({ role: 'user', content: userMessage });

  // Manter só as últimas 10 trocas
  if (history.length > 20) history.splice(0, 2);

  const systemPrompt = `Você é um assistente virtual de atendimento ao cliente da empresa "${businessName}".

Sua missão é responder dúvidas dos clientes de forma clara, objetiva e educada com base nas informações abaixo.

BASE DE CONHECIMENTO:
${knowledge}

INSTRUÇÕES IMPORTANTES:
- Responda sempre em português do Brasil
- Seja CURTO e DIRETO — máximo 2-3 frases por resposta
- Exceção: quando o cliente perguntar sobre preços, valores, senhas de Wi-Fi ou listas de itens, responda de forma completa e não omita nenhum dado
- Ao informar senhas de Wi-Fi, use este formato exato:
  📶 *Rede:* NomeDaRede
  🔑 *Senha:* \`\`\`senha\`\`\`
- Ao informar preços/tarifas, use este formato exato (um item por linha):
  🏷️ *Nome do item* — R$ 00,00
- Nunca use parágrafos longos para informações simples
- Use no máximo 1 emoji por mensagem
- Nunca invente informações que não estão na base de conhecimento
- Se não souber a resposta, diga apenas: "Vou verificar e te retorno em breve!"
- Se o cliente quiser falar com humano, diga apenas: "Claro, aguarda um momento que chamo um atendente!"
- Não mencione que você é uma IA, a menos que o cliente pergunte diretamente`;

  const response = await groq.chat.completions.create({
    model: 'llama-3.1-8b-instant',
    messages: [
      { role: 'system', content: systemPrompt },
      ...history,
    ],
    max_tokens: 300,
    temperature: 0.7,
  });

  const assistantReply = response.choices[0].message.content;

  // Salvar resposta no histórico de contexto
  history.push({ role: 'assistant', content: assistantReply });

  // Salvar no histórico do dashboard
  const entry = {
    id: Date.now(),
    contact: contactId.replace('@s.whatsapp.net', ''),
    userMessage,
    agentReply: assistantReply,
    time: new Date().toISOString(),
  };
  messageHistory.unshift(entry);
  if (messageHistory.length > 100) messageHistory.pop();

  // Atualizar stats
  stats.total++;
  const today = new Date().toDateString();
  if (stats.lastDate !== today) {
    stats.today = 0;
    stats.lastDate = today;
  }
  stats.today++;

  return assistantReply;
}

function getHistory() {
  return messageHistory.slice(0, 50);
}

function getStats() {
  return { ...stats };
}

module.exports = { reply, getHistory, getStats, pauseContact, resumeContact, isPaused, getPausedContacts };
