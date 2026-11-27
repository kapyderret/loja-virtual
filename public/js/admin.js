const API = '';

function formatPrice(v) {
  return 'R$ ' + Number(v).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function formatDate(str) {
  if (!str) return '-';
  const d = new Date(str);
  return d.toLocaleString('pt-BR');
}

async function checkAuth() {
  try {
    const res = await fetch(API + '/api/admin/me', { credentials: 'include' });
    const data = await res.json();
    if (data.authenticated) {
      showAdmin();
      loadDashboard();
    } else {
      showLogin();
    }
  } catch (e) {
    showLogin();
  }
}

function showLogin() {
  document.getElementById('login-page').style.display = 'flex';
  document.getElementById('admin-app').style.display = 'none';
}

function showAdmin() {
  document.getElementById('login-page').style.display = 'none';
  document.getElementById('admin-app').style.display = 'flex';
}

// Login
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('login-error');
  errorEl.style.display = 'none';
  try {
    const res = await fetch(API + '/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        username: document.getElementById('login-user').value,
        password: document.getElementById('login-pass').value
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro no login');
    showAdmin();
    loadDashboard();
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.style.display = 'block';
  }
});

document.getElementById('logout-btn').addEventListener('click', async (e) => {
  e.preventDefault();
  await fetch(API + '/api/admin/logout', { method: 'POST', credentials: 'include' });
  showLogin();
});

// Navigation
document.querySelectorAll('.admin-nav a[data-panel]').forEach(link => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    document.querySelectorAll('.admin-nav a').forEach(a => a.classList.remove('active'));
    link.classList.add('active');
    document.querySelectorAll('.admin-panel').forEach(p => p.classList.remove('active'));
    document.getElementById('panel-' + link.dataset.panel).classList.add('active');

    if (link.dataset.panel === 'dashboard') loadDashboard();
    if (link.dataset.panel === 'orders') loadOrders();
    if (link.dataset.panel === 'products') loadProducts();
    if (link.dataset.panel === 'customers') loadCustomers();
    if (link.dataset.panel === 'settings') loadSettings();
  });
});

// Dashboard
async function loadDashboard() {
  try {
    const res = await fetch(API + '/api/admin/dashboard', { credentials: 'include' });
    if (res.status === 401) return showLogin();
    const data = await res.json();

    document.getElementById('stats-grid').innerHTML = `
      <div class="stat-card"><div class="label">Pedidos</div><div class="value">${data.totalOrders}</div></div>
      <div class="stat-card"><div class="label">Receita</div><div class="value">${formatPrice(data.totalRevenue)}</div></div>
      <div class="stat-card"><div class="label">Pendentes</div><div class="value">${data.pending}</div></div>
      <div class="stat-card"><div class="label">Produtos</div><div class="value">${data.totalProducts}</div></div>
      <div class="stat-card"><div class="label">Clientes</div><div class="value">${data.totalCustomers}</div></div>
    `;

    document.getElementById('recent-orders').innerHTML = data.recentOrders.map(o => `
      <tr>
        <td>${o.order_number}</td>
        <td>${escapeHtml(o.customer_name)}</td>
        <td>${formatPrice(o.total)}</td>
        <td><span class="status-badge status-${o.status}">${o.status}</span></td>
        <td>${formatDate(o.created_at)}</td>
      </tr>
    `).join('') || '<tr><td colspan="5" style="text-align:center;color:#6b7280;">Nenhum pedido ainda</td></tr>';
  } catch (e) {
    console.error(e);
  }
}

// Orders
async function loadOrders() {
  try {
    const res = await fetch(API + '/api/admin/orders', { credentials: 'include' });
    if (res.status === 401) return showLogin();
    const orders = await res.json();

    document.getElementById('orders-table').innerHTML = orders.map(o => {
      const items = (o.items || []).map(i => `${i.quantity}x ${i.product_name}`).join('<br>');
      const address = `${o.address}, ${o.number}${o.complement ? ' - ' + o.complement : ''}<br>${o.city}/${o.state} - CEP ${o.cep}`;
      return `
        <tr>
          <td><strong>${o.order_number}</strong></td>
          <td>${escapeHtml(o.customer_name)}</td>
          <td>${escapeHtml(o.phone)}</td>
          <td style="font-size:0.8rem;">${address}</td>
          <td style="font-size:0.8rem;">${items}</td>
          <td>${formatPrice(o.total)}</td>
          <td style="white-space:nowrap;">${formatDate(o.created_at)}</td>
          <td>
            <select onchange="updateStatus(${o.id}, this.value)">
              ${['Pendente','Confirmado','Preparando','Enviado','Concluído'].map(s =>
                `<option value="${s}" ${o.status === s ? 'selected' : ''}>${s}</option>`
              ).join('')}
            </select>
          </td>
        </tr>
      `;
    }).join('') || '<tr><td colspan="8" style="text-align:center;color:#6b7280;">Nenhum pedido</td></tr>';
  } catch (e) {
    console.error(e);
  }
}

