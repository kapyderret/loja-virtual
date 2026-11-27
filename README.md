# Loja Virtual + PIX Mercado Pago + Railway

## O que tem no projeto
- Loja responsiva com carrinho e checkout
- Painel admin (login: admin / admin123)
- PIX automático via Mercado Pago (QR Code + copia e cola)
- Webhook: quando o cliente paga, o pedido vira "Confirmado" sozinho

---

## PASSO A PASSO COMPLETO

### 1. Criar conta no GitHub
1. Acesse https://github.com/signup
2. Crie a conta e confirme o e-mail

### 2. Criar repositório
1. Em github.com clique em **New repository**
2. Nome: `loja-virtual`
3. Deixe **Public**
4. **Não** marque README
5. Clique em Create repository

### 3. Enviar o código (no seu computador)

Baixe o ZIP deste projeto, descompacte e no terminal:

```bash
cd loja2
git init
git add .
git commit -m "Loja virtual com PIX"
git branch -M main
git remote add origin https://github.com/SEU_USUARIO/loja-virtual.git
git push -u origin main
```

(Substitua SEU_USUARIO pelo seu usuário do GitHub)

### 4. Criar conta Mercado Pago
1. Acesse https://www.mercadopago.com.br/hub/registration/business
2. Cadastre com CPF ou CNPJ
3. Complete a verificação de identidade
4. Vá em: **Seu negócio → Configurações → Credenciais**
   ou direto: https://www.mercadopago.com.br/developers/panel/app
5. Crie uma **Aplicação**
6. Copie o **Access Token de Produção** (começa com APP_USR-...)
   - Para testes use o Access Token de **Teste**

### 5. Publicar no Railway
1. Acesse https://railway.app e entre com a conta GitHub
2. **New Project → Deploy from GitHub repo**
3. Selecione `loja-virtual`
4. Railway detecta Node automaticamente
5. Em **Variables** adicione:

| Variável | Valor |
|----------|--------|
| `MP_ACCESS_TOKEN` | Seu Access Token do Mercado Pago |
| `SESSION_SECRET` | qualquer frase longa aleatória |
| `BASE_URL` | a URL que o Railway gerar (ex: https://loja-virtual-production.up.railway.app) |

6. Depois do primeiro deploy, copie a URL pública e coloque em `BASE_URL` (necessário para o webhook do PIX)
7. Redeploy se precisar

### 6. Testar
1. Abra a URL do Railway
2. Compre um produto
3. No checkout preencha os dados
4. Aparecerá o **QR Code PIX**
5. No painel admin (`/admin`) o pedido aparece como Pendente
6. Quando o PIX for pago, vira **Confirmado** automaticamente

---

## Login admin
- URL: `https://sua-url.up.railway.app/admin`
- Usuário: `admin`
- Senha: `admin123`

**Troque a senha depois** (edite o hash em database.js ou peça para eu te passar um script).

---

## Ambiente de teste (Mercado Pago)
Use cartões/PIX de teste da documentação:
https://www.mercadopago.com.br/developers/pt/docs/checkout-api/integration-test/test-cards

No modo teste o QR Code PIX também é gerado e você pode simular o pagamento no painel do MP.

---

## Custos
- Railway: plano gratuito com crédito mensal (suficiente para começar)
- Mercado Pago: taxa por transação PIX (consulte no site deles, costuma ser baixa)

