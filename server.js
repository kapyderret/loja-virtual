require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

let paymentClient = null;
try {
  const token = process.env.MP_ACCESS_TOKEN || '';
  if (token) {
    const { MercadoPagoConfig, Payment } = require('mercadopago');
    paymentClient = new Payment(new MercadoPagoConfig({ accessToken: token }));
    console.log('Mercado Pago OK');
  }
} catch (e) {
  console.log('MP off:', e.message);
}

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: (r, f, cb) => cb(null, uploadDir),
    filename: (r, f, cb) => cb(null, Date.now() + path.extname(f.originalname))
  }),
  limits: { fileSize: 5 * 1024 * 1024 }
});

app.set('trust proxy', 1);
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadDir));
app.use(session({
  secret: process.env.SESSION_SECRET || 'loja-secret-2026',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 86400000, httpOnly: true, sameSite: 'lax' }
}));

function requireAdmin(req, res, next) {
  if (req.session && req.session.adminId) return next();
  return res.status(401).json({ error: 'Nao autorizado' });
}

app.get('/health', (req, res) => res.status(200).send('ok'));

app.get('/api/settings', (req, res) => {
  const s = db.getSettings();
  s.pix_enabled = !!paymentClient;
  res.json(s);
});

app.get('/api/products', (req, res) => {
  res.json(db.getProducts({ search: req.query.search, category: req.query.category }));
});

app.get('/api/categories', (req, res) => res.json(db.getCategories()));

app.get('/api/products/:id', (req, res) => {
  const p = db.getProduct(req.params.id);
  if (!p) return res.status(404).json({ error: 'Nao encontrado' });
  res.json(p);
});

