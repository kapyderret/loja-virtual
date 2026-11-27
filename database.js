const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, 'loja-data.json');

const defaultData = {
  admin: [],
  products: [],
  orders: [],
  order_items: [],
  settings: {},
  nextIds: { products: 1, orders: 1, order_items: 1 }
};

function load() {
  try {
    if (fs.existsSync(DB_PATH)) {
      return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    }
  } catch (e) {
    console.error('Erro ao ler DB:', e.message);
  }
  return JSON.parse(JSON.stringify(defaultData));
}

function save(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
}

let data = load();

if (data.admin.length === 0) {
  data.admin.push({
    id: 1,
    username: 'admin',
    password: bcrypt.hashSync('admin123', 10)
  });
  console.log('Admin criado: usuario=admin | senha=admin123');
}

if (!data.settings.store_name) {
  data.settings.store_name = 'Minha Loja';
  data.settings.store_logo = '';
}

if (data.products.length === 0) {
  const samples = [
    { name: 'Camiseta Básica Premium', description: 'Camiseta 100% algodão penteado, modelagem moderna.', price: 59.90, category: 'Roupas', image: '', stock: 50 },
    { name: 'Tênis Esportivo Runner', description: 'Tênis leve e confortável com amortecimento.', price: 219.90, category: 'Calçados', image: '', stock: 30 },
    { name: 'Mochila Urbana Pro', description: 'Mochila resistente à água com compartimento para notebook.', price: 149.90, category: 'Acessórios', image: '', stock: 25 },
    { name: 'Fone Bluetooth ANC', description: 'Fone sem fio com cancelamento de ruído e até 30h de bateria.', price: 189.90, category: 'Eletrônicos', image: '', stock: 40 },
    { name: 'Relógio Smartwatch', description: 'Monitoramento de saúde e notificações.', price: 299.90, category: 'Eletrônicos', image: '', stock: 15 },
    { name: 'Calça Jeans Slim', description: 'Jeans com elastano para melhor caimento.', price: 129.90, category: 'Roupas', image: '', stock: 35 }
  ];
  samples.forEach(p => {
    data.products.push({ id: data.nextIds.products++, ...p, created_at: new Date().toISOString() });
  });
}

save(data);

const db = {
  getSettings() { return { ...data.settings }; },
  getProducts({ search, category } = {}) {
    let list = [...data.products];
    if (search) {
      const s = search.toLowerCase();
      list = list.filter(p => (p.name && p.name.toLowerCase().includes(s)) || (p.description && p.description.toLowerCase().includes(s)));
    }
    if (category) list = list.filter(p => p.category === category);
    return list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  },
  getCategories() {
    return [...new Set(data.products.map(p => p.category).filter(Boolean))].sort();
  },
  getProduct(id) { return data.products.find(p => p.id === Number(id)); },
  createOrder(orderData, items) {
    const orderId = data.nextIds.orders++;
    const order = { id: orderId, ...orderData, created_at: new Date().toISOString() };
    data.orders.push(order);
    for (const item of items) {
      data.order_items.push({ id: data.nextIds.order_items++, order_id: orderId, ...item });
      const product = data.products.find(p => p.id === item.product_id);
      if (product) product.stock -= item.quantity;
    }
    save(data);
    return order;
  },
  getOrderByNumber(orderNumber) {
    return data.orders.find(o => o.order_number === orderNumber);
  },
  updateOrderPix(id, pixFields) {
    const order = data.orders.find(o => o.id === Number(id));
    if (order) {
      Object.assign(order, pixFields);
      save(data);
      return true;
    }
    return false;
  },
  getAdmin(username) { return data.admin.find(a => a.username === username); },
  getDashboard() {
    const orders = data.orders;
    return {
      totalOrders: orders.length,
      totalRevenue: orders.filter(o => o.status !== 'Cancelado' && o.status !== 'Pendente').reduce((s, o) => s + o.total, 0),
      pending: orders.filter(o => o.status === 'Pendente').length,
      totalProducts: data.products.length,
      totalCustomers: new Set(orders.map(o => o.phone)).size,
      recentOrders: [...orders].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 8)
    };
  },
  getOrders() {
    return [...data.orders].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).map(o => ({
      ...o, items: data.order_items.filter(i => i.order_id === o.id)
    }));
  },
  updateOrderStatus(id, status) {
    const order = data.orders.find(o => o.id === Number(id));
    if (order) { order.status = status; save(data); return true; }
    return false;
  },
  getCustomers() {
    const map = {};
    for (const o of data.orders) {
      if (!map[o.phone]) {
        map[o.phone] = { customer_name: o.customer_name, phone: o.phone, email: o.email, orders_count: 0, total_spent: 0, last_order: o.created_at };
      }
      map[o.phone].orders_count++;
      map[o.phone].total_spent += o.total;
      if (new Date(o.created_at) > new Date(map[o.phone].last_order)) {
        map[o.phone].last_order = o.created_at;
        map[o.phone].customer_name = o.customer_name;
      }
    }
    return Object.values(map).sort((a, b) => new Date(b.last_order) - new Date(a.last_order));
  },
  createProduct(prod) {
    const product = { id: data.nextIds.products++, ...prod, created_at: new Date().toISOString() };
    data.products.push(product);
    save(data);
    return product;
  },
  updateProduct(id, updates) {
    const product = data.products.find(p => p.id === Number(id));
    if (!product) return null;
    Object.assign(product, updates);
    save(data);
    return product;
  },
  deleteProduct(id) {
    const idx = data.products.findIndex(p => p.id === Number(id));
    if (idx === -1) return false;
    data.products.splice(idx, 1);
    save(data);
    return true;
  },
  updateSettings(settings) {
    Object.assign(data.settings, settings);
    save(data);
  }
};

module.exports = db;
