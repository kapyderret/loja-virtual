require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const { MercadoPagoConfig, Payment } = require('mercadopago');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

// Mercado Pago
const mpAccessToken = process.env.MP_ACCESS_TOKEN || '';
let paymentClient = null;
if (mpAccessToken) {
  const client = new MercadoPagoConfig({ accessToken: mpAccessToken });
  paymentClient = new Payment(client);
  console.log('Mercado Pago configurado');
} else {
  console.log('AVISO: MP_ACCESS_TOKEN não definido. PIX automático desativado.');
}

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  }
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadDir));

app.use(session({
  secret: process.env.SESSION_SECRET || 'loja-virtual-secret-change-me-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000, httpOnly: true, sameSite: 'lax' }
}));

function requireAdmin(req, res, next) {
  if (req.session && req.session.adminId) return next();
  return res.status(401).json({ error: 'Não autorizado' });
}

// ========== ROTAS PÚBLICAS ==========

app.get('/api/settings', (req, res) => {
  const settings = db.getSettings();
  settings.pix_enabled = !!mpAccessToken;
  res.json(settings);
});

app.get('/api/products', (req, res) => {
  const { search, category } = req.query;
  res.json(db.getProducts({ search, category }));
});

app.get('/api/categories', (req, res) => {
  res.json(db.getCategories());
});

app.get('/api/products/:id', (req, res) => {
  const product = db.getProduct(req.params.id);
  if (!product) return res.status(404).json({ error: 'Produto não encontrado' });
  res.json(product);
});

// Criar pedido + gerar PIX Mercado Pago
app.post('/api/orders', async (req, res) => {
  const {
    customer_name, phone, email, cpf, cep, state, city,
    address, number, complement, items
  } = req.body;

  if (!customer_name || !phone || !cep || !state || !city || !address || !number || !items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Dados incompletos. Preencha todos os campos obrigatórios.' });
  }

  let total = 0;
  const orderItems = [];

  for (const item of items) {
    const product = db.getProduct(item.product_id);
    if (!product) return res.status(400).json({ error: `Produto ID ${item.product_id} não encontrado` });
    if (product.stock < item.quantity) {
      return res.status(400).json({ error: `Estoque insuficiente para "${product.name}". Disponível: ${product.stock}` });
    }
    total += product.price * item.quantity;
    orderItems.push({
      product_id: product.id,
      product_name: product.name,
      quantity: item.quantity,
      price: product.price
    });
  }

  total = Math.round(total * 100) / 100;
  const orderNumber = 'PED-' + Date.now().toString().slice(-8) + Math.floor(Math.random() * 100);

  const order = db.createOrder({
    order_number: orderNumber,
    customer_name, phone,
    email: email || null,
    cpf: cpf || null,
    cep, state, city, address, number,
    complement: complement || null,
    total,
    status: 'Pendente',
    mp_payment_id: null,
    pix_qr_code: null,
    pix_qr_base64: null,
    pix_copy_paste: null
  }, orderItems);

  // Gerar PIX via Mercado Pago
  let pixData = null;
  if (paymentClient) {
    try {
      const notificationUrl = process.env.BASE_URL
        ? `${process.env.BASE_URL}/api/webhooks/mercadopago`
        : undefined;

      const paymentBody = {
        transaction_amount: total,
        description: `Pedido ${orderNumber} - ${customer_name}`,
        payment_method_id: 'pix',
        payer: {
          email: email || `${phone.replace(/\D/g, '')}@cliente.loja`,
          first_name: customer_name.split(' ')[0],
          last_name: customer_name.split(' ').slice(1).join(' ') || customer_name.split(' ')[0],
          identification: cpf ? {
            type: 'CPF',
            number: cpf.replace(/\D/g, '')
          } : undefined
        },
        external_reference: orderNumber,
        notification_url: notificationUrl
      };

      const result = await paymentClient.create({ body: paymentBody });
      const txData = result.point_of_interaction?.transaction_data;

      if (txData) {
        pixData = {
          qr_code: txData.qr_code,
          qr_code_base64: txData.qr_code_base64,
          ticket_url: txData.ticket_url
        };
        db.updateOrderPix(order.id, {
          mp_payment_id: String(result.id),
          pix_qr_code: txData.qr_code,
          pix_qr_base64: txData.qr_code_base64,
          pix_copy_paste: txData.qr_code
        });
      }
    } catch (err) {
      console.error('Erro Mercado Pago:', err.message || err);
      // Pedido continua, mas sem PIX automático
    }
  }

  res.status(201).json({
    success: true,
    order_number: orderNumber,
    order_id: order.id,
    total,
    pix: pixData,
    message: pixData
      ? 'Pedido criado! Pague com PIX para confirmar.'
      : 'Pedido realizado! Entraremos em contato para o pagamento.'
  });
});

