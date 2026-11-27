const API = '';
let products = [];
let cart = JSON.parse(localStorage.getItem('cart') || '[]');
let currentCategory = '';

function formatPrice(v) {
  return 'R$ ' + Number(v).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function saveCart() {
  localStorage.setItem('cart', JSON.stringify(cart));
  updateCartUI();
}

function updateCartUI() {
  const count = cart.reduce((s, i) => s + i.quantity, 0);
  document.getElementById('cart-count').textContent = count;
  const total = cart.reduce((s, i) => s + i.price * i.quantity, 0);
  document.getElementById('cart-total').textContent = formatPrice(total);
  document.getElementById('checkout-total').textContent = formatPrice(total);
  document.getElementById('checkout-btn').disabled = cart.length === 0;

  const container = document.getElementById('cart-items');
  if (cart.length === 0) {
    container.innerHTML = '<div class="cart-empty">Seu carrinho está vazio</div>';
    return;
  }

  container.innerHTML = cart.map(item => `
    <div class="cart-item">
      <div class="cart-item-info">
        <div class="cart-item-name">${escapeHtml(item.name)}</div>
        <div class="cart-item-price">${formatPrice(item.price)}</div>
        <div class="cart-item-qty">
          <button class="qty-btn" onclick="changeQty(${item.product_id}, -1)">−</button>
          <span>${item.quantity}</span>
          <button class="qty-btn" onclick="changeQty(${item.product_id}, 1)">+</button>
        </div>
        <button class="cart-item-remove" onclick="removeFromCart(${item.product_id})">Remover</button>
      </div>
    </div>
  `).join('');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function addToCart(product) {
  if (product.stock <= 0) { alert('Produto sem estoque'); return; }
  const existing = cart.find(i => i.product_id === product.id);
  if (existing) {
    if (existing.quantity >= product.stock) { alert('Quantidade máxima em estoque atingida'); return; }
    existing.quantity++;
  } else {
    cart.push({ product_id: product.id, name: product.name, price: product.price, quantity: 1 });
  }
  saveCart();
  openCart();
}

function changeQty(productId, delta) {
  const item = cart.find(i => i.product_id === productId);
  if (!item) return;
  item.quantity += delta;
  if (item.quantity <= 0) cart = cart.filter(i => i.product_id !== productId);
  else {
    const product = products.find(p => p.id === productId);
    if (product && item.quantity > product.stock) {
      item.quantity = product.stock;
      alert('Quantidade ajustada ao estoque disponível');
    }
  }
  saveCart();
}

function removeFromCart(productId) {
  cart = cart.filter(i => i.product_id !== productId);
  saveCart();
}

function openCart() {
  document.getElementById('cart-sidebar').classList.add('open');
  document.getElementById('cart-overlay').classList.add('open');
}

function closeCart() {
  document.getElementById('cart-sidebar').classList.remove('open');
  document.getElementById('cart-overlay').classList.remove('open');
}

async function loadProducts(search = '') {
  const grid = document.getElementById('products-grid');
  grid.innerHTML = '<div class="loading">Carregando produtos...</div>';
  let url = API + '/api/products?';
  if (search) url += 'search=' + encodeURIComponent(search) + '&';
  if (currentCategory) url += 'category=' + encodeURIComponent(currentCategory);
  try {
    const res = await fetch(url);
    products = await res.json();
    renderProducts();
  } catch (e) {
    grid.innerHTML = '<div class="empty">Erro ao carregar produtos.</div>';
  }
}

function renderProducts() {
  const grid = document.getElementById('products-grid');
  if (products.length === 0) {
    grid.innerHTML = '<div class="empty">Nenhum produto encontrado.</div>';
    return;
  }
  grid.innerHTML = products.map(p => `
    <article class="product-card">
      <div class="product-image">
        ${p.image ? `<img src="${p.image}" alt="${escapeHtml(p.name)}" loading="lazy">` : '📦'}
      </div>
      <div class="product-info">
        <div class="product-category">${escapeHtml(p.category || 'Geral')}</div>
        <h3 class="product-name">${escapeHtml(p.name)}</h3>
        <p class="product-desc">${escapeHtml(p.description || '')}</p>
        <div class="product-footer">
          <div>
            <div class="product-price">${formatPrice(p.price)}</div>
            <div class="product-stock">${p.stock > 0 ? p.stock + ' em estoque' : 'Esgotado'}</div>
          </div>
          <button class="btn btn-primary btn-sm" onclick='addToCart(${JSON.stringify(p).replace(/'/g, "&#39;")})' ${p.stock <= 0 ? 'disabled' : ''}>
            Adicionar
          </button>
        </div>
      </div>
    </article>
  `).join('');
}

async function loadCategories() {
  try {
    const res = await fetch(API + '/api/categories');
    const cats = await res.json();
    document.getElementById('category-buttons').innerHTML = cats.map(c =>
      `<button class="filter-btn" data-category="${escapeHtml(c)}">${escapeHtml(c)}</button>`
    ).join('');
    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentCategory = btn.dataset.category || '';
        loadProducts(document.getElementById('search-input').value.trim());
      });
    });
  } catch (e) {}
}

