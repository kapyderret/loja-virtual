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
  const mpAccessToken = process.env.MP_ACCESS_TOKEN || '';
  if (mpAccessToken) {
    const { MercadoPagoConfig, Payment } = require('mercadopago');
    const client = new MercadoPagoConfig({ accessToken: mpAccessToken });
    paymentClient = new Payment(client);
    console.log('Mercado Pago configurado');
  } else {
    console.log('MP_ACCESS_TOKEN nao definido');
  }
} catch (e) {
  console.log('Mercado Pago nao carregou:', e.message);
}

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  }
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

app.set('trust proxy', 1);
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadDir));

app.use(session({
  secret: process.env.SESSION_SECRET || 'loja-virtual-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000, httpOnly: true, sameSite: 'lax' }
}));

function requireAdmin(req, res, next) {
  if (req.session && req.session.adminId) return next();
  return res.status(401).json({ error: 'Nao autorizado' });
}

// Healthcheck (Railway)
app.get('/health', (req, res) => {
  res.status(200).send('ok');
});

app.get('/api/settings', (req, res) => {
  const settings = db.getSettings();
  settings.pix_enabled = !!paymentClient;
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
  if (!product) return res.status(404).json({ error: 'Produto nao encontrado' });
  res.json(product);
});

app.post('/api/orders', async (req, res) => {
  try {
    const {
      customer_name, phone, email, cpf, cep, state, city,
      address, number, complement, items
    } = req.body;

    if (!customer_name || !phone || !cep || !state || !city || !address || !number || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Dados incompletos.' });
    }

    let total = 0;
    const orderItems = [];

    for (const item of items) {
      const product = db.getProduct(item.product_id);
      if (!product) return res.status(400).json({ error: 'Produto nao encontrado' });
      if (product.stock < item.quantity) {
        return res.status(400).json({ error: 'Estoque insuficiente para ' + product.name });
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

    let pixData = null;
    if (paymentClient) {
      try {
        const notificationUrl = process.env.BASE_URL
          ? process.env.BASE_URL + '/api/webhooks/mercadopago'
          : undefined;

        const paymentBody = {
          transaction_amount: total,
          description: 'Pedido ' + orderNumber,
          payment_method_id: 'pix',
          payer: {
            email: email || (phone.replace(/\D/g, '') + '@cliente.loja'),
            first_name: customer_name.split(' ')[0],
            last_name: customer_name.split(' ').slice(1).join(' ') || customer_name.split(' ')[0]
          },
          external_reference: orderNumber,
          notification_url: notificationUrl
        };

        const result = await paymentClient.create({ body: paymentBody });
        const txData = result.point_of_interaction && result.point_of_interaction.transaction_data;

        if (txData) {
          pixData = {
            qr_code: txData.qr_code,
            qr_code_base64: txData.qr_code_base64,
            ticket_url: txData.ticket_url
          };
          db.updateOrderPix(order.id, {
            mp_payment_id: String(result.id),
           