// Consultar status do pedido (para o cliente verificar se pagou)
app.get('/api/orders/:orderNumber/status', (req, res) => {
  const order = db.getOrderByNumber(req.params.orderNumber);
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado' });
  res.json({
    order_number: order.order_number,
    status: order.status,
    total: order.total,
    paid: ['Confirmado', 'Preparando', 'Enviado', 'Concluído'].includes(order.status)
  });
});

// Webhook Mercado Pago
app.post('/api/webhooks/mercadopago', async (req, res) => {
  res.status(200).send('OK'); // Responde rápido

  try {
    const topic = req.query.topic || req.query.type || req.body?.type;
    const id = req.query.id || req.query['data.id'] || req.body?.data?.id;

    if ((topic === 'payment' || topic === 'payment.created' || topic === 'payment.updated') && id && paymentClient) {
      const payment = await paymentClient.get({ id });
      if (payment && payment.external_reference) {
        const order = db.getOrderByNumber(payment.external_reference);
        if (order) {
          if (payment.status === 'approved') {
            db.updateOrderStatus(order.id, 'Confirmado');
            console.log(`Pedido ${order.order_number} PAGO via PIX`);
          } else if (payment.status === 'cancelled' || payment.status === 'rejected') {
            // mantém Pendente ou pode marcar como cancelado
            console.log(`Pagamento ${payment.status} para ${order.order_number}`);
          }
        }
      }
    }
  } catch (err) {
    console.error('Webhook error:', err.message);
  }
});

// ========== ROTAS ADMIN ==========

app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  const admin = db.getAdmin(username);
  if (!admin || !bcrypt.compareSync(password, admin.password)) {
    return res.status(401).json({ error: 'Usuário ou senha inválidos' });
  }
  req.session.adminId = admin.id;
  req.session.username = admin.username;
  res.json({ success: true, username: admin.username });
});

app.post('/api/admin/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/api/admin/me', (req, res) => {
  if (req.session && req.session.adminId) {
    return res.json({ authenticated: true, username: req.session.username });
  }
  res.json({ authenticated: false });
});

app.get('/api/admin/dashboard', requireAdmin, (req, res) => {
  res.json(db.getDashboard());
});

app.get('/api/admin/orders', requireAdmin, (req, res) => {
  res.json(db.getOrders());
});

app.put('/api/admin/orders/:id/status', requireAdmin, (req, res) => {
  const { status } = req.body;
  const allowed = ['Pendente', 'Confirmado', 'Preparando', 'Enviado', 'Concluído'];
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Status inválido' });
  if (!db.updateOrderStatus(req.params.id, status)) {
    return res.status(404).json({ error: 'Pedido não encontrado' });
  }
  res.json({ success: true });
});

app.get('/api/admin/customers', requireAdmin, (req, res) => {
  res.json(db.getCustomers());
});

app.get('/api/admin/products', requireAdmin, (req, res) => {
  res.json(db.getProducts());
});

app.post('/api/admin/products', requireAdmin, upload.single('image'), (req, res) => {
  const { name, description, price, category, stock } = req.body;
  if (!name || !price) return res.status(400).json({ error: 'Nome e preço são obrigatórios' });
  const image = req.file ? '/uploads/' + req.file.filename : '';
  const product = db.createProduct({
    name,
    description: description || '',
    price: parseFloat(price),
    category: category || '',
    image,
    stock: parseInt(stock) || 0
  });
  res.status(201).json({ id: product.id, success: true });
});

app.put('/api/admin/products/:id', requireAdmin, upload.single('image'), (req, res) => {
  const product = db.getProduct(req.params.id);
  if (!product) return res.status(404).json({ error: 'Produto não encontrado' });

  const { name, description, price, category, stock } = req.body;
  const updates = {};
  if (name) updates.name = name;
  if (description !== undefined) updates.description = description;
  if (price !== undefined) updates.price = parseFloat(price);
  if (category !== undefined) updates.category = category;
  if (stock !== undefined) updates.stock = parseInt(stock);
  if (req.file) updates.image = '/uploads/' + req.file.filename;

  db.updateProduct(req.params.id, updates);
  res.json({ success: true });
});

app.delete('/api/admin/products/:id', requireAdmin, (req, res) => {
  if (!db.deleteProduct(req.params.id)) {
    return res.status(404).json({ error: 'Produto não encontrado' });
  }
  res.json({ success: true });
});

app.put('/api/admin/settings', requireAdmin, (req, res) => {
  const { store_name, store_logo } = req.body;
  const updates = {};
  if (store_name !== undefined) updates.store_name = store_name;
  if (store_logo !== undefined) updates.store_logo = store_logo;
  db.updateSettings(updates);
  res.json({ success: true });
});

app.get('/admin*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin', 'index.html'));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  console.log(`Admin: /admin  |  Login: admin / admin123`);
});