async function loadSettings() {
  try {
    const res = await fetch(API + '/api/settings');
    const s = await res.json();
    if (s.store_name) {
      document.getElementById('store-name').textContent = s.store_name;
      document.getElementById('footer-name').textContent = s.store_name;
      document.title = s.store_name;
    }
  } catch (e) {}
}

function openCheckout() {
  if (cart.length === 0) return;
  closeCart();
  document.getElementById('checkout-modal').classList.add('open');
}

function closeCheckout() {
  document.getElementById('checkout-modal').classList.remove('open');
}

document.getElementById('checkout-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('submit-order');
  btn.disabled = true;
  btn.textContent = 'Gerando PIX...';

  const data = {
    customer_name: document.getElementById('customer_name').value.trim(),
    phone: document.getElementById('phone').value.trim(),
    email: document.getElementById('email').value.trim(),
    cpf: document.getElementById('cpf').value.trim(),
    cep: document.getElementById('cep').value.trim(),
    state: document.getElementById('state').value.trim().toUpperCase(),
    city: document.getElementById('city').value.trim(),
    address: document.getElementById('address').value.trim(),
    number: document.getElementById('number').value.trim(),
    complement: document.getElementById('complement').value.trim(),
    items: cart.map(i => ({ product_id: i.product_id, quantity: i.quantity }))
  };

  try {
    const res = await fetch(API + '/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Erro ao criar pedido');

    cart = [];
    saveCart();
    closeCheckout();
    document.getElementById('checkout-form').reset();

    // Mostrar sucesso + PIX se disponível
    document.getElementById('order-number').textContent = result.order_number;
    const pixBox = document.getElementById('pix-box');
    if (result.pix && result.pix.qr_code_base64) {
      pixBox.style.display = 'block';
      document.getElementById('pix-qr-img').src = 'data:image/png;base64,' + result.pix.qr_code_base64;
      document.getElementById('pix-copy-code').value = result.pix.qr_code || '';
      document.getElementById('pix-amount').textContent = formatPrice(result.total);
      const noPix = document.getElementById('no-pix-msg');
      if (noPix) noPix.style.display = 'none';
    } else {
      pixBox.style.display = 'none';
      const noPix = document.getElementById('no-pix-msg');
      if (noPix) noPix.style.display = 'block';
    }
    document.getElementById('success-modal').classList.add('open');
    loadProducts();
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Confirmar Pedido';
  }
});

document.getElementById('cart-toggle').addEventListener('click', openCart);
document.getElementById('cart-close').addEventListener('click', closeCart);
document.getElementById('cart-overlay').addEventListener('click', closeCart);
document.getElementById('checkout-btn').addEventListener('click', openCheckout);
document.getElementById('checkout-close').addEventListener('click', closeCheckout);
document.getElementById('success-close').addEventListener('click', () => {
  document.getElementById('success-modal').classList.remove('open');
});

document.getElementById('search-btn').addEventListener('click', () => {
  loadProducts(document.getElementById('search-input').value.trim());
});
document.getElementById('search-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') loadProducts(e.target.value.trim());
});

document.getElementById('cep').addEventListener('blur', async function() {
  const cep = this.value.replace(/\D/g, '');
  if (cep.length !== 8) return;
  try {
    const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
    const data = await res.json();
    if (!data.erro) {
      document.getElementById('state').value = data.uf || '';
      document.getElementById('city').value = data.localidade || '';
      document.getElementById('address').value = data.logradouro || '';
    }
  } catch (e) {}
});

document.getElementById('copy-pix-btn')?.addEventListener('click', () => {
  const code = document.getElementById('pix-copy-code');
  code.select();
  navigator.clipboard.writeText(code.value).then(() => {
    const btn = document.getElementById('copy-pix-btn');
    btn.textContent = 'Copiado!';
    setTimeout(() => btn.textContent = 'Copiar código PIX', 2000);
  });
});

loadSettings();
loadCategories();
loadProducts();
updateCartUI();
