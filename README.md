# 🤖 Agente IA para WhatsApp

Agente de atendimento automático para WhatsApp com base de conhecimento editável via dashboard web.

## Pré-requisitos

- Node.js 18+
- Conta gratuita no [Groq](https://console.groq.com) para a API de IA

## Instalação

```bash
# 1. Instalar dependências
npm install

# 2. Configurar variáveis de ambiente
cp .env.example .env
# Edite o .env e coloque sua chave do Groq

# 3. Rodar
npm start
```

## Configuração

Edite o arquivo `.env`:

```
GROQ_API_KEY=sua_chave_groq_aqui
BUSINESS_NAME=Nome da Sua Empresa
PORT=3000
```

## Uso

1. Rode `npm start`
2. Acesse `http://localhost:3000`
3. Escaneie o QR Code com o WhatsApp
4. Edite a base de conhecimento no dashboard
5. Pronto! O agente já está respondendo seus clientes

## Como atualizar as informações

Edite diretamente no dashboard web em `http://localhost:3000` ou edite o arquivo `conhecimento.md` na raiz do projeto. As mudanças são aplicadas imediatamente na próxima mensagem.

## ⚠️ Aviso

Este projeto usa a biblioteca Baileys (não oficial) para conectar ao WhatsApp. Existe risco de banimento do número. Recomenda-se usar um número secundário para testes.

Para produção com segurança, use a [WhatsApp Business API oficial](https://developers.facebook.com/docs/whatsapp).
# whatsapp-agent-istoe-pousada