app.post('/api/orders', async (req, res) => {
  try {
    const b = req.body;
    if (!b.customer_name || !b.phone || !b.cep || !b.state || !b.city || !b.address || !b.number || !b.items || !b.items.length) {
      return res.status(400).json({ error: 'Dados incompletos' });
    }
    let total = 0;
    const orderItems = [];
    for (const item of b.items) {
      const product = db.getProduct(item.product_id);
      if (!product) return res.status(400).json({ error: 'Produto invalido' });
      if (product.stock < item.quantity) return res.status(400).json({ error: 'Sem estoque: ' + product.name });
      total += product.price * item.quantity;
      orderItems.push({ product_id: product.id, product_name: product.name, quantity: item.quantity, price: product.price });
    }
    total = Math.round(total * 100) / 100;
    const orderNumber = 'PED-' + Date.now().toString().slice(-8) + Math.floor(Math.random() * 100);
    const order = db.createOrder({
      order_number: orderNumber,
      customer_name: b.customer_name,
      phone: b.phone,
      email: b.email || null,
      cpf: b.cpf || null,
      cep: b.cep, state: b.state, city: b.city, address: b.address, number: b.number,
      complement: b.complement || null,
      total, status: 'Pendente',
      mp_payment_id: null, pix_qr_code: null, pix_qr_base64: null, pix_copy_paste: null
    }, orderItems);

    let pixData = null;
    if (paymentClient) {
      try {
        const result = await paymentClient.create({
          body: {
            transaction_amount: total,
            description: 'Pedido ' + orderNumber,
            payment_method_id: 'pix',
            payer: {
              email: b.email || (String(b.phone).replace(/\D/g, '') + '@cliente.loja'),
              first_name: b.customer_name.split(' ')[0],
              last_name: b.customer_name.split(' ').slice(1).join(' ') || b.customer_name.split(' ')[0]
            },
            external_reference: orderNumber,
            notification_url: process.env.BASE_URL ? process.env.BASE_URL + '/api/webhooks/mercadopago' : undefined
          }
        });
        const tx = result.point_of_interaction && result.point_of_interaction.transaction_data;
        if (tx) {
          pixData = { qr_code: tx.qr_code, qr_code_base64: tx.qr_code_base64, ticket_url: tx.ticket_url };
          db.updateOrderPix(order.id, {
            mp_payment_id: String(result.id),
            pix_qr_code: tx.qr_code,
            pix_qr_base64: tx.qr_code_base64,
            pix_copy_paste: tx.qr_code
          });
        }
      } catch (err) {
        console.error('MP error:', err.message || err);
      }
    }

    res.status(201).json({
      success: true,
      order_number: orderNumber,
      order_id: order.id,
      total,
      pix: pixData,
      message: pixData ? 'Pague com PIX' : 'Pedido criado'
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erro interno' });
  }
});

app.get('/api/orders/:orderNumber/status', (req, res) => {
  const order = db.getOrderByNumber(req.params.orderNumber);
  if (!order) return res.status(404).json({ error: 'Nao encontrado' });
  res.json({
    order_number: order.order_number,
    status: order.status,
    total: order.total,
    paid: ['Confirmado', 'Preparando', 'Enviado', 'Concluido'].includes(order.status)
  });
});

app.post('/api/webhooks/mercadopago', async (req, res) => {
  res.status(200).send('OK');
  try {
    const topic = req.query.topic || req.query.type || (req.body && req.body.type);
    const id = req.query.id || req.query['data.id'] || (req.body && req.body.data && req.body.data.id);
    if (id && paymentClient && (topic === 'payment' || topic === 'payment.updated')) {
      const payment = await paymentClient.get({ id });
      if (payment && payment.external_reference && payment.status === 'approved') {
        const order = db.getOrderByNumber(payment.external_reference);
        if (order) {
          db.updateOrderStatus(order.id, 'Confirmado');
          console.log('Pago:', order.order_number);
        }
      }
    }
  } catch (e) {
    console.error('Webhook:', e.message);
  }
});

app.post('/api/admin/login', (req, res) => {
  const admin = db.getAdmin(req.body.username);
  if (!admin || !bcrypt.compareSync(req.body.password, admin.password)) {
    return res.status(401).json({ error: 'Login invalido' });
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
  if (req.session && req.session.adminId) return res.json({ authenticated: true, username: req.session.username });
  res.json({ authenticated: false });
});

app.get('/api/admin/dashboard', requireAdmin, (req, res) => res.json(db.getDashboard()));
app.get('/api/admin/orders', requireAdmin, (req, res) => res.json(db.getOrders()));
app.get('/api/admin/customers', requireAdmin, (req, res) => res.json(db.getCustomers()));
app.get('/api/admin/products', requireAdmin, (req, res) => res.json(db.getProducts()));

app.put('/api/admin/orders/:id/status', requireAdmin, (req, res) => {
  const allowed = ['Pendente', 'Confirmado', 'Preparando', 'Enviado', 'Concluido'];
  if (!allowed.includes(req.body.status)) return res.status(400).json({ error: 'Status invalido' });
  if (!db.updateOrderStatus(req.params.id, req.body.status)) return res.status(404).json({ error: 'Nao encontrado' });
  res.json({ success: true });
});

app.post('/api/admin/products', requireAdmin, upload.single('image'), (req, res) => {
  if (!req.body.name || !req.body.price) return res.status(400).json({ error: 'Nome e preco obrigatorios' });
  const product = db.createProduct({
    name: req.body.name,
    description: req.body.description || '',
    price: parseFloat(req.body.price),
    category: req.body.category || '',
    image: req.file ? '/uploads/' + req.file.filename : '',
    stock: parseInt(req.body.stock) || 0
  });
  res.status(201).json({ id: product.id, success: true });
});

app.put('/api/admin/products/:id', requireAdmin, upload.single('image'), (req, res) => {
  if (!db.getProduct(req.params.id)) return res.status(404).json({ error: 'Nao encontrado' });
  const u = {};
  if (req.body.name) u.name = req.body.name;
  if (req.body.description !== undefined) u.description = req.body.description;
  if (req.body.price !== undefined) u.price = parseFloat(req.body.price);
  if (req.body.category !== undefined) u.category = req.body.category;
  if (req.body.stock !== undefined) u.stock = parseInt(req.body.stock);
  if (req.file) u.image = '/uploads/' + req.file.filename;
  db.updateProduct(req.params.id, u);
  res.json({ success: true });
});

app.delete('/api/admin/products/:id', requireAdmin, (req, res) => {
  if (!db.deleteProduct(req.params.id)) return res.status(404).json({ error: 'Nao encontrado' });
  res.json({ success: true });
});

app.put('/api/admin/settings', requireAdmin, (req, res) => {
  const u = {};
  if (req.body.store_name !== undefined) u.store_name = req.body.store_name;
  if (req.body.store_logo !== undefined) u.store_logo = req.body.store_logo;
  db.updateSettings(u);
  res.json({ success: true });
});

app.get('/admin*', (req, res) => {
  const f = path.join(__dirname, 'public', 'admin', 'index.html');
  if (fs.existsSync(f)) return res.sendFile(f);
  res.status(404).send('Admin nao encontrado');
});

app.get('*', (req, res) => {
  const f = path.join(__dirname, 'public', 'index.html');
  if (fs.existsSync(f)) return res.sendFile(f);
  res.status(200).send('<h1>Loja no ar</h1><p>Falta public/index.html</p>');
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('Servidor na porta ' + PORT);
});