async function updateStatus(id, status) {
  try {
    const res = await fetch(API + '/api/admin/orders/' + id + '/status', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ status })
    });
    if (!res.ok) throw new Error('Erro ao atualizar');
  } catch (e) {
    alert(e.message);
    loadOrders();
  }
}

// Products
async function loadProducts() {
  try {
    const res = await fetch(API + '/api/admin/products', { credentials: 'include' });
    if (res.status === 401) return showLogin();
    const products = await res.json();

    document.getElementById('products-table').innerHTML = products.map(p => `
      <tr>
        <td>${p.id}</td>
        <td>${escapeHtml(p.name)}</td>
        <td>${escapeHtml(p.category || '-')}</td>
        <td>${formatPrice(p.price)}</td>
        <td>${p.stock}</td>
        <td>
          <button class="btn btn-sm btn-outline" onclick="editProduct(${p.id})">Editar</button>
          <button class="btn btn-sm btn-danger" onclick="deleteProduct(${p.id})">Excluir</button>
        </td>
      </tr>
    `).join('') || '<tr><td colspan="6" style="text-align:center;">Nenhum produto</td></tr>';

    window._productsCache = products;
  } catch (e) {
    console.error(e);
  }
}

function openProductModal(product = null) {
  document.getElementById('product-modal').classList.add('open');
  document.getElementById('product-modal-title').textContent = product ? 'Editar Produto' : 'Novo Produto';
  document.getElementById('product-id').value = product ? product.id : '';
  document.getElementById('prod-name').value = product ? product.name : '';
  document.getElementById('prod-desc').value = product ? (product.description || '') : '';
  document.getElementById('prod-price').value = product ? product.price : '';
  document.getElementById('prod-stock').value = product ? product.stock : 0;
  document.getElementById('prod-category').value = product ? (product.category || '') : '';
  document.getElementById('prod-image').value = '';
}

function closeProductModal() {
  document.getElementById('product-modal').classList.remove('open');
}

document.getElementById('btn-new-product').addEventListener('click', () => openProductModal());
document.getElementById('product-modal-close').addEventListener('click', closeProductModal);
document.getElementById('product-modal-cancel').addEventListener('click', closeProductModal);

document.getElementById('product-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('product-id').value;
  const formData = new FormData();
  formData.append('name', document.getElementById('prod-name').value);
  formData.append('description', document.getElementById('prod-desc').value);
  formData.append('price', document.getElementById('prod-price').value);
  formData.append('stock', document.getElementById('prod-stock').value);
  formData.append('category', document.getElementById('prod-category').value);
  const file = document.getElementById('prod-image').files[0];
  if (file) formData.append('image', file);

  try {
    const url = id ? API + '/api/admin/products/' + id : API + '/api/admin/products';
    const method = id ? 'PUT' : 'POST';
    const res = await fetch(url, { method, credentials: 'include', body: formData });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Erro ao salvar');
    }
    closeProductModal();
    loadProducts();
  } catch (err) {
    alert(err.message);
  }
});

function editProduct(id) {
  const product = (window._productsCache || []).find(p => p.id === id);
  if (product) openProductModal(product);
}

async function deleteProduct(id) {
  if (!confirm('Tem certeza que deseja excluir este produto?')) return;
  try {
    const res = await fetch(API + '/api/admin/products/' + id, {
      method: 'DELETE',
      credentials: 'include'
    });
    if (!res.ok) throw new Error('Erro ao excluir');
    loadProducts();
  } catch (e) {
    alert(e.message);
  }
}

// Customers
async function loadCustomers() {
  try {
    const res = await fetch(API + '/api/admin/customers', { credentials: 'include' });
    if (res.status === 401) return showLogin();
    const customers = await res.json();

    document.getElementById('customers-table').innerHTML = customers.map(c => `
      <tr>
        <td>${escapeHtml(c.customer_name)}</td>
        <td>${escapeHtml(c.phone)}</td>
        <td>${escapeHtml(c.email || '-')}</td>
        <td>${c.orders_count}</td>
        <td>${formatPrice(c.total_spent)}</td>
        <td>${formatDate(c.last_order)}</td>
      </tr>
    `).join('') || '<tr><td colspan="6" style="text-align:center;color:#6b7280;">Nenhum cliente ainda</td></tr>';
  } catch (e) {
    console.error(e);
  }
}

// Settings
async function loadSettings() {
  try {
    const res = await fetch(API + '/api/settings');
    const s = await res.json();
    document.getElementById('setting-name').value = s.store_name || '';
  } catch (e) {}
}

document.getElementById('save-settings').addEventListener('click', async () => {
  try {
    const res = await fetch(API + '/api/admin/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ store_name: document.getElementById('setting-name').value })
    });
    if (!res.ok) throw new Error('Erro ao salvar');
    alert('Configurações salvas!');
  } catch (e) {
    alert(e.message);
  }
});

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Init
checkAuth();
